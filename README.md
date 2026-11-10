# Endgame Watch

A browser-based on-call queue for the Satisfactory Gamefound campaign. Public aliases identify participants; private random session tokens protect their controls. No personal author information is required.

## Run

Use Node 22 or newer. Run npm ci, configure DATABASE_URL and PUBLIC_ORIGIN, then npm start. The static frontend is in docs; docs/config.js selects the API. Run npm test for source, database, queue and HTTP checks.

## Browser alerts

The first ready participant is called below five minutes and has 15 seconds to acknowledge. Acknowledged duty has no fixed timeout. Browser sound and notifications require enabling them in the open tab. Acknowledgment silences the full-page red alarm. A source-confirmed reset clears the round and returns called participants to the back with a 30-minute cooldown. Nonresponders receive the same passive cooldown and remain in the queue. Explicitly choosing Go on call clears cooldown and makes them eligible again, even in the same round. Only confirmed completion or leaving ends participation.

ON_CALL_TEST_MODE=true temporarily changes the election/alarm threshold to nine minutes. The page labels test mode and offers a local-development-only red-alarm utility; no public participant preview is shown. Set false to restore five minutes.

Quiet hours are editable in the participant’s time zone, including daylight-saving changes, and automatically exclude calls. Available participants return after quiet hours if they keep their page online. Browser sleep, closing the page and network interruptions can prevent alarms.

Joining automatically creates a bookmarkable hash route containing an alias and private session credential. The alias grants no access. Sessions are saved in the clearable endgame_watch_session cookie in this browser and expire after 30 days. Anyone with the private bookmark can control the entry; keep it private. Hash routing works on GitHub Pages without a server rewrite.

## Deprecated email

Email is unsuitable for instant on-call alerts. Its UI and legacy delivery implementation are commented out, all email routes return 410, and the worker cannot dispatch mail even if old provider settings remain. Legacy database tables are retained to avoid destructive migrations.

## Hosting

GitHub Actions publishes docs to GitHub Pages. Railway hosts the continuously polling API and PostgreSQL. The watcher reads Gamefound’s official public campaign endpoint every five seconds and fails closed on stale or invalid samples. API data can briefly lag an extension; Gamefound remains the source of truth.

Completion permanently marks the entry done, revokes its sessions and returns the SPA to the starting view. Leaving removes the entry and revokes its private bookmarks, clears the named cookie and legacy localStorage, and clears the URL. Go off call only pauses availability.
