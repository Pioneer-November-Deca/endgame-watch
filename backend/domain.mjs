export const CAMPAIGN_URL = 'https://gamefound.com/en/projects/mood-publishing/satisfactory-the-board-game/rewards';
export const CAMPAIGN_ID = 'satisfactory-the-board-game';
export const SELECTOR = '[data-qa="project-summary:EndgameTimer"]';
export const THRESHOLD = 120;
export const FRESH_MS = 10_000;

// Require the entire text to consist of timer units. Never parse an error,
// loading state, partial string, or negative value as a valid countdown.
export function parseTimer(text) {
  if (typeof text !== 'string') return null;
  const input = text.trim().replace(/\u00a0/g, ' ');
  if (!input || /[-−]/.test(input)) return null;
  const units = { day: 86400, days: 86400, hour: 3600, hours: 3600, hr: 3600, hrs: 3600, minute: 60, minutes: 60, min: 60, mins: 60, second: 1, seconds: 1, sec: 1, secs: 1 };
  const pattern = /(\d+)\s*(days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
  let seconds = 0, found = false, end = 0;
  for (const match of input.matchAll(pattern)) {
    if (input.slice(end, match.index).trim()) return null;
    seconds += Number(match[1]) * units[match[2].toLowerCase()];
    found = true; end = match.index + match[0].length;
  }
  if (!found || input.slice(end).trim() || !Number.isSafeInteger(seconds) || seconds > 31_536_000) return null;
  return seconds;
}

export function shouldAlert(observation, now = Date.now()) {
  return observation?.sourceStatus === 'live' && Number.isInteger(observation.seconds)
    && observation.seconds > 0 && observation.seconds < THRESHOLD
    && Number.isSafeInteger(observation.observedAt)
    && now >= observation.observedAt && now - observation.observedAt <= FRESH_MS
    && observation.seconds - (now - observation.observedAt) / 1000 > 0;
}

export function publicObservation(row, now = Date.now()) {
  if (!row) return { sourceStatus: 'connecting', seconds: null, observedAt: null, serverTime: now };
  const observedAt = Number(row.observed_at);
  const fresh = Number.isSafeInteger(observedAt) && now >= observedAt && now - observedAt <= FRESH_MS;
  return { sourceStatus: fresh ? row.source_status : 'stale', seconds: fresh && row.source_status === 'live' ? row.seconds : null, observedAt, serverTime: now };
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}
