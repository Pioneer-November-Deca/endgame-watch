# Endgame Watch

Public GitHub Pages frontend with a persistent Railway API watcher and Postgres. Alerts are eligible only when **0 < remaining seconds < 120**, from a fresh Gamefound API response. Zero, expired deadlines, failed requests and unreadable data never trigger an alert.

## Deployment

- Repository: `Pioneer-November-Deca/endgame-watch`.
- Public page: `https://pioneer-november-deca.github.io/endgame-watch/`.
- Backend: `https://endgame-backend-production.up.railway.app`.
- Railway services: `endgame-backend` and `Postgres` (private database connection).
- Git author and committer: `Endgame Watch <endgame-watch@users.noreply.github.com>`. Do not publish personal names, account emails, local usernames or machine paths.

The root Dockerfile uses the official Node 22 image. No browser or Chromium dependency is required. Keep Railway Serverless/sleep disabled. The service holds a Postgres advisory lock so only one poller is active during deployment overlap. A database unique key prevents duplicate alert attempts across restarts and replicas.

## Source and verification

The supported source is Gamefound's [documented public project API](https://help.gamefound.com/article/425-gamefound-public-api):

`https://gamefound.com/api/public/projects/getCrowdfundingProject?urlName=satisfactory-the-board-game`

The watcher checks every five seconds and uses `campaignEndDate`. On November 10, 2026, repeated live reads showed this deadline advancing with Endgame extensions, and the freshly reloaded campaign page showed the corresponding roughly nine-minute countdown. The API returned HTTP 200 even while automated requests to the rewards webpage received a Cloudflare challenge.

The watcher validates the campaign and creator, a timezone-qualified deadline, JSON content, response time, and HTTP Date/Age metadata. It uses Gamefound's HTTP clock to account for modest worker clock differences. Malformed responses, HTTP errors, old cache metadata, missing dates or excessive clock skew suppress the signal. Failed reads use exponential backoff up to one minute; `Retry-After` is respected up to one hour.

Gamefound says public API results are briefly cached but does not publish the internal cache duration. HTTP freshness headers cannot prove the application data itself was just regenerated. A new extension can therefore briefly lag in the API. Before an alert, a second API read confirms that the latest reported deadline is still positive and below two minutes. An extension can still occur immediately after that read. No exact delivery deadline or perfect synchronization is guaranteed.

## Signup and email

Email signup and sending are disabled until configured. In the Railway backend service, set:

- `MAILGUN_API_KEY`: a key with sending and mailing-list write access.
- `MAILGUN_DOMAIN`: verified sending domain.
- `MAILGUN_FROM`: sender address on that domain.
- `MAILGUN_LIST_ADDRESS`: an existing Mailgun mailing list; restrict list posting to administrators.
- `MAILGUN_REGION`: `US` or `EU`.
- `RATE_LIMIT_SALT`: a random secret for consistent abuse throttling across restarts.
- `SIGNUPS_ENABLED=true` and `ALERTS_ENABLED=true` only after the above is verified.

Keep secrets in Railway variables only. Never put keys in GitHub, frontend JavaScript, Docker build arguments or public documentation. Already configured service variables include `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `PUBLIC_ORIGIN=https://pioneer-november-deca.github.io`, `BACKEND_URL=https://endgame-backend-production.up.railway.app`, `PORT=3000`, and `NODE_ENV=production`.

The form requires explicit consent. A time-limited verification email is sent first; a deliberate confirmation POST adds the address to Mailgun. Link scanners cannot subscribe by GET alone. Tokens are stored as hashes, pending confirmations expire after 30 minutes and are removed by hourly cleanup, and consent timestamps are passed into Mailgun member variables. Rate-limit keys are hashed and expire after one hour. Subscriber addresses are never exposed through the public API. The alert includes Mailgun's mailing-list unsubscribe link.

There is one alert attempt per campaign. Mailgun rejection or uncertain delivery is not automatically retried. Inspect `watch_alert` and Mailgun logs before manual recovery; a process crash after claiming may leave `sending`. Mailgun acceptance is not proof of inbox delivery. Email submitted before zero may arrive after the campaign closes.

## Frontend and health

The frontend polls `/api/status` every three seconds and interpolates the most recent reported deadline. Observations older than 15 seconds are hidden. It never sends email or triggers alerts based on browser time. An elapsed API deadline is labeled as the latest reported deadline passing, not independent confirmation that the campaign has closed.

`GET /healthz` checks the application and database. `GET /api/status` reports source, deadline, observation time, freshness, configuration readiness and alert status. No public route can inject timer values or send a campaign alert.

GitHub Pages uses the included **Deploy public page** Actions workflow, publishing `docs/`. It uses `docs/config.js` for the public backend URL; the optional repository variable `API_BASE_URL` can override that URL at deployment. Backend source comes from the same repository's `main` branch. Verify the latest commit is running after each deployment.

## Development

Requires Node 22+ and Postgres. Run `npm ci`, `npm test`, and `npm run preview` for the static page on port 5174. Configure runtime variables, then `npm start` for the backend. `npm run probe` makes one read-only API request without importing Mailgun or database code. Tests cover deadline extensions, clock offsets, the strict positive two-minute threshold, fractional expiry, cache freshness, HTTP failures and invalid payloads.
