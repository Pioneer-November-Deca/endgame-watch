import test from 'node:test';import assert from 'node:assert/strict';import {shouldAlertAll,shouldFocusAlarm} from '../docs/alarm-policy.js';
const active={member:{id:'chosen',available:true,renewBy:100000},call:{memberId:'chosen',status:'offered',respondBy:10000},round:{id:'round'},now:1000,sourceFresh:true,sourceReset:false,remainingMs:120000};
test('only the selected watcher gets a red alarm, never the on-deck or backup watcher',()=>{assert.equal(shouldFocusAlarm(active),true);for(const id of ['on-deck','backup'])assert.equal(shouldFocusAlarm({...active,member:{...active.member,id}}),false);assert.equal(shouldFocusAlarm({...active,member:null}),false);assert.equal(shouldFocusAlarm({...active,member:{...active.member,available:false}}),false);});
test('red remains for the selected upgrade buffer and clears on reset, stale signal or expiry',()=>{assert.equal(shouldFocusAlarm({...active,call:{...active.call,status:'acknowledged',actBy:31000}}),true);for(const change of [{sourceReset:true},{sourceFresh:false},{remainingMs:0},{now:10000}])assert.equal(shouldFocusAlarm({...active,...change}),false);});

test('failsafe alerts active watchers from thirty seconds until the deadline',()=>{
 const member={state:'active',available:true,renewBy:60000};
 const input={member,now:1000,sourceFresh:true,remainingMs:30000};
 assert.equal(shouldAlertAll(input),true);
 for(const change of [{remainingMs:30001},{remainingMs:0},{sourceFresh:false},{member:null},{member:{...member,available:false}},{now:60000}]){
   assert.equal(shouldAlertAll({...input,...change}),false);
 }
});
