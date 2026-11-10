import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimer, shouldAlert, publicObservation, normalizeEmail } from '../backend/domain.mjs';
test('reads the supplied timer format and extended durations', () => {
  assert.equal(parseTimer('06 mins 44 secs'),404);
  assert.equal(parseTimer('1 day 2 hours 3 mins 4 secs'),93784);
  assert.equal(parseTimer('00 mins 00 secs'),0);
});
test('unreadable, negative and partial values cannot trigger', () => {
  for(const text of ['',null,'Loading','Just a moment…','-01 mins 20 secs','Ended 0 secs','2 mins blah','1:59']) assert.equal(parseTimer(text),null);
});
test('triggers only on a fresh positive timer strictly below 120 seconds', () => {
  const now=1_000_000, live=seconds=>({seconds,observedAt:now,sourceStatus:'live'});
  assert.equal(shouldAlert(live(119),now),true);
  assert.equal(shouldAlert(live(1),now),true);
  for(const seconds of [120,121,0,-1,null,NaN]) assert.equal(shouldAlert(live(seconds),now),false);
  assert.equal(shouldAlert({...live(119),sourceStatus:'unavailable'},now),false);
  assert.equal(shouldAlert(live(119),now+10_001),false);
  assert.equal(shouldAlert(live(1),now+1000),false);
  assert.equal(shouldAlert(live(119),now-1),false);
});
test('a timer extension is evaluated as its current value', () => {
  const at=1_000_000;
  assert.equal(shouldAlert({seconds:119,observedAt:at,sourceStatus:'live'},at),true);
  assert.equal(shouldAlert({seconds:600,observedAt:at+1000,sourceStatus:'live'},at+1000),false);
});
test('stale public observations suppress the countdown', () => {
  const row={seconds:119,observed_at:'1000000',source_status:'live'};
  assert.equal(publicObservation(row,1_000_000).seconds,119);
  assert.equal(publicObservation(row,1_010_001).seconds,null);
  assert.equal(publicObservation(row,1_010_001).sourceStatus,'stale');
  assert.equal(publicObservation(null).seconds,null);
});
test('email input normalization excludes malformed addresses',()=>{
  assert.equal(normalizeEmail(' Person@Example.com '),'person@example.com');
  for(const email of [null,'a','a@b','a\nb@example.com','<a@example.com>']) assert.equal(normalizeEmail(email),null);
});
