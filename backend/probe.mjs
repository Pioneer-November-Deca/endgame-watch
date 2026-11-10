import { chromium } from 'playwright';
import { CAMPAIGN_URL, SELECTOR, parseTimer } from './domain.mjs';
// Read-only connectivity check. This never imports Mailgun or the alert sender.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: 'en-US' });
  const response = await page.goto(CAMPAIGN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.locator(SELECTOR).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  const text = await page.locator(SELECTOR).first().textContent({ timeout: 2000 }).catch(() => null);
  const seconds = parseTimer(text);
  console.log(JSON.stringify({ httpStatus: response?.status(), title: await page.title(), selectorFound: text !== null, seconds, verified: seconds !== null }));
  if (seconds === null) process.exitCode = 2;
} finally { await browser.close(); }
