export const REGIONS = [
  { id:'us-east', label:'U.S. East Coast', zones:['America/New_York'] },
  { id:'us-midwest', label:'U.S. Midwest', zones:['America/Chicago','America/Indiana/Indianapolis','America/Denver'] },
  { id:'us-west', label:'U.S. West Coast', zones:['America/Los_Angeles','America/Anchorage','Pacific/Honolulu'] },
  { id:'europe', label:'Europe', zones:['Europe/London','Europe/Berlin','Europe/Helsinki','Atlantic/Reykjavik','Europe/Istanbul'] },
  { id:'australia', label:'Australia', zones:['Australia/Sydney','Australia/Brisbane','Australia/Adelaide','Australia/Darwin','Australia/Perth'] },
  { id:'asia-pacific', label:'Asia Pacific', zones:['Asia/Singapore','Asia/Tokyo','Asia/Seoul','Asia/Hong_Kong','Asia/Kolkata','Asia/Bangkok','Asia/Manila','Pacific/Auckland'] }
];
export function validPreferences(region,timezone) { return REGIONS.some(r=>r.id===region&&r.zones.includes(timezone)); }
export function awakeAt(timezone,now=Date.now()) {
  try { const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',hourCycle:'h23'}).format(new Date(now)));return hour>=6&&hour<24; }
  catch { return false; }
}
export function validAlias(value) { return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9 _-]{2,23}$/.test(value.trim())&&!['admin','system','you','moderator'].includes(value.trim().toLowerCase()); }

export function validQuietSchedule(enabled,start,end){return typeof enabled==='boolean'&&Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&start<1440&&end>=0&&end<1440&&(!enabled||start!==end);}
export function quietAt(member,now){if(!member.quiet_enabled)return false;const parts=new Intl.DateTimeFormat('en-GB',{timeZone:member.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);const value=type=>Number(parts.find(p=>p.type===type).value);const minutes=value('hour')*60+value('minute'),start=Number(member.quiet_start),end=Number(member.quiet_end);return start<end?minutes>=start&&minutes<end:minutes>=start||minutes<end;}
