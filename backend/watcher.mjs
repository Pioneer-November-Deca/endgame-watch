import { chromium } from 'playwright';
import { pool } from './database.mjs';
import { CAMPAIGN_ID, CAMPAIGN_URL, SELECTOR, parseTimer } from './domain.mjs';
import { considerAlert } from './alerts.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopped = false, browser;
export async function stopWatcher() { stopped = true; await browser?.close(); }

export async function runWatcher() {
  while (!stopped) {
    let client, lostLock = false;
    try {
      client = await pool.connect();
      const onError = () => { lostLock = true; browser?.close().catch(() => {}); };
      client.on('error', onError);
      const lock = await client.query('SELECT pg_try_advisory_lock(74120912) AS acquired');
      if (!lock.rows[0].acquired) { client.removeListener('error', onError); client.release(); client = null; await delay(5000); continue; }
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ locale: 'en-US' });
      await page.goto(CAMPAIGN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      console.log('watcher_browser_started');
      let lastNavigation = Date.now(), lastPersist = 0, lastValid = Date.now(), lastNetworkCheck = 0, originReachable = false;
      while (!stopped && !lostLock) {
        if (Date.now() - lastNetworkCheck > 20_000) {
          originReachable = await page.evaluate(async () => {
            try {
              const response = await fetch(location.href, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
              return response.ok && !(await response.text()).includes('_cf_chl_opt');
            } catch { return false; }
          });
          lastNetworkCheck = Date.now();
        }
        const observedAt = Date.now();
        const sample = await page.evaluate(selector => {
          const node = document.querySelector(selector);
          return { text: node?.textContent ?? '', visible: Boolean(node && node.getClientRects().length), online: navigator.onLine };
        }, SELECTOR);
        const seconds = originReachable && sample.online && sample.visible ? parseTimer(sample.text) : null;
        const sourceStatus = seconds === null ? 'unavailable' : 'live';
        if (seconds !== null) lastValid = observedAt;
        // Persist the signal, not an assumed deadline; extensions are observed in the DOM.
        if (observedAt - lastPersist >= 2000 || (seconds !== null && seconds < 120)) {
          await client.query(`INSERT INTO watch_observation(campaign_id,seconds,source_status,observed_at) VALUES($1,$2,$3,$4)
            ON CONFLICT(campaign_id) DO UPDATE SET seconds=EXCLUDED.seconds,source_status=EXCLUDED.source_status,observed_at=EXCLUDED.observed_at`,
          [CAMPAIGN_ID, seconds, sourceStatus, observedAt]);
          lastPersist = observedAt;
        }
        if (!lostLock) await considerAlert({ seconds, sourceStatus, observedAt });
        // Revalidate with the origin regularly. Do not reload during the critical window.
        if ((seconds === null && observedAt - lastValid > 60_000) || (seconds > 180 && observedAt - lastNavigation > 60_000)) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
          lastNavigation = Date.now(); lastValid = Date.now();
        }
        await delay(1000);
      }
      client.removeListener('error', onError);
    } catch { if (!stopped) console.error('watcher_unavailable_retrying'); }
    finally {
      await browser?.close().catch(() => {}); browser = null;
      if (client) { try { await client.query('SELECT pg_advisory_unlock(74120912)'); } catch { /* disconnected */ } client.release(true); }
    }
    if (!stopped) await delay(15_000);
  }
}
