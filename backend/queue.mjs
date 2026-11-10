import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { validAlias,validPreferences,validQuietSchedule,quietAt } from '../docs/regions.js';
import { readyOnPage,compareQueue,WATCH_MS,MAX_WATCHERS,PRESENCE_MS } from './queue-policy.mjs';
import { FRESH_MS } from './domain.mjs';
const hash=token=>createHash('sha256').update(token).digest('hex');
const secret=()=>randomBytes(32).toString('hex');
export function problem(message,status=400){return Object.assign(new Error(message),{status,publicMessage:message});}
export function createQueue({db,now=Date.now,onCallSeconds=300}) {
  async function transaction(work){const c=await db.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(74120913)');const out=await work(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async function session(token,c=db){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;const r=await c.query('SELECT m.* FROM q_session s JOIN q_member m ON m.id=s.member_id WHERE s.token_hash=$1 AND s.expires_at>$2',[hash(token),now()]);return r.rows[0]??null;}
  async function requireMember(token,c){const m=await session(token,c);if(!m)throw problem('Your private session is missing or expired. Join again.',401);return m;}
  async function issueSession(c,id){const token=secret();await c.query('INSERT INTO q_session(token_hash,member_id,expires_at) VALUES($1,$2,$3)',[hash(token),id,now()+30*86400_000]);return token;}
  async function stopWatching(c,id){await c.query("UPDATE q_member SET available=false,watch_until=0,cooldown_until=0,priority_order=NULL,queue_order=nextval('q_order_seq') WHERE id=$1",[id]);await c.query("UPDATE q_call SET status='passed' WHERE member_id=$1 AND status IN ('offered','acknowledged')",[id]);}
  async function expireWatchers(c){const members=(await c.query("SELECT * FROM q_member WHERE state='active' AND available=true")).rows;for(const m of members)if(!readyOnPage(m,now()))await stopWatching(c,m.id);}
  async function closeRound(c,round,status){await c.query('UPDATE q_round SET status=$1 WHERE id=$2',[status,round.id]);await c.query("UPDATE q_call SET status=$1 WHERE round_id=$2 AND status IN ('offered','acknowledged')",[status,round.id]);}
  async function join({alias,region,timezone}){
    if(!validAlias(alias))throw problem('Choose an alias of 3–24 letters, numbers, spaces, underscores or hyphens.');
    if(!validPreferences(region,timezone))throw problem('Choose a listed region and time zone.');
    return transaction(async c=>{const count=await c.query("SELECT count(*)::int AS count FROM q_member WHERE state='active'");if(count.rows[0].count>=2000)throw problem('The queue is currently full.',429);if((await c.query('SELECT 1 FROM q_member WHERE alias_key=$1',[alias.trim().toLowerCase()])).rows.length)throw problem('That alias is already taken. Please choose another.',409);const id=randomUUID();await c.query('INSERT INTO q_member(id,alias,alias_key,region,timezone,created_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$6)',[id,alias.trim(),alias.trim().toLowerCase(),region,timezone,now()]);return {token:await issueSession(c,id),id,message:'You joined. Start watching when you’re ready.'};});
  }
  async function heartbeat(token){return transaction(async c=>{await expireWatchers(c);const member=await requireMember(token,c);await c.query('UPDATE q_member SET last_seen_at=$1 WHERE id=$2',[now(),member.id]);return {ok:true};});}
  async function action(token,action,data={}){return transaction(async c=>{
    await expireWatchers(c);const member=await requireMember(token,c);if(member.state!=='active')throw problem('This queue entry is no longer active.');
    if(action==='available'){
      if(data.available===true){
        if(quietAt(member,now()))throw problem('Your quiet hours are active. Change quiet hours before starting a shift.');
        if(!readyOnPage(member,now())){const count=(await c.query("SELECT count(*)::int AS count FROM q_member WHERE state='active' AND available=true")).rows[0].count;if(count>=MAX_WATCHERS)throw problem('Five people are already watching. Join when a spot opens.',409);await c.query("UPDATE q_member SET available=true,watch_until=$1,last_seen_at=$2,cooldown_until=0,priority_order=NULL,queue_order=nextval('q_order_seq') WHERE id=$3",[now()+WATCH_MS,now(),member.id]);}
      }else await stopWatching(c,member.id);
    }else if(action==='pass')await stopWatching(c,member.id);
    else if(action==='ack'){
      if(!readyOnPage(member,now()))throw problem('Start watching before acknowledging an alarm.');
      const signal=(await c.query('SELECT source_status,observed_at,deadline_at FROM watch_observation LIMIT 1')).rows[0];if(!signal||signal.source_status!=='live'||now()-Number(signal.observed_at)>FRESH_MS||Number(signal.deadline_at)<=now())throw problem('A fresh live campaign signal is required.');
      await c.query("UPDATE q_call SET status='acknowledged' WHERE member_id=$1 AND status='offered'",[member.id]);
    }else if(action==='complete'||action==='leave'){
      await stopWatching(c,member.id);await c.query('UPDATE q_member SET state=$1,email=NULL,email_consent=false,email_verified=false WHERE id=$2',[action==='complete'?'completed':'left',member.id]);await c.query('DELETE FROM q_email_verify WHERE member_id=$1',[member.id]);await c.query('DELETE FROM q_session WHERE member_id=$1',[member.id]);
    }else if(action==='preferences'){
      if(!validPreferences(data.region,data.timezone))throw problem('Choose a listed region and time zone.');const enabled=data.quietEnabled??member.quiet_enabled,start=data.quietStart??Number(member.quiet_start),end=data.quietEnd??Number(member.quiet_end);if(!validQuietSchedule(enabled,start,end))throw problem('Choose different quiet-hour start and end times.');await c.query('UPDATE q_member SET region=$1,timezone=$2,quiet_enabled=$3,quiet_start=$4,quiet_end=$5 WHERE id=$6',[data.region,data.timezone,enabled,start,end,member.id]);await expireWatchers(c);
    }else throw problem('Unknown queue action.');
    return {ok:true};
  });}
  async function tick(observation){return transaction(async c=>{
    await expireWatchers(c);let round=(await c.query("SELECT * FROM q_round WHERE status='active' LIMIT 1")).rows[0];const fresh=observation?.sourceStatus==='live'&&now()>=observation.observedAt&&now()-observation.observedAt<=FRESH_MS&&observation.deadlineAt>now();if(!fresh){if(observation?.sourceStatus==='elapsed'&&round)await closeRound(c,round,'elapsed');return [];}
    const deadline=Date.parse(observation.campaignEndDate);if(!Number.isFinite(deadline))return [];if(round&&deadline-Number(round.source_deadline)>30_000){await closeRound(c,round,'reset');round=null;}
    if(!round&&observation.seconds<onCallSeconds){round={id:randomUUID(),started_at:now(),source_deadline:deadline};await c.query('INSERT INTO q_round(id,started_at,source_deadline) VALUES($1,$2,$3)',[round.id,now(),deadline]);}if(!round)return [];
    const watchers=(await c.query("SELECT * FROM q_member WHERE state='active' AND available=true")).rows.filter(m=>readyOnPage(m,now()));
    for(const m of watchers)await c.query("INSERT INTO q_call(id,round_id,member_id,offered_at,respond_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(round_id,member_id) DO UPDATE SET id=EXCLUDED.id,status='offered',offered_at=EXCLUDED.offered_at,respond_by=EXCLUDED.respond_by,act_by=NULL WHERE q_call.status NOT IN ('offered','acknowledged')",[randomUUID(),round.id,m.id,now(),Number(m.watch_until)]);
    // Email fallback is deprecated: no reservations or outbound delivery.
    return [];
  });}
  async function snapshot(token){
    await transaction(expireWatchers);const [members,rounds,me]=await Promise.all([db.query("SELECT * FROM q_member WHERE state='active'"),db.query("SELECT * FROM q_round WHERE status='active' LIMIT 1"),session(token)]);const round=rounds.rows[0];const call=round&&me?(await db.query("SELECT * FROM q_call WHERE round_id=$1 AND member_id=$2 AND status IN ('offered','acknowledged') LIMIT 1",[round.id,me.id])).rows[0]:null;
    const list=members.rows.sort((a,b)=>compareQueue(a,b,now())).map((m,i)=>({id:m.id,alias:m.alias,position:i+1,available:readyOnPage(m,now()),online:now()-Number(m.last_seen_at)<PRESENCE_MS,ready:readyOnPage(m,now()),quiet:quietAt(m,now()),cooldownUntil:0,volunteered:false,onCall:readyOnPage(m,now()),watchUntil:Number(m.watch_until)}));
    return {rows:list,total:list.length,watchingCount:list.filter(m=>m.onCall).length,maxWatchers:MAX_WATCHERS,shiftMs:WATCH_MS,serverTime:now(),round:round?{id:round.id,startedAt:Number(round.started_at)}:null,call:call?{id:call.id,memberId:call.member_id,status:call.status,respondBy:Number(call.respond_by),actBy:null}:null,me:me?{id:me.id,alias:me.alias,region:me.region,timezone:me.timezone,state:me.state,available:readyOnPage(me,now()),watchUntil:Number(me.watch_until),cooldownUntil:0,quietEnabled:me.quiet_enabled,quietStart:Number(me.quiet_start),quietEnd:Number(me.quiet_end),quiet:quietAt(me,now())}:null};
  }
  return {join,heartbeat,action,tick,snapshot,session,onCallSeconds};
}
