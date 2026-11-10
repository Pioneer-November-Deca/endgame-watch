import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { pool, migrate } from './database.mjs';
import { CAMPAIGN_ID, CAMPAIGN_URL, THRESHOLD, normalizeEmail, publicObservation } from './domain.mjs';
import { signupReady, alertReady, sendConfirmation, addSubscriber } from './mailgun.mjs';
import { runWatcher, stopWatcher } from './watcher.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const publicOrigin = new URL(process.env.PUBLIC_ORIGIN || 'https://pioneer-november-deca.github.io').origin;
const backendUrl = (process.env.BACKEND_URL || '').replace(/\/$/, '');
const salt = process.env.RATE_LIMIT_SALT || randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
await migrate();

function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function html(res, status, title, text) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:18px system-ui;background:#101815;color:#e8eee5;max-width:620px;margin:12vh auto;padding:24px;line-height:1.6}a{color:#c5e59a}button{padding:14px;background:#c5e59a;border:0;border-radius:6px;cursor:pointer;font-size:16px}</style><h1>${title}</h1><p>${text}</p><p><a href="${publicOrigin}/endgame-watch/">Return to Endgame Watch</a></p></html>`);
}
async function body(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 2048) throw new Error('invalid_body'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function rate(key, limit) {
  const result = await pool.query(`INSERT INTO watch_rate(key_hash,hits,expires_at) VALUES($1,1,now()+interval '1 hour')
    ON CONFLICT(key_hash) DO UPDATE SET hits=CASE WHEN watch_rate.expires_at<now() THEN 1 ELSE watch_rate.hits+1 END,
    expires_at=CASE WHEN watch_rate.expires_at<now() THEN now()+interval '1 hour' ELSE watch_rate.expires_at END RETURNING hits`, [hash(salt + key)]);
  return result.rows[0].hits <= limit;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (origin === publicOrigin || (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || ''))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(origin === publicOrigin || res.hasHeader('Access-Control-Allow-Origin') ? 204 : 403); res.end(); return; }
    if (req.method === 'GET' && url.pathname === '/healthz') {
      await pool.query('SELECT 1'); return json(res, 200, { status: 'ok' });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const [observation, alert] = await Promise.all([
        pool.query('SELECT * FROM watch_observation WHERE campaign_id=$1', [CAMPAIGN_ID]),
        pool.query('SELECT status,created_at FROM watch_alert WHERE campaign_id=$1', [CAMPAIGN_ID])
      ]);
      return json(res, 200, { ...publicObservation(observation.rows[0]), campaignUrl: CAMPAIGN_URL, thresholdSeconds: THRESHOLD,
        signupEnabled: signupReady(), alertsEnabled: alertReady(), alertStatus: alert.rows[0]?.status ?? 'waiting' });
    }
    if (req.method === 'POST' && url.pathname === '/api/subscribe') {
      if (!res.hasHeader('Access-Control-Allow-Origin')) return json(res, 403, { message: 'Request origin rejected.' });
      if (!signupReady()) return json(res, 503, { message: 'Email signup is not enabled yet. No address has been collected.' });
      let data; try { data = await body(req); } catch { return json(res, 400, { message: 'Invalid form.' }); }
      if (data.website) return json(res, 200, { message: 'If eligible, a confirmation email will arrive shortly.' });
      const email = normalizeEmail(data.email);
      if (!email || data.consent !== true) return json(res, 400, { message: 'Enter a valid email and agree to receive the campaign alert.' });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
      if (!await rate('global', 100) || !await rate('ip:'+ip, 10) || !await rate('email:'+email, 2)) return json(res, 429, { message: 'Please wait before requesting another confirmation.' });
      const token = randomBytes(32).toString('hex');
      await pool.query(`INSERT INTO watch_confirmation(token_hash,email,expires_at) VALUES($1,$2,now()+interval '30 minutes')
        ON CONFLICT(email) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,consent_at=now(),state='pending'`, [hash(token), email]);
      const result = await sendConfirmation(email, `${backendUrl}/confirm?token=${token}`);
      if (!result.ok) return json(res, 502, { message: 'Confirmation could not be sent. Please try again later.' });
      return json(res, 200, { message: 'Check your inbox and confirm your address to join the alert list.' });
    }
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/confirm') {
      const token = url.searchParams.get('token');
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return html(res, 400, 'Invalid confirmation', 'Request a new signup link.');
      if (req.method === 'GET') {
        // A deliberate POST prevents email link scanners from subscribing visitors.
        return html(res, 200, 'Confirm your campaign alert', `<form method="post" action="/confirm?token=${token}"><p>Receive one alert when Satisfactory’s live countdown is below 2 minutes.</p><button type="submit">Confirm my signup</button></form>`);
      }
      if (!signupReady()) return html(res, 503, 'Signup unavailable', 'Please try again later.');
      const claimed = await pool.query(`UPDATE watch_confirmation SET state='confirming' WHERE token_hash=$1 AND state='pending' AND expires_at>now() RETURNING email,consent_at`, [hash(token)]);
      if (!claimed.rowCount) return html(res, 400, 'Link expired or already used', 'Request a new signup link if you have not confirmed.');
      try {
        const record = claimed.rows[0];
        const result = await addSubscriber(record.email, record.consent_at.toISOString());
        if (!result.ok) throw new Error('mailgun_rejected');
        await pool.query('DELETE FROM watch_confirmation WHERE token_hash=$1', [hash(token)]);
        return html(res, 200, 'You’re on the list', 'Your address is confirmed. Watch for the near-end alert. You can unsubscribe using the link in that email.');
      } catch {
        await pool.query("UPDATE watch_confirmation SET state='pending' WHERE token_hash=$1", [hash(token)]);
        return html(res, 502, 'Could not confirm yet', 'Please try the confirmation link again shortly.');
      }
    }
    json(res, 404, { message: 'Not found.' });
  } catch { console.error('request_failed'); if (!res.headersSent) json(res, 503, { message: 'Service temporarily unavailable. Please try again.' }); else res.end(); }
});
server.requestTimeout = 15_000;
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('endgame_backend_listening'));
runWatcher().catch(() => console.error('watcher_stopped_unexpectedly'));
const cleanup = setInterval(() => {
  Promise.all([pool.query('DELETE FROM watch_confirmation WHERE expires_at<now()'), pool.query('DELETE FROM watch_rate WHERE expires_at<now()')]).catch(() => console.error('cleanup_failed'));
}, 3600_000);
cleanup.unref();
async function shutdown() { clearInterval(cleanup); server.close(); await stopWatcher(); await pool.end(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
