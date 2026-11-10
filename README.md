# Endgame Watch

Public GitHub Pages frontend and a persistent Railway backend that observes the Satisfactory Gamefound campaign. The alert condition is **0 < observed seconds < 120**. It never alerts at zero, from a missing timer, or from a locally assumed end time. One near-end alert is attempted per campaign, including across restarts and timer extensions.

## Current deployment targets

- Repository: `Pioneer-November-Deca/endgame-watch`.
- Frontend: `docs/`, published by GitHub Pages. Expected URL after successful deployment: `https://pioneer-november-deca.github.io/endgame-watch/`.
- Railway backend service: `endgame-backend`.
- Backend hostname: `https://endgame-backend-production.up.railway.app` (a hostname alone does not confirm deployment).
- Database service: `Postgres` (private connection only).

## Verification limitation

Both a direct HTTP request and a read-only standard headless Chromium probe received a Cloudflare 403 challenge from Gamefound on November 10, 2026. The selector was not readable. No challenge bypass, guessed end time, or substitute countdown is implemented. A successful Railway healthcheck only proves the application and database are running, **not** that the Gamefound timer is accessible. Verify `/api/status` shows a fresh `sourceStatus: live` and compare its seconds to Gamefound before enabling alerts. If Railway also receives the challenge, obtain a supported data feed or access arrangement from Gamefound/the publisher. Do not rely on this service for the two-minute window until that is resolved.

## Publish

1. Upload these source files to the public GitHub repository, excluding `node_modules/` and any `.env` file. Use `Endgame Watch <endgame-watch@users.noreply.github.com>` for both Git author and committer; do not use personal account names, emails, or local machine identities.
2. In GitHub Settings → Pages, select GitHub Actions, then run **Deploy public page**. Alternatively, choose **Deploy from a branch**, branch `main`, folder `/docs`. For branch publishing, remove/disable the Pages Actions workflow to avoid two publishing paths.
3. Connect Railway's existing `endgame-backend` service to that GitHub repository, branch `main`. Dockerfile and `railway.json` are at the repository root.
4. Keep Railway Serverless/sleep disabled. One backend replica is sufficient; a Postgres advisory lock ensures only one watcher is active during deployment overlap.
5. Backend runtime variables already configured: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `PUBLIC_ORIGIN=https://pioneer-november-deca.github.io`, `BACKEND_URL=https://endgame-backend-production.up.railway.app`, `PORT=3000`, `NODE_ENV=production`. `ALERTS_ENABLED` and `SIGNUPS_ENABLED` default to false.
6. Create a Mailgun mailing list with posting restricted to administrators. Set `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `MAILGUN_LIST_ADDRESS`, and `MAILGUN_REGION` (`US` or `EU`) **in Railway variables only**. The key needs both sending and mailing-list write access. Never place credentials in GitHub or frontend configuration.
7. Once the timer source and mail settings are verified, set `SIGNUPS_ENABLED=true` and `ALERTS_ENABLED=true` and redeploy. Add a random `RATE_LIMIT_SALT` in Railway for consistent abuse throttling across restarts.

## Behavior

- A standard Playwright browser reads `[data-qa="project-summary:EndgameTimer"]` every second. Browser reads are local DOM reads, not a new HTTP request each second. Origin reachability is checked every 20 seconds; failed requests or a Cloudflare challenge suppress observations. The page is periodically reloaded outside the final three minutes to refresh server state. Missing/unreadable text is unavailable, never zero.
- The frontend polls the backend every three seconds, interpolates the latest observed timer, and hides stale signals. Browser time interpolation never sends email.
- `POST /api/subscribe` accepts explicit consent and a valid email from the configured frontend origin. An expiring confirmation is emailed first. A deliberate confirmation POST adds the address to Mailgun. Link scanners cannot subscribe by GET alone.
- Confirmation tokens are stored as hashes. Pending addresses expire after 30 minutes and are removed by hourly cleanup. Consent timestamps are passed into Mailgun member variables. Rate keys are hashed and expire after an hour. No subscriber list is exposed publicly.
- A Postgres atomic claim prevents duplicate alert attempts across tabs, replicas, extensions and restarts. An HTTP rejection or uncertain delivery is **not automatically retried**. Inspect `watch_alert` and Mailgun logs before any manual recovery. A crash after claiming can leave `sending`; treat that as uncertain. There is no claim of exactly-once inbox delivery.
- Mailgun acceptance is not proof of inbox delivery. A send started while the timer is positive may arrive after the campaign closes. Campaign extensions can happen immediately after an observation.
- `GET /healthz` checks application/database readiness. `GET /api/status` reports source freshness, configuration readiness and alert status. There is deliberately no public endpoint that can trigger an alert or inject a timer.

## Development

Requires Node 22+ and Postgres. Run `npm ci`, `npm test`, and `npm run preview` for the static page on port 5174. With runtime variables configured, `npm start` runs the backend. Local browser setup: `npx playwright install chromium`. `npm run probe` reads the source once without importing any Mailgun code or sending emails.

The production Docker image includes Playwright Chromium. Package and image versions match. No secrets are included in the image or the public repository.
