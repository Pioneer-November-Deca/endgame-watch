import { API_URL, CAMPAIGN_ID } from './domain.mjs';

export class SourceError extends Error {
  constructor(code, retryAfterMs = null) { super(code); this.code = code; this.retryAfterMs = retryAfterMs; }
}

export function apiObservation(project, { receivedAt, responseDate, age = null, elapsedMs = 0 }) {
  if (!project || project.projectUrlName !== CAMPAIGN_ID || project.creatorUrlName !== 'mood-publishing') throw new SourceError('wrong_campaign');
  const date = project.campaignEndDate;
  if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(date)) throw new SourceError('invalid_deadline');
  const deadline = Date.parse(date), sourceDate = Date.parse(responseDate);
  const ageSeconds = age === null ? 0 : Number(age);
  if (!Number.isFinite(deadline) || !Number.isFinite(sourceDate)) throw new SourceError('invalid_source_time');
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > 10 || (age !== null && !/^\d+$/.test(age))) throw new SourceError('stale_cache');
  if (!Number.isSafeInteger(receivedAt) || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 7000) throw new SourceError('slow_response');
  // Use Gamefound's clock rather than trusting the worker clock to be identical.
  // Date headers have one-second precision; include half the measured round trip.
  const sourceNow = sourceDate + ageSeconds * 1000 + Math.round(elapsedMs / 2);
  if (sourceNow < receivedAt - 15_000 || sourceNow > receivedAt + 30_000) throw new SourceError('source_clock_skew');
  const remainingMs = deadline - sourceNow;
  if (remainingMs > 366 * 86400_000) throw new SourceError('invalid_deadline');
  return { seconds: Math.max(0, Math.ceil(remainingMs / 1000)), sourceStatus: remainingMs > 0 ? 'live' : 'elapsed', observedAt: receivedAt,
    deadlineAt: receivedAt + remainingMs, campaignEndDate: date, source: 'gamefound-public-api' };
}

export async function fetchCampaign({ fetchImpl = fetch, now = Date.now, signal } = {}) {
  const startedAt = now();
  const response = await fetchImpl(API_URL, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store',
    redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000) });
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    const delay = retry === null ? null : /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - now());
    throw new SourceError(`http_${response.status}`, Number.isFinite(delay) ? Math.min(3600_000, Math.max(5000, delay)) : null);
  }
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new SourceError('invalid_content_type');
  let project; try { project = await response.json(); } catch { throw new SourceError('invalid_json'); }
  const receivedAt = now();
  return apiObservation(project, { receivedAt, responseDate: response.headers.get('date'), age: response.headers.get('age'), elapsedMs: receivedAt - startedAt });
}
