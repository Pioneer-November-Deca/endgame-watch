export const CAMPAIGN_URL = 'https://gamefound.com/en/projects/mood-publishing/satisfactory-the-board-game/rewards';
export const CAMPAIGN_ID = 'satisfactory-the-board-game';
export const API_URL = `https://gamefound.com/api/public/projects/getCrowdfundingProject?urlName=${CAMPAIGN_ID}`;
export const THRESHOLD = 120;
export const FRESH_MS = 15_000;

export function shouldAlert(observation, now = Date.now()) {
  return observation?.sourceStatus === 'live' && Number.isInteger(observation.seconds)
    && observation.seconds > 0 && observation.seconds < THRESHOLD
    && Number.isSafeInteger(observation.observedAt)
    && now >= observation.observedAt && now - observation.observedAt <= FRESH_MS
    && observation.seconds - (now - observation.observedAt) / 1000 > 0
    && (observation.deadlineAt === undefined || (Number.isSafeInteger(observation.deadlineAt) && observation.deadlineAt > now && observation.deadlineAt - now < THRESHOLD * 1000));
}

export function publicObservation(row, now = Date.now()) {
  if (!row) return { sourceStatus: 'connecting', seconds: null, observedAt: null, serverTime: now };
  const observedAt = Number(row.observed_at);
  const fresh = Number.isSafeInteger(observedAt) && now >= observedAt && now - observedAt <= FRESH_MS;
  return { sourceStatus: fresh ? row.source_status : 'stale', seconds: fresh && row.source_status === 'live' ? row.seconds : null, observedAt, serverTime: now,
    source: row.source ?? null, deadlineAt: row.deadline_at == null ? null : Number(row.deadline_at), campaignEndDate: row.campaign_end_date ?? null, freshnessMs: FRESH_MS };
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}
