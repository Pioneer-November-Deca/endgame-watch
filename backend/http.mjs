import { gzipSync } from 'node:zlib';
import { createHash,randomBytes } from 'node:crypto';
import { CAMPAIGN_ID,CAMPAIGN_URL,normalizeEmail,publicObservation } from './domain.mjs';
import { REGIONS } from '../docs/regions.js';
import * as defaultMail from './mailgun.mjs';
export function createHandler({db,queue,mail=defaultMail,publicOrigin=process.env.PUBLIC_ORIGIN||'https://pioneer-november-deca.github.io',production=process.env.NODE_ENV==='production'}){
 const salt=process.env.RATE_LIMIT_SALT||randomBytes(32).toString('hex');
 const token=req=>req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 let cachedView,viewUntil=0,viewRequest,roster;
 async function sharedView(){
  if(viewRequest)return viewRequest;
  if(Date.now()<viewUntil)return cachedView;
  viewRequest=Promise.all([
   queue.snapshot(null),
   db.query('SELECT * FROM watch_observation WHERE campaign_id=$1',[CAMPAIGN_ID])
  ]).then(([view,result])=>{
   cachedView={view,observation:result.rows[0]};
   viewUntil=Date.now()+500;
   return cachedView;
  }).finally(()=>{viewRequest=null;});
  return viewRequest;
 }
 function sendRoster(req,res,rows){
  if(roster?.rows!==rows){
   const raw=JSON.stringify({rows});
   if(roster?.raw!==raw)roster={raw,gzip:gzipSync(raw,{level:1}),etag:'W/"'+createHash('sha256').update(raw).digest('hex')+'"'};
   roster.rows=rows;
  }
  res.setHeader('Vary','Origin, Accept-Encoding');
  res.setHeader('Cache-Control','private, no-cache');
  res.setHeader('ETag',roster.etag);
  if(req.headers['if-none-match']===roster.etag){res.writeHead(304);res.end();return;}
  const gzip=(req.headers['accept-encoding']||'').split(',').some(value=>{
   const [coding,quality]=value.trim().split(/\s*;\s*q=/i);
   return coding.toLowerCase()==='gzip'&&(quality===undefined||Number(quality)>0);
  });
  const body=gzip?roster.gzip:Buffer.from(roster.raw);
  if(gzip)res.setHeader('Content-Encoding','gzip');
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length});
  res.end(body);
 }
 async function read(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2048)throw Object.assign(new Error(),{status:413,publicMessage:'Request too large.'});chunks.push(chunk);}try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw Object.assign(new Error(),{status:400,publicMessage:'Invalid request.'});}}
 async function rate(key,limit){const hashed=createHash('sha256').update(salt+key).digest('hex');const r=await db.query(`INSERT INTO watch_rate(key_hash,hits,expires_at) VALUES($1,1,now()+interval '1 hour') ON CONFLICT(key_hash) DO UPDATE SET hits=CASE WHEN watch_rate.expires_at<now() THEN 1 ELSE watch_rate.hits+1 END,expires_at=CASE WHEN watch_rate.expires_at<now() THEN now()+interval '1 hour' ELSE watch_rate.expires_at END RETURNING hits`,[hashed]);return r.rows[0].hits<=limit;}
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Vary','Origin');
  const origin=req.headers.origin,allowed=origin===publicOrigin||(!production&&/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin||''));
  if(allowed){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Max-Age','600');}
  try{
   const url=new URL(req.url,'http://localhost');
   if(req.method==='OPTIONS'){res.writeHead(allowed?204:403);res.end();return;}
   if(req.method==='POST'&&!allowed)return json(res,403,{message:'Request origin rejected.'});
   if(req.method==='GET'&&url.pathname==='/healthz'){await db.query('SELECT 1');return json(res,200,{status:'ok'});}
   if(req.method==='GET'&&url.pathname==='/api/status'){
    const row=(await db.query('SELECT * FROM watch_observation WHERE campaign_id=$1',[CAMPAIGN_ID])).rows[0];
    return json(res,200,{...publicObservation(row),campaignUrl:CAMPAIGN_URL,thresholdSeconds:120,onCallSeconds:queue.onCallSeconds,testMode:queue.onCallSeconds===540,emailDeprecated:true,queueEnabled:true,regions:REGIONS});
   }
   if(req.method==='GET'&&url.pathname==='/api/live'){
    const [{view,observation},member]=await Promise.all([sharedView(),queue.session(token(req))]);
    const {upgradeOrder,lastMissed,nextUp,total,watchingCount,maxWatchers,round,call}=view;
    const signal={...publicObservation(observation),onCallSeconds:queue.onCallSeconds,testMode:queue.onCallSeconds===540};
    return json(res,200,{signal,upgradeOrder,lastMissed,nextUp,total,watchingCount,maxWatchers,round,call,serverTime:signal.serverTime,me:queue.memberView(member),myRow:member?view.rows.find(row=>row.id===member.id):undefined});
   }
   if(req.method==='GET'&&url.pathname==='/api/roster'){
    const {view}=await sharedView();
    return sendRoster(req,res,view.rows);
   }
   if(req.method==='GET'&&url.pathname==='/api/queue'){const {mailBudget,...view}=await queue.snapshot(token(req));return json(res,200,view);}
   if(req.method==='POST'&&url.pathname==='/api/queue/join'){
    const data=await read(req);if(data.website||data.consent!==true)return json(res,400,{message:'Confirm your eligibility and agreement to join the public alias queue.'});
    const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',')[0];
    if(!await rate('join-ip:'+ip,5)||!await rate('join-global',1000))return json(res,429,{message:'Too many new queue entries. Please try again later.'});
    return json(res,201,await queue.join(data));
   }
   if(req.method==='POST'&&url.pathname==='/api/queue/heartbeat'){const data=await read(req);return json(res,200,await queue.heartbeat(token(req),data.tabId));}
   if(req.method==='POST'&&url.pathname==='/api/queue/disconnect'){const data=await read(req);return json(res,200,await queue.disconnect(data.token,data.tabId));}
   if(req.method==='POST'&&url.pathname==='/api/queue/action'){const data=await read(req);return json(res,200,await queue.action(token(req),data.action,data));}
   // DEPRECATED: never collect addresses or send email, including with old provider settings.
   if(['/api/queue/email','/api/queue/verify-email','/api/queue/exchange','/api/subscribe','/confirm'].includes(url.pathname))return json(res,410,{message:'Email fallback has been deprecated. Use browser on-call alerts.'});
   return json(res,404,{message:'Not found.'});
  }catch(error){if(!error.publicMessage)console.error('queue_request_failed');return json(res,error.status||503,{message:error.publicMessage||'Service temporarily unavailable. Please try again.'});}
 };
}
