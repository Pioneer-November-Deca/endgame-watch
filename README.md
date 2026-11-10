# Endgame Watch

A browser-based on-call queue for the Satisfactory Gamefound campaign. Public aliases identify participants; private random session tokens protect their controls. No personal author information is required.

## Run

Use Node 22 or newer. Run npm ci, configure DATABASE_URL and PUBLIC_ORIGIN, then npm start. The static frontend is in docs; docs/config.js selects the API. Run npm test for source, database, queue and HTTP checks.

## Watching shifts

Join with a public alias, enable browser alerts and start watching. Up to five participants can watch simultaneously, enforced in one database transaction. Each shift lasts 30 minutes. Start requests are idempotent and cannot silently extend an active shift. Watchers sort ahead of waiting entries and everybody sees the current watcher count and remaining shift times.

New participants default to Not watching. Expiry, stop/pass, quiet hours or 45 seconds offline end a shift and return the participant to Not watching. A heartbeat never automatically restores a lost shift. Explicitly starting again takes an open spot immediately; there is no enforced cooldown.

Below five minutes (nine when ON_CALL_TEST_MODE=true), the first active watcher receives an alarm with ten seconds to respond. Snoozing or not responding returns that watcher to Not watching and cascades to the next active watcher. I’ll upgrade now grants a single buffer of up to thirty seconds, bounded by the shift and campaign deadline. The page stays red during the buffer. Without a clock reset, expiry returns the upgrader to Not watching and alerts the next watcher. A source-confirmed reset clears the cascade while remaining shifts continue. A server pulse evaluates deadlines every second and the browser refreshes every 1.5 seconds. New offers require a fresh Gamefound signal. Keep the page running; browser sleep and lost connectivity can prevent alarms.

Completion marks the entry permanently done and removes it from the queue. Leaving also removes it. Both revoke private sessions and return the SPA to the start. A named endgame_watch_session cookie remembers the session for up to 30 days; the URL has a private bookmark token. Leave queue and forget this session clears the cookie, legacy localStorage and URL. Keep bookmarks private.

Email is deprecated: no signup, API sends or worker delivery. Legacy tables and commented provider code are retained. The public site has no preview button; a local-development-only utility supports testing.

## Hosting

GitHub Pages serves docs; Railway hosts the API and PostgreSQL. The watcher polls Gamefound’s public campaign endpoint every five seconds and suppresses alarms for stale or invalid signals. Gamefound remains the source of truth.
