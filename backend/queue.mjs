import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { validAlias,validPreferences,validQuietSchedule,quietAt } from '../docs/regions.js';
import { readyOnPage,isWatching,compareQueue,WATCH_MS,RENEW_MS,PRESENCE_MS } from './queue-policy.mjs';
import { FIRST_ALERT_SECONDS, FAILSAFE_MS } from '../docs/alarm-policy.js';
import { FRESH_MS } from './domain.mjs';
const MAX_WATCHERS = 20;
const RESPONSE_MS = 15_000;
const hash=token=>createHash('sha256').update(token).digest('hex');
const secret=()=>randomBytes(32).toString('hex');
export function problem(message,status=400){return Object.assign(new Error(message),{status,publicMessage:message});}
export function createQueue({db,now=Date.now,onCallSeconds=FIRST_ALERT_SECONDS}) {
  async function transaction(work){const c=await db.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(74120913)');const out=await work(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async function session(token,c=db){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;const r=await c.query('SELECT m.* FROM q_session s JOIN q_member m ON m.id=s.member_id WHERE s.token_hash=$1 AND s.expires_at>$2',[hash(token),now()]);return r.rows[0]??null;}
  async function requireMember(token,c){const m=await session(token,c);if(!m)throw problem('Your private session is missing or expired. Join again.',401);return m;}
  async function issueSession(c,id){const token=secret();await c.query('INSERT INTO q_session(token_hash,member_id,expires_at) VALUES($1,$2,$3)',[hash(token),id,now()+30*86400_000]);return token;}
  async function stopWatching(c,id,reason='stopped'){await c.query("UPDATE q_member SET available=false,watch_until=0,watch_reason=$2,cooldown_until=0,priority_order=NULL,queue_order=nextval('q_order_seq') WHERE id=$1",[id,reason]);await c.query("UPDATE q_call SET status='passed' WHERE member_id=$1 AND status IN ('offered','acknowledged')",[id]);}
  function validTab(tabId){return typeof tabId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(tabId);}
  async function trackPresence(c,id,tabId){if(tabId===undefined)tabId='00000000-0000-0000-0000-000000000000';if(!validTab(tabId))throw problem('Invalid browser tab identifier.');await c.query('INSERT INTO q_presence(member_id,tab_id,seen_at,closed_at) VALUES($1,$2,$3,NULL) ON CONFLICT(member_id,tab_id) DO UPDATE SET seen_at=EXCLUDED.seen_at,closed_at=NULL',[id,tabId,now()]);await c.query('UPDATE q_member SET last_seen_at=$1 WHERE id=$2',[now(),id]);}
  async function expireWatchers(c){const members=(await c.query("SELECT * FROM q_member WHERE state='active' AND available=true")).rows;const tabsByMember=new Map();if(members.length){const rows=(await c.query("SELECT p.member_id,p.seen_at,p.closed_at FROM q_presence p JOIN q_member m ON m.id=p.member_id WHERE m.state='active' AND m.available=true")).rows;for(const t of rows){if(!tabsByMember.has(t.member_id))tabsByMember.set(t.member_id,[]);tabsByMember.get(t.member_id).push(t);}}for(const m of members){if(!isWatching(m,now())){await stopWatching(c,m.id,'renewal-missed');continue;}const tabs=tabsByMember.get(m.id)||[];if(tabs.length){const open=tabs.some(t=>t.closed_at==null&&now()-Number(t.seen_at)<PRESENCE_MS),closing=tabs.some(t=>t.closed_at!=null&&now()-Number(t.closed_at)<5000);if(!open&&!closing)await stopWatching(c,m.id,tabs.some(t=>t.closed_at!=null)?'page-closed':'disconnected');}else if(now()-Number(m.last_seen_at)>=PRESENCE_MS)await stopWatching(c,m.id,'disconnected');}}
  async function disconnect(token,tabId){if(!validTab(tabId))throw problem('Invalid browser tab identifier.');return transaction(async c=>{const member=await requireMember(token,c);await c.query('UPDATE q_presence SET closed_at=$1 WHERE member_id=$2 AND tab_id=$3',[now(),member.id,tabId]);const open=(await c.query('SELECT 1 FROM q_presence WHERE member_id=$1 AND closed_at IS NULL AND seen_at>$2 LIMIT 1',[member.id,now()-PRESENCE_MS])).rows.length;if(!open)await c.query('UPDATE q_member SET last_seen_at=$1 WHERE id=$2',[now()-PRESENCE_MS,member.id]);return {ok:true};});}
  async function finishCall(c,call){if(call.status==='offered'){await stopWatching(c,call.member_id,'missed-alarm');await c.query("UPDATE q_call SET status='expired' WHERE id=$1",[call.id]);}else{await c.query("UPDATE q_call SET status='buffer-ended' WHERE id=$1",[call.id]);await c.query("UPDATE q_member SET queue_order=nextval('q_order_seq') WHERE id=$1",[call.member_id]);}}
  async function closeRound(c,round,status){await c.query('UPDATE q_round SET status=$1 WHERE id=$2',[status,round.id]);await c.query("UPDATE q_call SET status=$1 WHERE round_id=$2 AND status IN ('offered','acknowledged')",[status,round.id]);}
  async function join({alias,region='us-east',timezone='America/New_York'}){
    if(!validAlias(alias))throw problem('Choose an alias of 3–24 letters, numbers, spaces, underscores or hyphens.');
    if(!validPreferences(region,timezone))throw problem('Choose a listed region and time zone.');
    return transaction(async c=>{const count=await c.query("SELECT count(*)::int AS count FROM q_member WHERE state='active'");if(count.rows[0].count>=2000)throw problem('The queue is currently full.',429);if((await c.query('SELECT 1 FROM q_member WHERE alias_key=$1',[alias.trim().toLowerCase()])).rows.length)throw problem('That alias is already taken. Please choose another.',409);const id=randomUUID();await c.query('INSERT INTO q_member(id,alias,alias_key,region,timezone,created_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$6)',[id,alias.trim(),alias.trim().toLowerCase(),region,timezone,now()]);return {token:await issueSession(c,id),id,message:'You joined. Start watching when you’re ready.'};});
  }
  async function heartbeat(token,tabId){return transaction(async c=>{await expireWatchers(c);const member=await requireMember(token,c);await trackPresence(c,member.id,tabId);await c.query('UPDATE q_member SET last_seen_at=$1 WHERE id=$2',[now(),member.id]);return {ok:true};});}
  async function action(token,action,data={}){return transaction(async c=>{
    await expireWatchers(c);const member=await requireMember(token,c);if(member.state!=='active')throw problem('This queue entry is no longer active.');await trackPresence(c,member.id,data.tabId);
    if(action==='available'){
      if(data.available===true){
        if(!isWatching(member,now())){
          const {rows:[{count}]}=await c.query("SELECT count(*)::int AS count FROM q_member WHERE state='active' AND available=true");
          if(count>=MAX_WATCHERS)throw problem('All '+MAX_WATCHERS+' watch spots are full. Try again when a spot opens.',409);
          await c.query("DELETE FROM q_touch WHERE member_id=$1 AND round_id IN (SELECT id FROM q_round WHERE status='active')",[member.id]);await c.query("UPDATE q_member SET available=true,watch_until=$1,last_seen_at=$2,watch_reason=NULL,cooldown_until=0,priority_order=NULL,queue_order=nextval('q_order_seq') WHERE id=$3",[now()+WATCH_MS,now(),member.id]);}
      }else await stopWatching(c,member.id);
    }else if(action==='renew'){
      if(!isWatching(member,now()))throw problem('Your renewal window ended. Press Start watching to rejoin.');
      if(Number(member.watch_until)<=now())await c.query('UPDATE q_member SET watch_until=$1,last_seen_at=$2,watch_reason=NULL WHERE id=$3',[now()+WATCH_MS,now(),member.id]);
    }else if(action==='pass')await stopWatching(c,member.id);
    else if(action==='ack'){
      if(!isWatching(member,now()))throw problem('Start watching before acknowledging an alarm.');
      const signal=(await c.query('SELECT source_status,observed_at,deadline_at,campaign_end_date FROM watch_observation LIMIT 1')).rows[0];if(!signal||signal.source_status!=='live'||now()-Number(signal.observed_at)>FRESH_MS||Number(signal.deadline_at)<=now())throw problem('A fresh live campaign signal is required.');
      const call=(await c.query("SELECT c.*,r.source_deadline FROM q_call c JOIN q_round r ON r.id=c.round_id WHERE c.member_id=$1 AND c.status IN ('offered','acknowledged') AND r.status='active' LIMIT 1",[member.id])).rows[0];
      if(!call||call.status!=='offered'||Number(call.respond_by)<=now())throw problem('The 15-second response window has ended. The next watcher will be alerted.');
      if(Number(signal.deadline_at)>now()+onCallSeconds*1000||Date.parse(signal.campaign_end_date)-Number(call.source_deadline)>30000)throw problem('The campaign clock changed. Wait for the live queue to update.');
      await c.query("UPDATE q_call SET status='acknowledged',act_by=$1 WHERE id=$2",[Math.min(now()+30_000,Number(signal.deadline_at)),call.id]);
    }else if(action==='complete'||action==='leave'){
      const finishing=action==='complete'?(await c.query("SELECT * FROM q_call WHERE member_id=$1 AND status IN ('offered','acknowledged') LIMIT 1",[member.id])).rows[0]:null;await stopWatching(c,member.id);if(finishing)await c.query("UPDATE q_call SET status='completed',act_by=$1 WHERE id=$2",[Number(finishing.act_by)||now()+5000,finishing.id]);await c.query('UPDATE q_member SET state=$1,email=NULL,email_consent=false,email_verified=false WHERE id=$2',[action==='complete'?'completed':'left',member.id]);await c.query('DELETE FROM q_email_verify WHERE member_id=$1',[member.id]);await c.query('DELETE FROM q_session WHERE member_id=$1',[member.id]);
    }else if(action==='preferences'){throw problem('Quiet hours are deprecated. Start or stop watching directly.',410);
    }else throw problem('Unknown queue action.');
    return {ok:true};
  });}
  async function tick(observation){return transaction(async c=>{
    await expireWatchers(c);let round=(await c.query("SELECT * FROM q_round WHERE status='active' LIMIT 1")).rows[0];const fresh=observation?.sourceStatus==='live'&&now()>=observation.observedAt&&now()-observation.observedAt<=FRESH_MS&&observation.deadlineAt>now();if(!fresh){if(observation?.sourceStatus==='elapsed'&&round)await closeRound(c,round,'elapsed');else if(round){const calls=(await c.query("SELECT * FROM q_call WHERE round_id=$1 AND status IN ('offered','acknowledged')",[round.id])).rows;for(const call of calls)if((call.status==='offered'?Number(call.respond_by):Number(call.act_by))<=now()){await finishCall(c,call);}}return [];}
    const deadline=Date.parse(observation.campaignEndDate);if(!Number.isFinite(deadline))return [];if(round&&deadline-Number(round.source_deadline)>30_000){await closeRound(c,round,'reset');round=null;}
    if(!round&&observation.deadlineAt-now()<=onCallSeconds*1000){round={id:randomUUID(),started_at:now(),source_deadline:deadline};await c.query('INSERT INTO q_round(id,started_at,source_deadline) VALUES($1,$2,$3)',[round.id,now(),deadline]);}if(!round)return [];
    if (observation.deadlineAt - now() <= FAILSAFE_MS) {
      // The browser alerts all active watchers in the final stretch.
      await c.query("UPDATE q_call SET status='superseded' WHERE round_id=$1 AND status IN ('offered','acknowledged')", [round.id]);
      return [];
    }
    // Serial cascade: one offer, fifteen seconds to react, then a thirty-second upgrade buffer.
    let call=(await c.query("SELECT * FROM q_call WHERE round_id=$1 AND status IN ('offered','acknowledged') ORDER BY offered_at,id",[round.id])).rows;
    // Compatibility with the previous broadcast version: retire any extra active offers.
    for(const extra of call.slice(1))await c.query("UPDATE q_call SET status='superseded' WHERE id=$1",[extra.id]);
    call=call[0];
    if(call&&call.status==='offered'&&Number(call.respond_by)>Number(call.offered_at)+RESPONSE_MS){call.respond_by=Number(call.offered_at)+RESPONSE_MS;await c.query('UPDATE q_call SET respond_by=$1 WHERE id=$2',[call.respond_by,call.id]);}
    if(call){const expired=call.status==='offered'?Number(call.respond_by)<=now():!call.act_by||Number(call.act_by)<=now();if(expired){await finishCall(c,call);call=null;}}
    if(call)return [];
    if((await c.query("SELECT 1 FROM q_call WHERE round_id=$1 AND status='completed' AND act_by>$2 LIMIT 1",[round.id,now()])).rows.length)return [];
    const touched=new Set((await c.query('SELECT member_id FROM q_touch WHERE round_id=$1',[round.id])).rows.map(m=>m.member_id));
    const watchers=(await c.query("SELECT * FROM q_member WHERE state='active' AND available=true")).rows.filter(m=>readyOnPage(m,now())).sort((a,b)=>compareQueue(a,b,now()));
    const next=watchers.find(m=>!touched.has(m.id));
    if(next){await c.query("INSERT INTO q_call(id,round_id,member_id,offered_at,respond_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(round_id,member_id) DO UPDATE SET id=EXCLUDED.id,status='offered',offered_at=EXCLUDED.offered_at,respond_by=EXCLUDED.respond_by,act_by=NULL",[randomUUID(),round.id,next.id,now(),Math.min(now()+RESPONSE_MS,observation.deadlineAt)]);await c.query("INSERT INTO q_touch(round_id,member_id,channel) VALUES($1,$2,'page') ON CONFLICT DO NOTHING",[round.id,next.id]);}
    // Email fallback is deprecated: no reservations or outbound delivery.
    return [];
  });}
  function memberView(me){
    return me?{id:me.id,alias:me.alias,region:me.region,timezone:me.timezone,state:me.state,available:isWatching(me,now()),watchUntil:Number(me.watch_until),renewBy:Number(me.watch_until)+RENEW_MS,renewalDue:isWatching(me,now())&&Number(me.watch_until)<=now(),watchReason:me.watch_reason,cooldownUntil:0,quietEnabled:me.quiet_enabled,quietStart:Number(me.quiet_start),quietEnd:Number(me.quiet_end),quiet:false}:null;
  }
  async function snapshot(token){
    await transaction(expireWatchers);const [members,rounds,me]=await Promise.all([db.query("SELECT * FROM q_member WHERE state='active'"),db.query("SELECT * FROM q_round WHERE status='active' LIMIT 1"),session(token)]);const round=rounds.rows[0];const call=round?(await db.query("SELECT * FROM q_call WHERE round_id=$1 AND status IN ('offered','acknowledged') ORDER BY offered_at,id LIMIT 1",[round.id])).rows[0]:null;
    const list=members.rows.sort((a,b)=>compareQueue(a,b,now())).map((m,i)=>({id:m.id,alias:m.alias,position:i+1,available:isWatching(m,now()),online:now()-Number(m.last_seen_at)<PRESENCE_MS,ready:readyOnPage(m,now()),quiet:false,cooldownUntil:0,volunteered:false,onCall:isWatching(m,now()),watchUntil:Number(m.watch_until),renewBy:Number(m.watch_until)+RENEW_MS,renewalDue:isWatching(m,now())&&Number(m.watch_until)<=now(),alertStatus:m.id===call?.member_id?call.status:null}));
    const touched=round?new Set((await db.query('SELECT member_id FROM q_touch WHERE round_id=$1',[round.id])).rows.map(m=>m.member_id)):new Set();const next=call?list.find(m=>m.id===call.member_id):list.find(m=>m.ready&&!touched.has(m.id));const missed=round?(await db.query("SELECT m.alias,c.respond_by,c.act_by,c.offered_at FROM q_call c JOIN q_member m ON m.id=c.member_id WHERE c.round_id=$1 AND c.status='expired' ORDER BY c.offered_at DESC LIMIT 1",[round.id])).rows[0]:null;
    const ordered=(call?[list.find(m=>m.id===call.member_id),...list.filter(m=>m.ready&&m.id!==call.member_id&&!touched.has(m.id))]:list.filter(m=>m.ready&&!touched.has(m.id))).filter(Boolean).slice(0,3).map((m,i)=>({memberId:m.id,alias:m.alias,position:i+1,status:i===0&&call?call.status:'next'}));
    return {upgradeOrder:ordered,lastMissed:missed?{alias:missed.alias,at:Number(missed.act_by||missed.respond_by)}:null,nextUp:next?{memberId:next.id,alias:next.alias,status:call?.status||'next'}:null,rows:list,total:list.length,watchingCount:list.filter(m=>m.onCall).length,maxWatchers:MAX_WATCHERS,shiftMs:WATCH_MS,renewalMs:RENEW_MS,serverTime:now(),round:round?{id:round.id,startedAt:Number(round.started_at),sourceDeadline:Number(round.source_deadline)}:null,call:call?{id:call.id,memberId:call.member_id,status:call.status,respondBy:Number(call.respond_by),actBy:call.act_by==null?null:Number(call.act_by)}:null,me:memberView(me)};
  }
  return {join,heartbeat,disconnect,action,tick,snapshot,session,memberView,onCallSeconds};
}
