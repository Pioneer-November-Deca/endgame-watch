import { CAMPAIGN_URL } from './domain.mjs';
export function mailConfig() {
  const e = process.env;
  return { key: e.MAILGUN_API_KEY, domain: e.MAILGUN_DOMAIN, from: e.MAILGUN_FROM, list: e.MAILGUN_LIST_ADDRESS,
    base: e.MAILGUN_REGION === 'EU' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net' };
}
export function mailReady() { const c = mailConfig(); return Boolean(c.key && c.domain && c.from && c.list); }
export function signupReady() { return mailReady() && process.env.SIGNUPS_ENABLED === 'true' && /^https:\/\//.test(process.env.BACKEND_URL || ''); }
export function alertReady() { return mailReady() && process.env.ALERTS_ENABLED === 'true'; }
export async function requestMailgun(path, fields) {
  const c = mailConfig(), body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const response = await fetch(c.base + path, {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`api:${c.key}`).toString('base64') },
    body, signal: AbortSignal.timeout(15_000)
  });
  let result = {}; try { result = await response.json(); } catch { /* Never expose provider response bodies. */ }
  return { ok: response.ok, status: response.status, id: typeof result.id === 'string' ? result.id : null };
}
export async function sendConfirmation(email, confirmationUrl) {
  const c = mailConfig();
  return requestMailgun(`/v3/${encodeURIComponent(c.domain)}/messages`, {
    from: c.from, to: email, subject: 'Confirm your Satisfactory campaign alert',
    text: `Confirm your signup for one email when the Gamefound countdown drops below 2 minutes:\n${confirmationUrl}\n\nThis link expires in 30 minutes. If you did not request this, ignore this email.`,
    'o:tracking': 'no'
  });
}
export async function addSubscriber(email, consentAt) {
  const c = mailConfig();
  return requestMailgun(`/v3/lists/${encodeURIComponent(c.list)}/members`, {
    address: email, subscribed: 'true', upsert: 'true',
    vars: JSON.stringify({ campaign: 'satisfactory-the-board-game', consentAt, confirmedAt: new Date().toISOString() })
  });
}
export async function sendAlert(seconds) {
  const c = mailConfig();
  return requestMailgun(`/v3/${encodeURIComponent(c.domain)}/messages`, {
    from: c.from, to: c.list, subject: 'Act now: Satisfactory countdown is below 2 minutes',
    text: `The live Gamefound countdown was observed at ${seconds} seconds remaining.\n\nOpen the campaign now:\n${CAMPAIGN_URL}\n\nThe timer may extend and email delivery takes time. Check Gamefound for the current status.\n\nUnsubscribe: %mailing_list_unsubscribe_url%`,
    'o:tag': 'satisfactory-under-two-minutes', 'o:tracking': 'no'
  });
}
