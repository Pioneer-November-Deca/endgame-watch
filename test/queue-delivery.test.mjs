import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinator} from '../backend/alerts.mjs';
test('slow email delivery does not block fresh source observations or round processing',async()=>{
 let releaseSend,started;const sending=new Promise(r=>releaseSend=r),sendStarted=new Promise(r=>started=r);let ticks=0;const finished=[];
 const now=Date.now(),deadline=now+119000,reservation={id:'mail-test',email:'person@example.invalid',token:'test',sourceDeadline:deadline};
 const queue={tick:async(_,options)=>{ticks++;return options.allowEmail&&ticks===1?[reservation]:[];},canSend:async()=>true,finishMail:async(id,status)=>finished.push(status)};
 const c=createCoordinator({queue,enabled:()=>true,source:async()=>({sourceStatus:'live',seconds:119,observedAt:Date.now(),deadlineAt:deadline,campaignEndDate:new Date(deadline).toISOString()}),link:()=>'',send:async()=>{started();await sending;return {ok:true};}});
 await c.process({});await sendStarted;
 await c.process({});assert.equal(ticks,2);assert.deepEqual(finished,[]);
 releaseSend();await c.stop();assert.deepEqual(finished,['accepted']);
});
test('a changed deadline cancels the email wave before submission',async()=>{
 let sent=0;const finished=[],now=Date.now(),deadline=now+119000;
 const queue={tick:async()=>[{id:'mail-test',sourceDeadline:deadline}],canSend:async()=>true,finishMail:async(id,status)=>finished.push(status)};
 const c=createCoordinator({queue,enabled:()=>true,source:async()=>({sourceStatus:'live',seconds:599,observedAt:now,deadlineAt:now+599000,campaignEndDate:new Date(now+599000).toISOString()}),send:async()=>{sent++;return{ok:true};}});
 await c.process({});await new Promise(r=>setImmediate(r));await c.stop();assert.equal(sent,0);assert.deepEqual(finished,['cancelled']);
});
