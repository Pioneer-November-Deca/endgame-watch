import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { validAlias,validPreferences,validQuietSchedule,quietAt } from '../docs/regions.js';
import { readyOnPage,emailEligible,compareQueue,fallbackCapacity,refillCredits,COOLDOWN_MS,DAILY_TOTAL,DAILY_VERIFICATION } from './queue-policy.mjs';
import { FRESH_MS } from './domain.mjs';
const hash=token=>createHash('sha256').update(token).digest('hex');
const secret=()=>randomBytes(32).toString('hex');
export function problem(message,status=400){return Object.assign(new Error(message),{status,publicMessage:message});}
export function createQueue({db,now=Date.now,onCallSeconds=300}) {
  async function transaction(work){const c=await db.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(74120913)');const out=await work(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async function session(token,c=db){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;const r=await c.query('SELECT m.* FROM q_session s JOIN q_member m ON m.id=s.member_id WHERE s.token_hash=$1 AND s.expires_at>$2',[hash(token),now()]);return r.rows[0]??null;}
  async function requireMember(token,c){const m=await session(token,c);if(!m)throw problem('Your private session is missing or expired. Reopen a recovery link or join again.',401);return m;}
  async function issueSession(c,id){const token=secret();await c.query('INSERT INTO q_session(token_hash,member_id,expires_at) VALUES($1,$2,$3)',[hash(token),id,now()+30*86400_000]);return token;}
  async function moveBack(c,id){await c.query("UPDATE q_member SET queue_order=nextval('q_order_seq'),priority_order=NULL,cooldown_until=$1 WHERE id=$2 AND state='active'",[now()+COOLDOWN_MS,id]);}
  async function mailRows(c){return(await c.query('SELECT kind,reserved_at FROM q_mail WHERE reserved_at>$1',[now()-86400_000])).rows;}
  async function closeRound(c,round,status){
    await c.query('UPDATE q_round SET status=$1 WHERE id=$2',[status,round.id]);
    await c.query("UPDATE q_call SET status=$1 WHERE round_id=$2 AND status IN ('offered','acknowledged')",[status,round.id]);
    const touched=await c.query('SELECT member_id FROM q_touch WHERE round_id=$1',[round.id]);
    for(const row of touched.rows)await moveBack(c,row.member_id);
  }
  async function join({alias,region,timezone}){
    if(!validAlias(alias))throw problem('Choose an alias of 3–24 letters, numbers, spaces, underscores or hyphens.');
    if(!validPreferences(region,timezone))throw problem('Choose a listed region and time zone.');
    return transaction(async c=>{
      const count=await c.query("SELECT count(*)::int AS count FROM q_member WHERE state='active'");if(count.rows[0].count>=2000)throw problem('The queue is currently full.',429);
      const existing=await c.query('SELECT 1 FROM q_member WHERE alias_key=$1',[alias.trim().toLowerCase()]);if(existing.rows.length)throw problem('That alias is already taken. Please choose another.',409);
      const id=randomUUID();await c.query('INSERT INTO q_member(id,alias,alias_key,region,timezone,created_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$6)',[id,alias.trim(),alias.trim().toLowerCase(),region,timezone,now()]);
      return {token:await issueSession(c,id),id,message:'You joined the queue. Mark yourself available when you can pay attention.'};
    });
  }
  async function heartbeat(token){const member=await requireMember(token,db);await db.query('UPDATE q_member SET last_seen_at=$1 WHERE id=$2',[now(),member.id]);return {ok:true};}
  async function action(token,action,data={}){return transaction(async c=>{
    const member=await requireMember(token,c);if(member.state==='completed')throw problem('Your one Endgame extension is marked complete. You are out of this campaign’s queue.');
    if(member.state==='left'&&action!=='rejoin')throw problem('You have left the queue. Rejoin explicitly to participate again.');
    const calls=await c.query("SELECT * FROM q_call WHERE member_id=$1 AND status IN ('offered','acknowledged') ORDER BY offered_at DESC LIMIT 1",[member.id]);const call=calls.rows[0];
    if(action==='available'){
      await c.query('UPDATE q_member SET available=$1,last_seen_at=$2,cooldown_until=CASE WHEN $1 THEN 0 ELSE cooldown_until END,priority_order=CASE WHEN $1 THEN priority_order ELSE NULL END WHERE id=$3',[data.available===true,now(),member.id]);
      if(data.available===true&&!call)await c.query("DELETE FROM q_touch WHERE member_id=$1 AND round_id IN (SELECT id FROM q_round WHERE status='active')",[member.id]);
    }
    else if(action==='priority'){
      if(!readyOnPage(member,now()))throw problem('You must be available, online and out of cooldown to volunteer first.');
      await c.query("UPDATE q_member SET priority_order=COALESCE(priority_order,nextval('q_order_seq')) WHERE id=$1",[member.id]);
    }else if(action==='ack'){
      if(!call||call.status!=='offered'||Number(call.respond_by)<=now()||!readyOnPage(member,now()))throw problem('This call is no longer available. The queue will update.');
      const signal=(await c.query('SELECT source_status,observed_at,deadline_at FROM watch_observation LIMIT 1')).rows[0];
      if(!signal||signal.source_status!=='live'||now()-Number(signal.observed_at)>FRESH_MS||Number(signal.deadline_at)<=now())throw problem('A fresh live campaign signal is required.');
      await c.query("UPDATE q_call SET status='acknowledged' WHERE id=$1",[call.id]);
    }else if(action==='pass'){
      if(call)await c.query("UPDATE q_call SET status='passed' WHERE id=$1",[call.id]);await moveBack(c,member.id);
    }else if(action==='complete'){
      await c.query("UPDATE q_member SET state='completed',available=false,email_consent=false,priority_order=NULL WHERE id=$1",[member.id]);
      await c.query('DELETE FROM q_email_verify WHERE member_id=$1',[member.id]);
      if(call)await c.query("UPDATE q_call SET status='completed',act_by=$1 WHERE id=$2",[now()+30_000,call.id]);
      await c.query('DELETE FROM q_session WHERE member_id=$1',[member.id]);
    }else if(action==='leave'){
      await c.query("UPDATE q_member SET state='left',available=false,email=NULL,email_verified=false,email_consent=false,priority_order=NULL WHERE id=$1",[member.id]);
      await c.query('DELETE FROM q_email_verify WHERE member_id=$1',[member.id]);
      if(call)await c.query("UPDATE q_call SET status='passed' WHERE id=$1",[call.id]);
      await c.query('DELETE FROM q_session WHERE member_id=$1',[member.id]);
    }else if(action==='rejoin')await c.query("UPDATE q_member SET state='active',available=false,queue_order=nextval('q_order_seq'),last_seen_at=$1 WHERE id=$2",[now(),member.id]);
    else if(action==='preferences'){
      if(!validPreferences(data.region,data.timezone))throw problem('Choose a listed region and time zone.');
      const enabled=data.quietEnabled??member.quiet_enabled,start=data.quietStart??Number(member.quiet_start),end=data.quietEnd??Number(member.quiet_end);
      if(!validQuietSchedule(enabled,start,end))throw problem('Choose different quiet-hour start and end times.');
      await c.query('UPDATE q_member SET region=$1,timezone=$2,quiet_enabled=$3,quiet_start=$4,quiet_end=$5 WHERE id=$6',[data.region,data.timezone,enabled,start,end,member.id]);
    }else if(action==='email-off'){await c.query('UPDATE q_member SET email_consent=false WHERE id=$1',[member.id]);await c.query('DELETE FROM q_email_verify WHERE member_id=$1',[member.id]);}
    else throw problem('Unknown queue action.');
    if(action==='available'&&data.available!==true&&call){await c.query("UPDATE q_call SET status='passed' WHERE id=$1",[call.id]);await moveBack(c,member.id);}
    return {ok:true};
  });}
  async function tick(observation,{allowEmail=false}={}){return transaction(async c=>{
    let round=(await c.query("SELECT * FROM q_round WHERE status='active' LIMIT 1")).rows[0];
    const fresh=observation?.sourceStatus==='live'&&now()>=observation.observedAt&&now()-observation.observedAt<=FRESH_MS&&observation.deadlineAt>now();
    if(!fresh){if(observation?.sourceStatus==='elapsed'&&round)await closeRound(c,round,'elapsed');return [];}
    const deadline=Date.parse(observation.campaignEndDate);
    if(!Number.isFinite(deadline))return [];
    if(round&&deadline-Number(round.source_deadline)>30_000){await closeRound(c,round,'reset');round=null;}
    if(!round&&observation.seconds<onCallSeconds){round={id:randomUUID(),started_at:now(),source_deadline:deadline,fallback_claimed:false};await c.query('INSERT INTO q_round(id,started_at,source_deadline) VALUES($1,$2,$3)',[round.id,round.started_at,deadline]);}
    if(!round)return [];
    let call=(await c.query("SELECT * FROM q_call WHERE round_id=$1 AND status IN ('offered','acknowledged') ORDER BY offered_at DESC LIMIT 1",[round.id])).rows[0];
    if(call){
      const member=(await c.query('SELECT * FROM q_member WHERE id=$1',[call.member_id])).rows[0];
      const expired=!readyOnPage(member,now())||(call.status==='offered'&&Number(call.respond_by)<=now());
      if(expired){await c.query("UPDATE q_call SET status='expired' WHERE id=$1",[call.id]);await moveBack(c,member.id);call=null;}
      // Acknowledged duty has no fixed timeout; explicit actions or reset end it.
    }
    const all=(await c.query("SELECT * FROM q_member WHERE state='active'")).rows.sort((a,b)=>compareQueue(a,b,now()));
    const touched=new Set((await c.query('SELECT member_id FROM q_touch WHERE round_id=$1',[round.id])).rows.map(x=>x.member_id));
    const recentCompletion=(await c.query("SELECT 1 FROM q_call WHERE round_id=$1 AND status='completed' AND act_by>$2 LIMIT 1",[round.id,now()])).rows.length>0;
    if(!call&&!recentCompletion){
      const next=all.find(m=>readyOnPage(m,now())&&!touched.has(m.id));
      if(next){call={id:randomUUID(),member_id:next.id,status:'offered',respond_by:now()+15_000};await c.query('INSERT INTO q_call(id,round_id,member_id,offered_at,respond_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(round_id,member_id) DO UPDATE SET id=EXCLUDED.id,status=\'offered\',offered_at=EXCLUDED.offered_at,respond_by=EXCLUDED.respond_by,act_by=NULL',[call.id,round.id,next.id,now(),call.respond_by]);await c.query("INSERT INTO q_touch(round_id,member_id,channel) VALUES($1,$2,'page') ON CONFLICT DO NOTHING",[round.id,next.id]);await c.query('UPDATE q_member SET priority_order=NULL WHERE id=$1',[next.id]);touched.add(next.id);}
    }
    return [];
    /* DEPRECATED: email is unsuitable for instant on-call alerts. Retained for reference only.
    if(!allowEmail||observation.seconds>=120||round.fallback_claimed||recentCompletion||call?.status==='acknowledged'||now()-Number(round.started_at)<15_000)return [];
    const budget=(await c.query('SELECT * FROM q_budget WHERE id=1')).rows[0];
    const credits=budget?refillCredits(budget.credits,budget.updated_at,now()):10;
    await c.query('INSERT INTO q_budget(id,credits,updated_at) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET credits=EXCLUDED.credits,updated_at=EXCLUDED.updated_at',[credits,now()]);
    const capacity=Math.min(fallbackCapacity(await mailRows(c),now()),Math.floor(credits+1e-8));if(capacity===0)return [];
    const recipients=all.filter(m=>emailEligible(m,now())&&!touched.has(m.id)).slice(0,capacity);if(!recipients.length)return [];
    await c.query('UPDATE q_round SET fallback_claimed=true WHERE id=$1',[round.id]);
    await c.query('UPDATE q_budget SET credits=$1,updated_at=$2 WHERE id=1',[credits-recipients.length,now()]);
    const result=[];
    for(const member of recipients){
      const id=randomUUID(),token=secret();
      await c.query("INSERT INTO q_mail(id,kind,member_id,round_id,reserved_at) VALUES($1,'fallback',$2,$3,$4)",[id,member.id,round.id,now()]);
      await c.query('INSERT INTO q_access(token_hash,member_id,expires_at) VALUES($1,$2,$3)',[hash(token),member.id,now()+86400_000]);
      await c.query("INSERT INTO q_touch(round_id,member_id,channel) VALUES($1,$2,'email') ON CONFLICT DO NOTHING",[round.id,member.id]);
      result.push({id,roundId:round.id,sourceDeadline:deadline,memberId:member.id,email:member.email,token});
    }
    return result;
    */
  });}
  async function snapshot(token){
    const [members,rounds,me,usage]=await Promise.all([db.query("SELECT * FROM q_member WHERE state='active'"),db.query("SELECT * FROM q_round WHERE status='active' LIMIT 1"),session(token),mailRows(db)]);
    const round=rounds.rows[0];const calls=round?(await db.query("SELECT * FROM q_call WHERE round_id=$1 AND status IN ('offered','acknowledged') LIMIT 1",[round.id])).rows:[];const call=calls[0];
    const list=members.rows.sort((a,b)=>{
      if(a.id===call?.member_id)return -1;if(b.id===call?.member_id)return 1;return compareQueue(a,b,now());
    }).map((m,i)=>({id:m.id,alias:m.alias,position:i+1,available:m.available,online:now()-Number(m.last_seen_at)<45_000,ready:readyOnPage(m,now()),quiet:quietAt(m,now()),cooldownUntil:Number(m.cooldown_until),volunteered:m.priority_order!=null,onCall:m.id===call?.member_id}));
    const fallback=usage.filter(r=>r.kind==='fallback').length;
    return {rows:list,total:list.length,serverTime:now(),round:round?{id:round.id,startedAt:Number(round.started_at),fallbackSent:round.fallback_claimed}:null,
      call:call?{id:call.id,memberId:call.member_id,status:call.status,respondBy:Number(call.respond_by),actBy:call.act_by==null?null:Number(call.act_by)}:null,
      me:me?{id:me.id,alias:me.alias,region:me.region,timezone:me.timezone,state:me.state,available:me.available,cooldownUntil:Number(me.cooldown_until),quietEnabled:me.quiet_enabled,quietStart:Number(me.quiet_start),quietEnd:Number(me.quiet_end),quiet:quietAt(me,now())}:null,
      mailBudget:{totalUsed:usage.length,totalCap:DAILY_TOTAL,fallbackUsed:fallback,fallbackCap:80}};
  }
  /* DEPRECATED: no email API routes or worker call these legacy helpers.
  async function requestEmail(token,email){return transaction(async c=>{
    const member=await requireMember(token,c);if(member.state!=='active')throw problem('Rejoin the active queue before adding fallback email.');
    const rows=await mailRows(c);if(rows.length>=DAILY_TOTAL||rows.filter(r=>r.kind==='verification').length>=DAILY_VERIFICATION)throw problem('The daily verification email budget is used up. Your web queue still works.',429);
    const recent=(await c.query("SELECT 1 FROM q_mail WHERE member_id=$1 AND kind='verification' AND reserved_at>$2 LIMIT 1",[member.id,now()-15*60_000])).rows.length;
    if(recent)throw problem('Wait 15 minutes before requesting another verification email.',429);
    const id=randomUUID(),verify=secret();await c.query('DELETE FROM q_email_verify WHERE member_id=$1',[member.id]);
    await c.query('INSERT INTO q_email_verify(token_hash,member_id,email,expires_at) VALUES($1,$2,$3,$4)',[hash(verify),member.id,email,now()+30*60_000]);
    await c.query("INSERT INTO q_mail(id,kind,member_id,reserved_at) VALUES($1,'verification',$2,$3)",[id,member.id,now()]);return {id,email,token:verify};
  });}
  async function verifyEmail(token){return transaction(async c=>{
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw problem('Invalid verification link.');
    const r=await c.query('DELETE FROM q_email_verify WHERE token_hash=$1 AND expires_at>$2 RETURNING *',[hash(token),now()]);const row=r.rows[0];if(!row)throw problem('This verification link has expired or was already used.');
    const existing=await c.query('SELECT 1 FROM q_member WHERE email=$1 AND id<>$2',[row.email,row.member_id]);if(existing.rows.length)throw problem('That address is already connected to another queue session.');
    const member=(await c.query('SELECT state FROM q_member WHERE id=$1',[row.member_id])).rows[0];if(member.state!=='active')throw problem('This queue membership is no longer active.');
    await c.query('UPDATE q_member SET email=$1,email_verified=true,email_consent=true WHERE id=$2',[row.email,row.member_id]);
    return {token:await issueSession(c,row.member_id),message:'Fallback email verified. You can manage your turn here.'};
  });}
  async function exchange(token){return transaction(async c=>{
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw problem('Invalid access link.');
    const r=await c.query('DELETE FROM q_access WHERE token_hash=$1 AND expires_at>$2 RETURNING member_id',[hash(token),now()]);if(!r.rows.length)throw problem('That link has expired or was already used.');return {token:await issueSession(c,r.rows[0].member_id)};
  });}
  async function finishMail(id,status,providerId=null){await db.query('UPDATE q_mail SET status=$1,provider_id=$2 WHERE id=$3',[status,providerId,id]);}
  async function canSend(reservation){
    const [member,round,call]=await Promise.all([db.query('SELECT * FROM q_member WHERE id=$1',[reservation.memberId]),db.query("SELECT 1 FROM q_round WHERE id=$1 AND status='active'",[reservation.roundId]),db.query("SELECT 1 FROM q_call WHERE round_id=$1 AND status='acknowledged' LIMIT 1",[reservation.roundId])]);
    return !!round.rows.length&&!call.rows.length&&member.rows.length&&emailEligible(member.rows[0],now());
  }
  */
  return {join,heartbeat,action,tick,snapshot,session,onCallSeconds};
}
