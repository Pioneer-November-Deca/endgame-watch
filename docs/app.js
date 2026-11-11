import {createAlarmSound,createAttentionCue} from './alarm-audio.js?v=3';
import {shouldAlertAll,shouldFocusAlarm,FAILSAFE_MS} from './alarm-policy.js?v=2';
import {sessionFromHash} from './session-route.js?v=1';
const alarmSound=createAlarmSound(),attentionCue=createAttentionCue(),tabId=crypto.randomUUID();
const $=id=>document.getElementById(id),storageKey='endgame-queue-session-v1';
let base='',session='',state=null,signal=null,receivedAt=0,signalReceivedAt=0,busy=false,loadedPrefs='',audio=null,alertsOn=false,lastAlert='',silencedCall='',preview=false;
let sessionVersion=0,refreshTimer=null;
let rosterRows=[],rosterAt=-Infinity,rosterSession=-1,renderedRows,renderedMemberId;
let actionVersion=0,rosterRequest;
const routeToken=sessionFromHash(location.hash);
try{const url=new URL(window.ENDGAME_CONFIG?.apiBaseUrl||'');if(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))base=url.origin;}catch{}
const cookieName='endgame_watch_session',cookiePath=location.pathname.endsWith('/')?location.pathname:location.pathname.slice(0,location.pathname.lastIndexOf('/')+1);
function saveCookie(token){document.cookie=cookieName+'='+encodeURIComponent(token)+'; Path='+cookiePath+'; Max-Age=2592000; SameSite=Strict'+(location.protocol==='https:'?'; Secure':'');}
try{session=decodeURIComponent(document.cookie.split('; ').find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'');if(!session){session=localStorage.getItem(storageKey)||'';if(session)saveCookie(session);}localStorage.removeItem(storageKey);}catch{}
function clearSession(){mutedFailsafe='';sessionVersion++;busy=false;session='';if(state)state.me=null;if($('completion-dialog').open)$('completion-dialog').close();preview=false;alertsOn=false;loadedPrefs='';document.cookie=cookieName+'=; Path='+cookiePath+'; Max-Age=0; SameSite=Strict';try{localStorage.removeItem(storageKey);}catch{}history.replaceState(null,'',location.pathname+location.search);$('complete-confirm').hidden=true;$('join-form').reset();$('page-alerts').textContent='Enable notification sound';$('page-alerts').hidden=false;$('alerts-label').hidden=false;$('alerts-help').textContent='Enable notification sound for this tab, then keep it open.';updateAlarm();}

if(/^[a-f0-9]{64}$/.test(routeToken||'')){session=routeToken;saveCookie(session);}
function bookmark(){const incoming=sessionFromHash(location.hash);if(incoming&&incoming!==session)return;if(!state?.me||!session)return;const hash='#/'+encodeURIComponent(state.me.alias)+'?session='+session;history.replaceState(null,'',location.pathname+location.search+hash);}
const now=()=>state?state.serverTime+(performance.now()-receivedAt):Date.now();
const setMessage=(id,text)=>{$(id).textContent=text;};
function keepToken(token){session=token;saveCookie(token);loadedPrefs='';}
async function api(path,data,withSession=true){if(data!==undefined&&['/api/queue/action','/api/queue/heartbeat'].includes(path))data={...data,tabId};const headers={};if(withSession&&session)headers.Authorization='Bearer '+session;if(data!==undefined)headers['Content-Type']='application/json';const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(20000)});let out;try{out=await r.json();}catch{throw new Error('The server returned an unreadable response.');}if(!r.ok)throw Object.assign(new Error(out.message||'The request could not be completed.'),{status:r.status});return out;}
// DEPRECATED: quiet-hour and region editing are hidden for this page-only watch system.
function duration(ms){const secs=Math.max(0,Math.ceil(ms/1000));return secs>=60?Math.ceil(secs/60)+' min':secs+' sec';}
function drawClock(){if(!signal||signal.sourceStatus!=='live'||performance.now()-signalReceivedAt>12000||signal.serverTime-signal.observedAt+(performance.now()-signalReceivedAt)>(signal.freshnessMs||15000)){$('clock').textContent='— — : — —';$('signal-badge').textContent='NO LIVE SIGNAL';return;}const s=Math.max(0,Math.ceil((signal.deadlineAt-signal.serverTime-(performance.now()-signalReceivedAt))/1000));$('clock').textContent=[Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');$('signal-badge').textContent='LIVE SIGNAL';$('clock-caption').textContent='HOURS / MINUTES / SECONDS';}
function statusFor(row){if(row.onCall&&row.renewBy>now()&&row.watchUntil<=now())return 'Watching · renewal needed';if(row.onCall&&!row.online)return 'Watching · page offline';if(row.onCall&&row.watchUntil>now()){const label=row.alertStatus==='offered'?'Alerted':row.alertStatus==='acknowledged'?'Upgrading':'Watching';return row.id===state?.me?.id?label+' · '+duration(row.watchUntil-now())+' left on your watch':label;}return row.quiet?'Not watching · quiet hours':'Not watching';}
function watchingSummary(){const count=state?.watchingCount||0,watching=state?.me?.available&&state.me.renewBy>now();if(watching){const others=Math.max(0,count-1);return others===0?'You’re the only person watching.':'You’re watching with '+others+' other '+(others===1?'person.':'people.');}return count===0?'No one is watching right now.':count+' '+(count===1?'person is':'people are')+' watching right now.';}
function updateTimers(){drawClock();updateAlarm();if(!state)return;const me=state.me,row=state.myRow??state.rows.find(r=>r.id===me?.id);if(row)$('my-status').textContent=statusFor(row);if(me){$('my-position').textContent=watchingSummary();const watching=me.available&&me.renewBy>now();const full=state.maxWatchers!=null&&state.watchingCount>=state.maxWatchers;$('duty-state').textContent=watching?(me.watchUntil<=now()?'STILL WATCHING · PLEASE RENEW':'YOU’RE WATCHING · '+duration(me.watchUntil-now())+' LEFT on your watch'):'NOT WATCHING';$('available-button').textContent=watching?'Stop watching':full?'Watch is full':'Start watching for a 30-minute shift';$('available-button').disabled=busy||(!watching&&full);}if(state.call?.memberId===me?.id&&me){const acting=state.call.status==='acknowledged';$('my-call-copy').textContent=acting?'Upgrade buffer: '+duration(state.call.actBy-now())+' left. Complete your purchase; the campaign clock reset confirms it.':'Respond in '+duration(state.call.respondBy-now())+'. Choose I will buy now or Pass to pass to the next watcher.';}}
function freshSignal(){return signal?.sourceStatus==='live'&&performance.now()-signalReceivedAt<12000&&signal.serverTime-signal.observedAt+performance.now()-signalReceivedAt<=(signal.freshnessMs||15000);}
function remainingCampaignMs(){
 return signal ? signal.deadlineAt-signal.serverTime-(performance.now()-signalReceivedAt) : 0;
}
function failsafeActive(){
 return shouldAlertAll({member:state?.me,now:now(),sourceFresh:freshSignal(),remainingMs:remainingCampaignMs()});
}
let mutedFailsafe = '';
function updateAlarm(){const call=state?.call,mine=state?.me&&call?.memberId===state.me.id,acting=call?.status==='acknowledged',deadline=acting?call?.actBy:call?.respondBy,sourceReset=signal?.campaignEndDate&&state?.round?.sourceDeadline&&Date.parse(signal.campaignEndDate)-state.round.sourceDeadline>30000,failsafe=failsafeActive(),failsafeKey='failsafe:'+signal?.campaignEndDate,active=preview||failsafe||shouldFocusAlarm({member:state?.me,call,round:state?.round,now:now(),sourceFresh:freshSignal(),sourceReset,remainingMs:remainingCampaignMs()});const watching=Boolean(session&&state?.me?.available&&state.me.renewBy>now());const place=watching?(state.upgradeOrder||[]).findIndex(item=>item.memberId===state.me.id):-1,attention=place===0||place===1;document.body.classList.toggle('attention-active',attention);$('watch-cue').hidden=!attention;$('watch-cue').textContent=place===0?'YOU’RE UP NEXT — KEEP GAMEFOUND READY':'YOU’RE ON DECK — BE READY';attentionCue.sync(audio,{key:attention?state.me.id+':'+place:null,enabled:alertsOn,suppressed:active});document.body.classList.toggle('watching-active',watching);document.body.classList.toggle('alarm-active',active);document.body.classList.toggle('your-turn',Boolean(active&&mine&&!acting&&deadline>now()));document.body.dataset.theme=active?'alarm':watching?'watching':'standby';$('alarm-banner').hidden=!active;
 $('failsafe-campaign').hidden=!failsafe;
 if(failsafe){
   $('alarm-upgrade').hidden=true;
   $('alarm-pass').hidden=true;
   $('silence-alarm').hidden=mutedFailsafe===failsafeKey;
   $('silence-alarm').textContent='Mute sound';
   $('alarm-title').textContent='Final 30 seconds — all watchers alerted';
   $('alarm-copy').textContent='If you’re ready and have an unused extension, upgrade your pledge now. A clock reset clears this alert.';
   alarmSound.sync(audio,{id:failsafeKey,enabled:alertsOn&&mutedFailsafe!==failsafeKey,remainingMs:remainingCampaignMs()});
   syncDialogs(true,failsafeKey,$('failsafe-campaign'));
   if(alertsOn&&lastAlert!==failsafeKey){
     lastAlert=failsafeKey;
     try{
       if('Notification' in window&&Notification.permission==='granted'){
         const notification=new Notification('Endgame Watch: final 30 seconds',{body:'All active watchers are alerted. Upgrade your pledge now if you’re ready.',tag:'endgame-turn'});
         notification.onclick=()=>window.focus();
       }
     }catch{}
   }
   return;
 }
 $('alarm-upgrade').hidden=!mine||acting||preview;$('alarm-upgrade').disabled=busy||!freshSignal()||deadline<=now();$('alarm-pass').hidden=!mine||preview;$('alarm-pass').disabled=busy;$('alarm-pass').textContent=acting?'I can’t complete my purchase':'Pass — I can’t right now';$('silence-alarm').hidden=!preview;$('silence-alarm').textContent=preview?'Dismiss test alarm':'Mute sound';$('alarm-title').textContent=state?.nextUp?.alias?(state.nextUp.alias+(acting?' is upgrading now.':' — BUY NOW')):'Waiting for the next watcher.';$('alarm-copy').textContent=(!mine&&!preview)?((state?.lastMissed?state.lastMissed.alias+' missed their turn. ':'')+(acting?'They’re upgrading now. Hold off and watch for the clock reset.':'Stand by. Only the named watcher should upgrade; they have 15 seconds to confirm.')):preview?'TEST PREVIEW · No queue or campaign changes.':acting?'You have '+duration(deadline-now())+' to complete your purchase. The campaign clock reset confirms success and clears this alert.':'Respond within '+duration(deadline-now())+'. Passing or no response alerts the next watcher.';alarmSound.sync(audio,{id:preview?'preview':call?.id,enabled:Boolean(alertsOn&&active&&(preview||(mine&&!acting&&state.me.available&&state.me.renewBy>now()))&&silencedCall!==call?.id),remainingMs:preview?15000:(call?.respondBy||0)-now()});syncDialogs(Boolean(active&&mine&&deadline>now()),call?.id);if(!active||acting||(!mine&&!preview)||silencedCall===call?.id)return;const alertKey=preview?'preview':call.id;if(!alertsOn||lastAlert===alertKey)return;lastAlert=alertKey;try{if('Notification'in window&&Notification.permission==='granted'){const n=new Notification(mine?'Endgame Watch: your turn':'Endgame Watch: campaign clock low',{body:mine?'Respond within 15 seconds: I will buy now or Pass.':(state.nextUp?.alias||'The next watcher')+' is next. Hold off until your turn.',tag:'endgame-turn'});n.onclick=()=>window.focus();}}catch{}}
let focusedCall='';
function syncDialogs(alarmFocused,callId,focusTarget){const alarm=$('alarm-dialog'),renew=$('renewal-dialog'),me=state?.me,renewDue=me?.available&&me.watchUntil<=now()&&me.renewBy>now();if(alarmFocused){if(renew.open)renew.close();if(!alarm.open){alarm.append($('alarm-banner'));alarm.showModal();}const focusKey=focusTarget?callId:callId+state.call.status;if(focusedCall!==focusKey){focusedCall=focusKey;const button=focusTarget||(state.call.status==='offered'?$('alarm-upgrade'):$('alarm-pass'));button.focus({preventScroll:true});}}else{if(alarm.open){alarm.close();document.body.insertBefore($('alarm-banner'),document.querySelector('main'));focusedCall='';}if(renewDue){$('renewal-countdown').textContent=duration(me.renewBy-now());$('renew-watch').disabled=busy;$('renew-stop').disabled=busy;if(!renew.open){renew.showModal();$('renew-watch').focus({preventScroll:true});}}else if(renew.open)renew.close();}}
let orderRenderKey='';
function renderUpgradeOrder(){const order=state.upgradeOrder||[],key=JSON.stringify([order,state.me?.id,freshSignal()]);if(orderRenderKey===key)return;orderRenderKey=key;$('next-up-name').textContent=order.length?'Who’s up next?':'No watcher ready yet';const list=document.createDocumentFragment();for(const [index,item] of order.entries()){const row=document.createElement('li');if(item.memberId===state.me?.id){row.classList.add('is-you');if(index<2){row.classList.add('is-attention');}}if(index===0)row.classList.add('is-first');const number=document.createElement('span');number.className='order-number';number.textContent=String(index+1);const text=document.createElement('div'),name=document.createElement('strong');name.textContent=item.alias+(item.memberId===state.me?.id?(index===0?' · YOU’RE NEXT':index===1?' · YOU’RE ON DECK':' · YOU'):'');const copy=document.createElement('p');copy.textContent=!freshSignal()?'Stand by — waiting for the campaign signal.':index===0?(item.status==='acknowledged'?'Upgrading now — everyone else, hold off.':item.status==='offered'?'Next to buy — their 15-second turn is active.':'Next up to buy when the alarm sounds at 2 minutes.'):index===1?'On deck — get ready if '+order[0].alias+' can’t make it.':'Backup — be ready if '+order[1].alias+' can’t make it.';text.append(name,copy);row.append(number,text);list.append(row);}$('upgrade-order-list').replaceChildren(list);}
function render(){if(!state)return;const me=state.me,active=me?.state==='active',row=state.myRow??state.rows.find(r=>r.id===me?.id),call=state.call,isMine=call?.memberId===me?.id;
 $('join-card').hidden=!!me;$('my-card').hidden=!me;$('participation-actions').hidden=!active;
 $('join-button').disabled=busy||!base;$('join-button').textContent='Join the live queue →';
 if(me){const reason=me.watchReason;$('watch-notice').hidden=me.available||!['missed-alarm','renewal-missed','page-closed','disconnected'].includes(reason);$('watch-notice').textContent=['page-closed','disconnected'].includes(reason)?'Your watch page closed or stopped checking in, so you’re Not watching. Press Start watching to rejoin.':reason==='missed-alarm'?'You missed the 15-second response window, so you’re back in the passive queue as Not watching. Press Start watching to rejoin.':'You missed the 60-second renewal window, so you’re back in the passive queue as Not watching. Press Start watching to rejoin.';$('my-alias').textContent=me.alias;$('my-position').textContent=watchingSummary();$('my-status').textContent=row?statusFor(row):me.state==='completed'?'Thank you. Your one Endgame extension is marked used.':'You left the queue.';$('my-call').hidden=!isMine;$('my-call-title').textContent=isMine?(call.status==='offered'?'Your turn · 15 seconds to respond':'Upgrade in progress · 30-second buffer'):'';$('ack-button').hidden=!isMine||call.status!=='offered';$('ack-button').disabled=busy||signal?.sourceStatus!=='live'||(call?.respondBy??0)<=now();$('available-button').textContent=me.cooldownUntil>now()?'Go on call — I’m ready again':me.available?'Go off call':'Go on call';$('pass-button').disabled=busy;$('available-button').disabled=busy;$('complete-button').disabled=busy;$('find-me').disabled=!row;$('leave-button').hidden=me.state!=='active';if(me.state==='left'){$('my-message').textContent='Your private session is saved. Rejoin explicitly if you want to participate again.';}$('duty-state').textContent=isMine?'CURRENTLY ON CALL':me.quiet?'OFF CALL · QUIET HOURS':row?.ready?'AVAILABLE · WAITING FOR YOUR TURN':me.available?'OFF CALL · COOLDOWN OR RECONNECTING':'SET TO OFF CALL';$('preview-alert').hidden=!(signal?.testMode&&['localhost','127.0.0.1'].includes(location.hostname));bookmark();

 }
 $('queue-total').textContent=state.total;$('queue-empty').hidden=state.total>0;$('queue-table').hidden=state.total===0;const ready=state.watchingCount;$('queue-summary').textContent=state.total+' participants · includes people not watching';$('watcher-count').textContent=state.maxWatchers!=null?ready+' of '+state.maxWatchers+' watch spots filled':ready+(ready===1?' person watching':' people watching');renderUpgradeOrder();const missedCopy=state.lastMissed&&state.call&&state.lastMissed.alias!==state.nextUp?.alias?state.lastMissed.alias+' missed their turn. ':'';$('next-up-status').textContent=missedCopy+(state.nextUp?(state.nextUp.status==='acknowledged'?'Upgrading now · everyone else, hold off. The campaign clock will confirm a reset.':state.nextUp.status==='offered'?'Their turn · 15 seconds to respond. Everyone else, hold off.':'First in watch order. Wait for the alarm before upgrading.'):'Start watching to take a place.');$('watcher-count').classList.toggle('unwatched',ready===0);
 if(renderedRows!==state.rows||renderedMemberId!==me?.id){renderedRows=state.rows;renderedMemberId=me?.id;const rows=document.createDocumentFragment();for(const item of state.rows){const tr=document.createElement('tr');if(item.id===me?.id){tr.className='is-me';tr.id='my-queue-row';}else if(item.onCall)tr.className='is-oncall';const ticket=document.createElement('td');ticket.className='ticket';ticket.textContent=String(item.position).padStart(2,'0');const alias=document.createElement('td');const name=document.createElement('strong');name.textContent=item.alias;alias.append(name);if(item.id===me?.id){const badge=document.createElement('span');badge.className='you-badge';badge.textContent='YOU';alias.append(badge);const find=document.createElement('button');find.type='button';find.className='row-action';find.textContent='My controls ↑';find.addEventListener('click',()=>$('my-card').scrollIntoView({behavior:'smooth'}));alias.append(find);}const status=document.createElement('td');status.textContent=statusFor(item);tr.append(ticket,alias,status);rows.append(tr);}$('queue-rows').replaceChildren(rows);}
 $('test-mode').hidden=!signal?.testMode;$('election-threshold').textContent='At '+(signal?.testMode?'09:00 · TEST':'02:00');if(!freshSignal())$('next-up-status').textContent='Waiting for a fresh campaign signal. Hold off.';let banner=state.watchingCount===0?'Nobody is watching. Take a shift when you’re ready.':state.watchingCount+(state.watchingCount===1?' person watching the clock. ':' people watching the clock. ')+(state.maxWatchers!=null&&ready>=state.maxWatchers?'All watch spots are full.':'Watch spots are available.');if(state.call){const alias=state.nextUp?.alias||'A watcher';banner=alias+(state.call.status==='acknowledged'?' is upgrading · cascade paused up to 30 seconds.':' has the alarm · 15 seconds to respond.');}if(signal?.sourceStatus!=='live')banner+=' Campaign signal unavailable; alarms are paused.';$('round-banner').textContent=banner;
 updateTimers();
}
function pollDelay(){
 if(!state?.me?.available)return 10000;
 if(remainingCampaignMs()<=FAILSAFE_MS&&freshSignal())return 2000;
 if(state.call||!freshSignal())return 2000;
 const remaining=signal.deadlineAt-signal.serverTime-(performance.now()-signalReceivedAt);
 return remaining<=(signal.onCallSeconds+10)*1000?2000:5000;
}
async function refreshRoster(version,action){
 const response=await fetch(base+'/api/roster',{cache:'no-cache',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Could not refresh the roster.');
 const {rows}=await response.json();
 if(version!==sessionVersion||action!==actionVersion)return;
 rosterRows=rows;
 rosterSession=version;
 rosterAt=performance.now();
 if(state){state.rows=rows;render();}
}
async function refresh(){
 if(!base)return;
 const incoming=sessionFromHash(location.hash);
 if(incoming&&incoming!==session){switchLinkedSession();return;}
 clearTimeout(refreshTimer);
 let version=sessionVersion;
 const action=actionVersion;
 try{
  if(busy)return;
  let live;
  try{live=await api('/api/live');}
  catch(error){
   if(error.status!==404)throw error;
   const [legacySignal,legacyQueue]=await Promise.all([api('/api/status',undefined,false),api('/api/queue')]);
   live={...legacyQueue,signal:legacySignal};
  }
  if(version!==sessionVersion||action!==actionVersion)return;
  const {signal:latest,rows,...queue}=live;
  signal=latest;
  state={...queue,rows:rows??(rosterSession===version?rosterRows:[])};
  if(session&&(!queue.me||queue.me.state!=='active')){
   clearSession();
   version=sessionVersion;
   state.me=null;
   setMessage('join-message','That private session is expired or inactive. Join again to participate.');
  }
  receivedAt=performance.now();
  signalReceivedAt=receivedAt;
  $('signal-status').textContent=latest.sourceStatus==='live'?(latest.source==='local-qa'?'● Local test signal':'● Synced with Gamefound’s public API'):latest.sourceStatus==='elapsed'?'● Latest reported deadline has passed':'● Live campaign signal unavailable';
  $('last-observation').textContent=latest.observedAt?'Last source check: '+new Date(latest.observedAt).toLocaleTimeString():'No observation yet.';
  render();
  if(!rows&&(rosterSession!==version||performance.now()-rosterAt>=60000)){
   if(!rosterRequest||rosterRequest.version!==version||rosterRequest.action!==action){
    const request={version,action};
    rosterRequest=request;
    refreshRoster(version,action).catch(()=>{}).finally(()=>{
     if(rosterRequest===request)rosterRequest=null;
    });
   }
  }
 }catch(error){
  if(version!==sessionVersion||action!==actionVersion)return;
  $('queue-summary').textContent='Queue connection lost. Reconnecting…';
  $('signal-status').textContent='● '+error.message;
  signal=null;
  drawClock();
 }finally{
  if(version===sessionVersion){
   clearTimeout(refreshTimer);
   refreshTimer=setTimeout(refresh,pollDelay());
  }
 }
}
async function act(action,extra={}){if(busy)return;actionVersion++;let version=sessionVersion;const response=action==='ack'||action==='pass'||action==='leave'||action==='complete'||(action==='available'&&!extra.available);if(response){silencedCall=state?.call?.id||'';alarmSound.stop();}busy=true;render();try{await api('/api/queue/action',{action,...extra});if(version!==sessionVersion)return;if(action==='complete'||action==='leave'){clearSession();version=sessionVersion;const q=await api('/api/queue');if(version!==sessionVersion)return;state=q;rosterRows=q.rows;rosterAt=performance.now();rosterSession=version;receivedAt=performance.now();setMessage('join-message',action==='complete'?'Thank you — your extension is marked complete. Your entry was removed.':'You left the queue. Your saved session and private links have been cleared.');refresh();return;}setMessage('my-message',action==='renew'?'You’re watching for another 30 minutes.':action==='pass'?'You stopped watching and moved back. Start again whenever a spot is free.':'Updated.');const q=await api('/api/queue');if(version!==sessionVersion)return;state=q;rosterRows=q.rows;rosterAt=performance.now();rosterSession=version;receivedAt=performance.now();}catch(error){if(version!==sessionVersion)return;if(response)silencedCall='';if($('completion-dialog').open)$('completion-message').textContent=error.message;setMessage('my-message',error.message);}finally{if(version===sessionVersion){busy=false;render();clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,0);}}}
$('join-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;let version=sessionVersion;busy=true;$('join-button').disabled=true;try{const joined=await api('/api/queue/join',{alias:$('alias').value,consent:$('join-consent').checked,website:$('website').value},false);if(version!==sessionVersion)return;sessionVersion++;version=sessionVersion;keepToken(joined.token);await api('/api/queue/heartbeat',{});const q=await api('/api/queue');if(version!==sessionVersion)return;state=q;rosterRows=q.rows;rosterAt=performance.now();rosterSession=version;receivedAt=performance.now();setMessage('my-message',joined.message);}catch(error){if(version===sessionVersion)setMessage('join-message',error.message);}finally{if(version===sessionVersion){busy=false;render();$('join-button').disabled=false;refresh();}}});
$('available-button').onclick=()=>{if(state.me.available&&state.me.renewBy>now())act('available',{available:false});else{$('watch-prep-dialog').showModal();$('watch-prep-ready').focus();}};$('watch-prep-close').onclick=()=>$('watch-prep-dialog').close();$('watch-prep-ready').onclick=()=>{$('watch-prep-dialog').close();act('available',{available:true});};$('ack-button').onclick=()=>act('ack');$('pass-button').onclick=()=>act('pass');$('complete-button').onclick=openCompletion;$('cancel-complete').onclick=()=>{$('complete-confirm').hidden=true;$('completion-dialog').close();};$('confirm-complete').onclick=()=>act('complete');$('leave-button').onclick=()=>act('leave');$('find-me').onclick=()=>document.getElementById('my-queue-row')?.scrollIntoView({behavior:'smooth',block:'center'});
// DEPRECATED: no quiet-hour form or preferences submission.
// DEPRECATED: email signup and fallback delivery are intentionally disabled.
$('save-link').onclick=async()=>{try{const url=new URL(location.href);bookmark();url.href=location.href;await navigator.clipboard.writeText(url.href);setMessage('my-message','Private access link copied. Save it securely; do not share it.');}catch{setMessage('my-message','Clipboard is unavailable. Keep this browser’s site data to retain your private session.');}};
$('page-alerts').onclick=async()=>{try{const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw new Error('Audio unavailable');if(!audio)audio=new Context();await audio.resume();if(audio.state!=='running')throw new Error('Audio is suspended');alertsOn=true;$('page-alerts').hidden=true;$('alerts-label').hidden=true;$('alerts-help').textContent='Sound enabled for this tab.';updateAlarm();if('Notification'in window&&Notification.permission==='default')await Notification.requestPermission();}catch{setMessage('my-message','This browser could not enable sound. Try again or watch the page directly.');}};
function timeInput(value){return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');}
function minutes(value){const [h,m]=value.split(':').map(Number);return h*60+m;}
$('preview-alert').onclick=()=>{preview=true;lastAlert='';updateAlarm();window.scrollTo({top:0,behavior:'smooth'});};
$('silence-alarm').onclick=()=>{if(failsafeActive())mutedFailsafe='failsafe:'+signal.campaignEndDate;preview=false;silencedCall=state?.call?.id||'';updateAlarm();};
$('alarm-dialog').addEventListener('cancel',event=>event.preventDefault());$('renewal-dialog').addEventListener('cancel',event=>event.preventDefault());$('renew-watch').onclick=()=>act('renew');$('renew-stop').onclick=()=>act('available',{available:false});
function openCompletion(){$('complete-confirm').hidden=false;$('completion-message').textContent='';$('completion-dialog').showModal();$('confirm-complete').focus();}
$('alarm-upgrade').onclick=()=>act('ack');$('alarm-pass').onclick=()=>act('pass');
setInterval(()=>{if(session&&state?.me?.available)api('/api/queue/heartbeat',{}).catch(()=>{});},10000);setInterval(updateTimers,100);
function closeTabSession(token){if(!base||!token)return;const body=JSON.stringify({token,tabId});const sent=navigator.sendBeacon?.(base+'/api/queue/disconnect',new Blob([body],{type:'text/plain;charset=UTF-8'}));if(!sent)fetch(base+'/api/queue/disconnect',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body,keepalive:true,credentials:'omit'}).catch(()=>{});}
function switchLinkedSession(){const incoming=sessionFromHash(location.hash);if(!incoming||incoming===session)return;closeTabSession(session);mutedFailsafe='';sessionVersion++;const version=sessionVersion;clearTimeout(refreshTimer);keepToken(incoming);state=null;signal=null;busy=false;preview=false;alertsOn=false;lastAlert='';silencedCall='';orderRenderKey='';focusedCall='';alarmSound.stop();attentionCue.sync(audio,{key:null,enabled:false});for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();document.body.insertBefore($('alarm-banner'),document.querySelector('main'));document.body.classList.remove('watching-active','alarm-active','attention-active','your-turn');$('alarm-banner').hidden=true;$('my-card').hidden=true;$('join-card').hidden=true;$('queue-summary').textContent='Opening the private session in your link…';$('page-alerts').hidden=false;$('alerts-label').hidden=false;$('alerts-help').textContent='Enable notification sound for this tab, then keep it open.';if(base)(async()=>{await api('/api/queue/heartbeat',{}).catch(()=>{});if(version===sessionVersion)refresh();})();}
window.addEventListener('hashchange',switchLinkedSession);window.addEventListener('popstate',switchLinkedSession);window.addEventListener('pagehide',()=>closeTabSession(session));
window.addEventListener('pageshow',event=>{if(event.persisted&&session)api('/api/queue/heartbeat',{}).catch(()=>{});});
if(base){(async()=>{const version=sessionVersion;if(session)await api('/api/queue/heartbeat',{}).catch(()=>{});if(version===sessionVersion)refresh();})();}else{$('join-button').textContent='Queue backend not configured';$('queue-summary').textContent='The backend URL is missing.';}
