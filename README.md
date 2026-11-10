# Endgame Watch

A public, alias-only on-call queue for the Satisfactory Gamefound campaign. GitHub Pages serves the interface; Railway runs the API watcher, queue engine and private Postgres database. The web queue works without email. Mailgun is an optional, tightly budgeted fallback.

## Deployed destinations and privacy

- Public page: `https://pioneer-november-deca.github.io/endgame-watch/`
- Repository: `Pioneer-November-Deca/endgame-watch`
- Backend: `https://endgame-backend-production.up.railway.app`
- Services: `endgame-backend` and `Postgres` (database access stays private).
- Both Git author and committer must be `Endgame Watch <endgame-watch@users.noreply.github.com>`. Do not commit personal names, account emails, machine paths, local usernames, session tokens or credentials.

## Participant flow

1. Join with a unique public alias, region and exact time zone. Confirm that your one Endgame extension is still unused. Email is not required.
2. Mark yourself **Available now** and keep the page running. A heartbeat every ten seconds maintains presence; after 45 seconds without a heartbeat the page is treated as offline for new calls.
3. The queue displays changing ticket positions. Your own alias and private controls are highlighted. Other participants are shown by alias only; emails, exact time zones, session tokens and IP addresses are never in the public queue response.
4. Ready people are ordered by queue position. An available, online person can **Volunteer for the front**, ordered among volunteers by when they volunteered. This never displaces the active caller or bypasses cooldown.
5. Below five minutes remaining, elect one ready person. They have 15 seconds to acknowledge. Once acknowledged, they stand by; below two minutes they receive an action window of up to one minute, bounded by the reported deadline.
6. **Pass / move me back**, a missed acknowledgment, or an expired action window moves the person back with a 30-minute cooldown. Nonresponders stay members and return normally after cooldown; there are no response penalties, automatic pauses or per-person retry caps.
7. A qualifying extension of more than 30 seconds in the source deadline closes the round. Everyone called on the page or selected for fallback returns to the back with a 30-minute cooldown. A reset does not prove who acted.
8. **I used my extension — done** is a deliberate self-report that permanently removes that membership from future calls and fallback email for this campaign. Gamefound accounts are not linked, so this app cannot independently verify eligibility or attribute a reset.
9. **Leave queue & stop email** removes the public entry, clears its email, and invalidates pending email verification. The retained private session can explicitly rejoin. Completed memberships cannot rejoin.

Private 256-bit bearer sessions last 30 days and are stored as hashes in Postgres. The browser saves its token locally. The participant can copy a private access link to keep elsewhere; anyone holding it can control that entry. Email fallback links use separate single-use tokens, expiring after 24 hours, and require a deliberate button press to exchange for a private session. Email-verification links expire after 30 minutes and also require a deliberate confirmation. Tokens travel in URL fragments and are removed from the address bar before any exchange; they are never public queue identifiers.

## Critical email fallback

No mailing lists or campaign-wide broadcasts are used. Each recipient gets an individually addressed message.

Fallback is eligible only when a fresh API observation is positive and below two minutes, the round is at least 15 seconds old, and nobody has acknowledged the on-call role. Reserve up to ten of the next eligible people who have opted into availability and verified their email, are out of cooldown, have not already been called in the round, and are between **6 a.m. and midnight locally**. Page presence is not required for fallback; that is why it is a fallback. Explicit availability on the open page can override quiet hours for web calls, but fallback emails always respect local quiet hours.

Every recipient is rechecked against current membership and a second Gamefound API read before sending. A reset, acknowledgment, expired deadline, unavailable source or disabled configuration cancels the remaining wave. There is at most one fallback wave per round and at least ten minutes between waves across rounds. A persisted token bucket permits a burst of up to ten recipients and replenishes one recipient credit every 18 minutes (80/day), so repeated red flags cannot spend the whole daily budget immediately.

Database transactions reserve one email credit per recipient before any Mailgun call. All replicas and restarts share the ledger. Conservative rolling-24-hour limits are fixed at:

| Use | Maximum |
| --- | ---: |
| Critical fallback emails | 80 |
| Verification emails | 10 |
| All app emails combined | 90 |

This leaves ten messages below the standard Mailgun Free allowance of 100/day. The ledger includes rejected, cancelled and uncertain reservations; it does not automatically refund or retry them. It covers this app only, not other uses of the same Mailgun account. Verify the account's remaining allowance before enabling sending. Large web signup volume does not consume email credits. Verification is limited to ten emails/day and one request per participant per 15 minutes.

Set these **runtime variables in Railway only** to enable email:

- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`: verified sending access.
- `MAILGUN_REGION`: `US` or `EU`.
- `PUBLIC_SITE_URL`: `https://pioneer-november-deca.github.io/endgame-watch/`.
- `SIGNUPS_ENABLED=true`: enables optional email verification; web joins work independently.
- `ALERTS_ENABLED=true`: enables critical fallback sending.
- `RATE_LIMIT_SALT`: a random secret for stable abuse-rate hashes.

No mailing-list address or mailing-list write permission is needed. Keep both enabling flags false until configured and tested. Real inbox delivery was not tested during implementation and is not guaranteed. A message submitted before zero can arrive after a reset or after the campaign ends. The email links to the private queue, where the user can pass, complete, disable fallback or leave.

## Live source and deployment

The watcher reads Gamefound's [documented public project API](https://help.gamefound.com/article/425-gamefound-public-api) every five seconds:

`https://gamefound.com/api/public/projects/getCrowdfundingProject?urlName=satisfactory-the-board-game`

It follows `campaignEndDate`. Live tests showed extensions advancing this value and agreement with a freshly reloaded campaign page. It validates campaign identity, JSON, a timezone-qualified deadline, HTTP Date/Age metadata, response duration and clock skew. Missing, stale, failed, rate-limited or malformed responses suppress new elections and email. An elapsed source deadline closes the active round. The page polls the API and queue every three seconds; source observations older than 15 seconds are hidden. Page interpolation never sends an email or elects a caller.

Gamefound says its API data is briefly cached; the internal cache duration is unspecified. Responses can lag extensions. Browser suspension and network outages also affect availability. This app coordinates volunteers; it cannot guarantee the campaign stays alive.

The Node 22 Docker service needs `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `PUBLIC_ORIGIN=https://pioneer-november-deca.github.io`, `PORT=3000` and `NODE_ENV=production`. Keep Railway sleep/serverless disabled. The watcher holds an advisory lock; queue transitions, sessions and budget reservations use a separate transaction-scoped advisory lock. Startup migrations are additive and idempotent. Existing older tables remain unused.

GitHub Pages publishes `docs/` through the included Actions workflow. `docs/config.js` supplies the public backend URL; a repository variable `API_BASE_URL` can override it at publication. Keep the service connected to `main` and verify the deployed commit after a push.

## API and tests

- `GET /healthz`: application and database readiness.
- `GET /api/status`: source observation and configuration readiness.
- `GET /api/queue`: public aliases and positions; a bearer session additionally returns that participant's private controls.
- `POST /api/queue/join`: create an alias and private session.
- `POST /api/queue/heartbeat`, `/api/queue/action`: authenticated presence and participant actions.
- `POST /api/queue/email`, `/api/queue/verify-email`, `/api/queue/exchange`: optional email verification and private-link access.

Mutations require the allowed frontend origin. Private actions derive the affected member from the session, not an ID in the request body. Bodies are size-limited. New joins are rate-limited to five per IP hash/hour, 1,000 globally/hour and 2,000 active memberships. No raw IP is stored. Aliases are restricted to 3–24 safe characters and rendered as text. No public endpoint can inject a timer or trigger mail directly.

Run `npm ci` and `npm test` with Node 22+. Tests use in-memory PostgreSQL through PGlite and cover FIFO, competing elections, acknowledgment, resets, cooldown, requeueing, completion, session isolation, privacy, awake hours, email budgets, verification and access-token reuse. They send no real emails. `npm run preview` serves the frontend on port 5174; `PREVIEW_PORT` and `PREVIEW_API_BASE` can target an isolated local test backend. `npm run probe` remains a read-only Gamefound API check.
