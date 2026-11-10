import test from 'node:test';
import assert from 'node:assert/strict';
import { apiObservation, fetchCampaign } from '../backend/gamefound-api.mjs';
import { CAMPAIGN_ID, API_URL, shouldAlert } from '../backend/domain.mjs';
const now=Date.parse('2026-11-10T17:00:00Z');
const context={receivedAt:now,responseDate:new Date(now).toUTCString(),elapsedMs:0};
const project=remaining=>({projectUrlName:CAMPAIGN_ID,creatorUrlName:'mood-publishing',campaignEndDate:new Date(now+remaining*1000).toISOString()});
test('API deadline produces a synchronized countdown and follows extensions',()=>{
  const near=apiObservation(project(119),context), extended=apiObservation(project(600),context);
  assert.equal(near.seconds,119);assert.equal(shouldAlert(near,now),true);
  assert.equal(extended.seconds,600);assert.equal(shouldAlert(extended,now),false);
  assert.equal(extended.source,'gamefound-public-api');
});
test('source clock is used even when worker clock differs',()=>{
  const observation=apiObservation(project(120),{...context,receivedAt:now-4000});
  assert.equal(observation.seconds,120);assert.equal(observation.deadlineAt,now-4000+120000);
});
test('invalid or missing deadlines and mismatched projects fail closed',()=>{
  for(const value of [null,{}, {...project(119),projectUrlName:'other'}, {...project(119),creatorUrlName:'other'},
    {...project(119),campaignEndDate:null},{...project(119),campaignEndDate:'2026-11-10 17:01:59'},
    {...project(119),campaignEndDate:'garbage'}])assert.throws(()=>apiObservation(value,context));
});
test('zero and past deadlines are elapsed and cannot alert',()=>{
  for(const seconds of [0,-1,-600]){const sample=apiObservation(project(seconds),context);assert.equal(sample.sourceStatus,'elapsed');assert.equal(shouldAlert(sample,now),false);}
});
test('old cache metadata, invalid clocks and slow responses fail closed',()=>{
  for(const patch of [{age:'11'},{age:'-1'},{age:'abc'},{responseDate:null},
    {responseDate:new Date(now-20000).toUTCString()},{responseDate:new Date(now+60000).toUTCString()},{elapsedMs:7001}]){
    assert.throws(()=>apiObservation(project(119),{...context,...patch}));
  }
});
test('fetch uses the documented endpoint and validates a JSON response',async()=>{
  const sample=await fetchCampaign({now:()=>now,fetchImpl:async(url,options)=>{
    assert.equal(url,API_URL);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
    return new Response(JSON.stringify(project(119)),{headers:{'Content-Type':'application/json','Date':new Date(now).toUTCString()}});
  }});
  assert.equal(sample.seconds,119);
});
test('HTTP challenges, HTML, broken JSON and rate limits cannot yield observations',async()=>{
  for(const response of [new Response('challenge',{status:403}),new Response('<html>challenge</html>',{headers:{'Content-Type':'text/html'}}),
    new Response('{',{headers:{'Content-Type':'application/json'}})]){
    await assert.rejects(fetchCampaign({now:()=>now,fetchImpl:async()=>response}));
  }
  await assert.rejects(fetchCampaign({now:()=>now,fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':'60'}})}),error=>error.code==='http_429'&&error.retryAfterMs===60000);
});
