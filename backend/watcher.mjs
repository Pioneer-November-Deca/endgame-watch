import { pool } from './database.mjs';
import { CAMPAIGN_ID, shouldAlert } from './domain.mjs';
import { fetchCampaign, SourceError } from './gamefound-api.mjs';
import { considerAlert } from './alerts.mjs';
import { alertReady } from './mailgun.mjs';
import { setTimeout as delay } from 'node:timers/promises';
let stopped = false;
const shutdown = new AbortController();
export async function stopWatcher() { stopped = true; shutdown.abort(); }
async function sleep(ms) { try { await delay(ms, undefined, { signal: shutdown.signal }); } catch { /* shutdown */ } }
async function persist(client, observation) {
  await client.query(`INSERT INTO watch_observation(campaign_id,seconds,source_status,observed_at,deadline_at,campaign_end_date,source)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(campaign_id) DO UPDATE SET seconds=EXCLUDED.seconds,source_status=EXCLUDED.source_status,
    observed_at=EXCLUDED.observed_at,deadline_at=EXCLUDED.deadline_at,campaign_end_date=EXCLUDED.campaign_end_date,source=EXCLUDED.source`,
  [CAMPAIGN_ID, observation.seconds, observation.sourceStatus, observation.observedAt, observation.deadlineAt ?? null, observation.campaignEndDate ?? null, 'gamefound-public-api']);
}
export async function runWatcher() {
  while (!stopped) {
    let client, lostLock = false, onError;
    try {
      client = await pool.connect();
      onError = () => { lostLock = true; };
      client.on('error', onError);
      const lock = await client.query('SELECT pg_try_advisory_lock(74120912) AS acquired');
      if (!lock.rows[0].acquired) { client.removeListener('error',onError);client.release();client=null;await sleep(5000);continue; }
      console.log('watcher_api_started');
      let failures = 0, previousDeadline = null, previousStatus = null;
      while (!stopped && !lostLock) {
        let waitMs = 5000;
        const started = Date.now();
        try {
          let observation = await fetchCampaign({ signal: shutdown.signal });
          if (lostLock || stopped) break;
          await persist(client,observation);
          // A second read protects against an extension between the polling sample
          // and the alert. Never trigger solely from local countdown interpolation.
          if (alertReady() && shouldAlert(observation)) {
            await sleep(1000);
            if (lostLock || stopped) break;
            observation = await fetchCampaign({ signal: shutdown.signal });
            if (lostLock || stopped) break;
            await persist(client,observation);
            if (shouldAlert(observation)) await considerAlert(observation);
          }
          if (observation.campaignEndDate !== previousDeadline || previousStatus !== observation.sourceStatus) {
            console.log(JSON.stringify({ event:'gamefound_api_observation', status:observation.sourceStatus, seconds:observation.seconds,
              campaignEndDate:observation.campaignEndDate, deadlineChanged:previousDeadline !== null && previousDeadline !== observation.campaignEndDate }));
          }
          previousDeadline=observation.campaignEndDate;previousStatus=observation.sourceStatus;failures=0;
        } catch(error) {
          if (stopped || lostLock) break;
          failures++;
          await persist(client,{seconds:null,sourceStatus:'unavailable',observedAt:Date.now()});
          const code=error instanceof SourceError?error.code:'source_request_failed';
          if(previousStatus!=='unavailable')console.error(JSON.stringify({event:'gamefound_api_unavailable',code}));
          previousStatus='unavailable';
          waitMs=(error.retryAfterMs ?? Math.min(60_000,5000*2**Math.min(failures-1,4)))+(Date.now()-started);
        }
        await sleep(Math.max(1000,waitMs-(Date.now()-started)));
      }
    } catch { if(!stopped)console.error('watcher_database_unavailable_retrying'); }
    finally {
      if(client){if(onError)client.removeListener('error',onError);try{await client.query('SELECT pg_advisory_unlock(74120912)');}catch{/* disconnected */}client.release(true);}
    }
    if(!stopped)await sleep(15_000);
  }
}
