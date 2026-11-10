# Endgame Watch

A browser-based on-call queue for the Satisfactory Gamefound campaign. Public aliases identify participants; private random session tokens protect their controls. No personal author information is required.

## Run

Use Node 22 or newer. Run npm ci, configure DATABASE_URL and PUBLIC_ORIGIN, then npm start. The static frontend is in docs; docs/config.js selects the API. Run npm test for source, database, queue and HTTP checks.

## Watching shifts

Join with a public alias, enable browser alerts and start watching. A dismissible preparation dialog links to Gamefound and asks participants to prepare their cart or pledge change in another tab. Got it starts the shift; Close cancels it. There is no watcher-count limit. Each shift lasts 30 minutes, followed by a 60-second renewal window. Start requests are idempotent and cannot silently extend an active shift. Watchers sort ahead of waiting entries and everybody sees the current watcher count and remaining shift times.

New participants default to Not watching. Missing a ten-second alarm or the sixty-second renewal window returns a watcher to Not watching with a private reason explaining how to rejoin. Stop/pass is voluntary. Each open page sends a tab-scoped heartbeat every ten seconds. Closing the last tab sends a best-effort pagehide beacon; watch status clears after a five-second refresh grace period. Missing heartbeats clear watch status after 45 seconds if a close signal cannot be delivered. Another open tab preserves watching, and returning after expiry never automatically rejoins. Heartbeats do not renew a shift. Explicitly starting again starts a shift immediately; there is no enforced cooldown.

Below five minutes (nine when ON_CALL_TEST_MODE=true), the first active watcher receives an alarm with ten seconds to respond. Snoozing or not responding returns that watcher to Not watching and cascades to the next active watcher. I will buy now grants a single buffer of up to thirty seconds, bounded by the campaign deadline. The page stays red during the buffer. Without a clock reset, buffer expiry passes the turn to the next watcher while keeping the acknowledged upgrader on watch. A source-confirmed reset clears the cascade while remaining shifts continue. A server pulse evaluates deadlines every second and the browser refreshes every 1.5 seconds. New offers require a fresh Gamefound signal. Keep the page running; browser sleep and lost connectivity can prevent alarms.

Completion marks the entry permanently done and removes it from the queue. Leaving also removes it. Both revoke private sessions and return the SPA to the start. A named endgame_watch_session cookie remembers the session for up to 30 days; the URL has a private bookmark token. Leave queue and forget this session clears the cookie, legacy localStorage and URL. Keep bookmarks private.

Email is deprecated: no signup, API sends or worker delivery. Legacy tables and commented provider code are retained. The public site has no preview button; a local-development-only utility supports testing.

## Hosting

GitHub Pages serves docs; Railway hosts the API and PostgreSQL. The watcher polls Gamefound’s public campaign endpoint every five seconds and suppresses alarms for stale or invalid signals. Gamefound remains the source of truth.

Quiet hours and region selection are deprecated, commented out of the SPA and ignored by watcher eligibility. The preferences action returns 410. Public nextUp names the first watcher before the alarm and the selected upgrader during the cascade. Only the selected watcher sees the red theme, focused alarm modal, pulsing emphasis and sound/browser notifications. Other watchers stay blue and passive participants stay in the default theme. Everyone sees the first three eligible watchers in numbered order directly below the clock: next to buy, on deck and backup. The list follows the actual cascade, excludes offline/pending-renewal watchers and never repeats the current caller. Backup watchers receive no visual or audible alarm until their own turn. A missed turn is named publicly as the cascade moves forward. The selected watcher’s large alarm dialog traps focus above a 50% black backdrop. Watchers return to blue on a confirmed source reset.

Selected watchers hear repeating groups of three short 880 Hz beeps (180 ms apart), with a pause between groups, for no longer than the ten-second offer. I will buy now and Pass stop audio immediately. Source reset, stale signal, timeout, off-watch status and loss of the turn cancel scheduled sounds. Browser notifications are sent once per turn.

At thirty minutes, Are you still watching? appears in a focused modal with a sixty-second countdown. Start watching for another 30 minutes renews from the confirmation time and preserves queue order. Alarm dialogs take priority over renewal dialogs when both apply. Completion uses its own accessible dialog so confirmation remains usable above the alarm backdrop.

The personal card displays the live number of other active watchers, never a ticket denominator. The participant list explicitly includes passive entries. Private page-close beacons carry the session token in a POST body, never a URL, and require the approved origin.
