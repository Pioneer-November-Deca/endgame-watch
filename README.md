# Endgame Watch

A browser-based on-call queue for the Satisfactory Gamefound campaign. Public aliases identify participants; private random session tokens protect their controls. No personal author information is required.

## Run

Use Node 22 or newer. Run npm ci, configure DATABASE_URL and PUBLIC_ORIGIN, then npm start. The static frontend is in docs; docs/config.js selects the API. Run npm test for source, database, queue and HTTP checks.

## Watching shifts

Join with a public alias, enable browser alerts and start watching. There is no watcher-count limit. Each shift lasts 30 minutes. Start requests are idempotent and cannot silently extend an active shift. Watchers sort ahead of waiting entries and everybody sees the current watcher count and remaining shift times.

New participants default to Not watching. Expiry, stop/pass or 45 seconds offline end a shift and return the participant to Not watching. A heartbeat never automatically restores a lost shift. Explicitly starting again starts a shift immediately; there is no enforced cooldown.

Below five minutes (nine when ON_CALL_TEST_MODE=true), the first active watcher receives an alarm with ten seconds to respond. Snoozing or not responding returns that watcher to Not watching and cascades to the next active watcher. I’ll upgrade now grants a single buffer of up to thirty seconds, bounded by the shift and campaign deadline. The page stays red during the buffer. Without a clock reset, expiry returns the upgrader to Not watching and alerts the next watcher. A source-confirmed reset clears the cascade while remaining shifts continue. A server pulse evaluates deadlines every second and the browser refreshes every 1.5 seconds. New offers require a fresh Gamefound signal. Keep the page running; browser sleep and lost connectivity can prevent alarms.

Completion marks the entry permanently done and removes it from the queue. Leaving also removes it. Both revoke private sessions and return the SPA to the start. A named endgame_watch_session cookie remembers the session for up to 30 days; the URL has a private bookmark token. Leave queue and forget this session clears the cookie, legacy localStorage and URL. Keep bookmarks private.

Email is deprecated: no signup, API sends or worker delivery. Legacy tables and commented provider code are retained. The public site has no preview button; a local-development-only utility supports testing.

## Hosting

GitHub Pages serves docs; Railway hosts the API and PostgreSQL. The watcher polls Gamefound’s public campaign endpoint every five seconds and suppresses alarms for stale or invalid signals. Gamefound remains the source of truth.

Quiet hours and region selection are deprecated, commented out of the SPA and ignored by watcher eligibility. The preferences action returns 410. Public nextUp names the first watcher before the alarm and the selected upgrader during the cascade. All viewers see the low-clock red state; only the selected watcher receives sound/browser notifications and sees upgrade/snooze response controls. Everyone else sees the prominent Name — BUY NOW banner beside the clock and is asked to hold off. A missed turn is named publicly as the cascade moves forward. Only the selected watcher’s banner pulses, respecting reduced-motion preferences. Watchers return to blue on a confirmed source reset.

Selected watchers hear repeating groups of three short 880 Hz beeps (180 ms apart), with a pause between groups, for no longer than the ten-second offer. I will buy now and Pass stop audio immediately. Source reset, stale signal, timeout, off-watch status and loss of the turn cancel scheduled sounds. Browser notifications are sent once per turn.
