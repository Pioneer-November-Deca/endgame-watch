import { createHash,randomBytes } from 'node:crypto';
import { CAMPAIGN_ID,CAMPAIGN_URL,normalizeEmail,publicObservation } from './domain.mjs';
import { REGIONS } from '../docs/regions.js';
import * as defaultMail from './mailgun.mjs';
export function createHandler({db,queue,mail=defaultMail,publicOrigin=process.env.PUBLIC_ORIGIN||'https://pioneer-november-deca.github.io',production=process.env.NODE_ENV==='production'}){
 const salt=process.env.RATE_LIMIT_SALT||randomBytes(32).toString('hex');
 const token=req=>req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 async function read(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2048)throw Object.assign(new Error(),{status:413,publicMessage:'Request too large.'});chunks.push(chunk);}try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw Object.assign(new Error(),{status:400,publicMessage:'Invalid request.'});}}
 async function rate(key,limit){const hashed=createHash('sha256').update(salt+key).digest('hex');const r=await db.query(`INSERT INTO watch_rate(key_hash,hits,expires_at) VALUES($1,1,now()+interval '1 hour') ON CONFLICT(key_hash) DO UPDATE SET hits=CASE WHEN watch_rate.expires_at<now() THEN 1 ELSE watch_rate.hits+1 END,expires_at=CASE WHEN watch_rate.expires_at<now() THEN now()+interval '1 hour' ELSE watch_rate.expires_at END RETURNING hits`,[hashed]);return r.rows[0].hits<=limit;}
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Vary','Origin');
  const origin=req.headers.origin,allowed=origin===publicOrigin||(!production&&/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin||''));
  if(allowed){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');}
  try{
   const url=new URL(req.url,'http://localhost');
   if(req.method==='OPTIONS'){res.writeHead(allowed?204:403);res.end();return;}
   if(req.method==='POST'&&!allowed)return json(res,403,{message:'Request origin rejected.'});
   if(req.method==='GET'&&url.pathname==='/healthz'){await db.query('SELECT 1');return json(res,200,{status:'ok'});}
   if(req.method==='GET'&&url.pathname==='/api/status'){
    const row=(await db.query('SELECT * FROM watch_observation WHERE campaign_id=$1',[CAMPAIGN_ID])).rows[0];
    return json(res,200,{...publicObservation(row),campaignUrl:CAMPAIGN_URL,thresholdSeconds:120,onCallSeconds:300,signupEnabled:mail.signupReady(),alertsEnabled:mail.alertReady(),queueEnabled:true,regions:REGIONS});
   }
   if(req.method==='GET'&&url.pathname==='/api/queue')return json(res,200,await queue.snapshot(token(req)));
   if(req.method==='POST'&&url.pathname==='/api/queue/join'){
    const data=await read(req);if(data.website||data.consent!==true)return json(res,400,{message:'Confirm your eligibility and agreement to join the public alias queue.'});
    const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',')[0];
    if(!await rate('join-ip:'+ip,5)||!await rate('join-global',1000))return json(res,429,{message:'Too many new queue entries. Please try again later.'});
    return json(res,201,await queue.join(data));
   }
   if(req.method==='POST'&&url.pathname==='/api/queue/heartbeat'){await read(req);return json(res,200,await queue.heartbeat(token(req)));}
   if(req.method==='POST'&&url.pathname==='/api/queue/action'){const data=await read(req);return json(res,200,await queue.action(token(req),data.action,data));}
   if(req.method==='POST'&&url.pathname==='/api/queue/email'){
    if(!mail.signupReady())return json(res,503,{message:'Email fallback is not configured yet. Your web queue still works; no email address was collected.'});
    const data=await read(req),email=normalizeEmail(data.email);if(!email||data.consent!==true)return json(res,400,{message:'Enter a valid email and agree to critical fallback alerts.'});
    const reservation=await queue.requestEmail(token(req),email);
    try{const result=await mail.sendConfirmation(email,mail.privateLink('verify',reservation.token));await queue.finishMail(reservation.id,result.ok?'accepted':'rejected',result.id);return json(res,result.ok?200:502,{message:result.ok?'Check your inbox and confirm fallback email.':'Could not send verification. The web queue remains available.'});}
    catch{await queue.finishMail(reservation.id,'delivery-unknown');return json(res,502,{message:'Email delivery is uncertain. Check your inbox before requesting another.'});}
   }
   if(req.method==='POST'&&url.pathname==='/api/queue/verify-email'){const data=await read(req);return json(res,200,await queue.verifyEmail(data.token));}
   if(req.method==='POST'&&url.pathname==='/api/queue/exchange'){const data=await read(req);return json(res,200,await queue.exchange(data.token));}
   if(url.pathname==='/api/subscribe'||url.pathname==='/confirm')return json(res,410,{message:'Join the web queue first. Email is now an optional fallback in your private panel.'});
   return json(res,404,{message:'Not found.'});
  }catch(error){if(!error.publicMessage)console.error('queue_request_failed');return json(res,error.status||503,{message:error.publicMessage||'Service temporarily unavailable. Please try again.'});}
 };
}
