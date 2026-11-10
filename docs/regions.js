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
