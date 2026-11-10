import { awakeAt,quietAt } from '../docs/regions.js';
export const COOLDOWN_MS=30*60_000;
export const PRESENCE_MS=45_000;
export const DAILY_TOTAL=90;
export const DAILY_FALLBACK=80;
export const DAILY_VERIFICATION=10;
export const WAVE_SPACING_MS=10*60_000;
export function refillCredits(credits,updatedAt,now){return Math.min(10,Math.max(0,Number(credits))+Math.max(0,now-Number(updatedAt))*DAILY_FALLBACK/86400_000);}
export function readyOnPage(member,now) { return member.state==='active'&&member.available&&!quietAt(member,now)&&Number(member.cooldown_until)<=now&&now-Number(member.last_seen_at)<PRESENCE_MS; }
export function emailEligible(member,now) { return member.state==='active'&&member.available&&member.email_verified&&member.email_consent&&!!member.email&&Number(member.cooldown_until)<=now&&awakeAt(member.timezone,now); }
export function compareQueue(a,b,now) {
  const readiness=Number(readyOnPage(b,now))-Number(readyOnPage(a,now));if(readiness)return readiness;
  const aPriority=readyOnPage(a,now)&&a.priority_order!=null,bPriority=readyOnPage(b,now)&&b.priority_order!=null;
  if(aPriority!==bPriority)return aPriority?-1:1;
  if(aPriority&&bPriority)return Number(a.priority_order)-Number(b.priority_order);
  return Number(a.queue_order)-Number(b.queue_order)||Number(a.seq)-Number(b.seq);
}
export function fallbackCapacity(rows,now) {
  const recent=rows.filter(r=>now-Number(r.reserved_at)<86400_000&&Number(r.reserved_at)<=now);
  const fallback=recent.filter(r=>r.kind==='fallback');
  if(fallback.some(r=>now-Number(r.reserved_at)<WAVE_SPACING_MS))return 0;
  return Math.max(0,Math.min(10,DAILY_TOTAL-recent.length,DAILY_FALLBACK-fallback.length));
}
