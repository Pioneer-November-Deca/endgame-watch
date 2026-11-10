# Endgame Watch

A browser-based on-call queue for the Satisfactory Gamefound campaign. Public aliases identify participants; private random session tokens protect their controls. No personal author information is required.

## Run

Use Node 22 or newer. Run npm ci, configure DATABASE_URL and PUBLIC_ORIGIN, then npm start. The static frontend is in docs; docs/config.js selects the API. Run npm test for source, database, queue and HTTP checks.

## Watching shifts

Join with a public alias, enable browser alerts and start watching. Up to five participants can watch simultaneously, enforced in one database transaction. Each shift lasts 30 minutes. Start requests are idempotent and cannot silently extend an active shift. Watchers sort ahead of waiting entries and everybody sees the current watcher count and remaining shift times.

New participants default to Not watching. Expiry, stop/pass, quiet hours or 45 seconds offline end a shift and return the participant to Not watching. A heartbeat never automatically restores a lost shift. Explicitly starting again takes an open spot immediately; there is no enforced cooldown.

All active watchers receive a private browser alarm below five minutes (nine when ON_CALL_TEST_MODE=true). A source-confirmed reset clears alarms while shifts continue. Marking an alarm seen silences it without ending a shift. Keep the page running; browser sleep and lost connectivity can prevent alarms.

Completion marks the entry permanently done and removes it from the queue. Leaving also removes it. Both revoke private sessions and return the SPA to the start. A named endgame_watch_session cookie remembers the session for up to 30 days; the URL has a private bookmark token. Leave queue and forget this session clears the cookie, legacy localStorage and URL. Keep bookmarks private.

Email is deprecated: no signup, API sends or worker delivery. Legacy tables and commented provider code are retained. The public site has no preview button; a local-development-only utility supports testing.

## Hosting

GitHub Pages serves docs; Railway hosts the API and PostgreSQL. The watcher polls Gamefound’s public campaign endpoint every five seconds and suppresses alarms for stale or invalid signals. Gamefound remains the source of truth.
