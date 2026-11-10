import { CAMPAIGN_URL } from './domain.mjs';
export function mailConfig(){const e=process.env;return {key:e.MAILGUN_API_KEY,domain:e.MAILGUN_DOMAIN,from:e.MAILGUN_FROM,base:e.MAILGUN_REGION==='EU'?'https://api.eu.mailgun.net':'https://api.mailgun.net'};}
export function mailReady(){const c=mailConfig();return Boolean(c.key&&c.domain&&c.from);}
export function signupReady(){return mailReady()&&process.env.SIGNUPS_ENABLED==='true';}
export function alertReady(){return mailReady()&&process.env.ALERTS_ENABLED==='true';}
export function privateLink(kind,token){const base=process.env.PUBLIC_SITE_URL||'https://pioneer-november-deca.github.io/endgame-watch/';return base+'#'+kind+'='+token;}
export async function requestMailgun(path,fields){
 const c=mailConfig(),body=new FormData();for(const[k,v]of Object.entries(fields))body.set(k,v);
 const response=await fetch(c.base+path,{method:'POST',headers:{Authorization:'Basic '+Buffer.from('api:'+c.key).toString('base64')},body,signal:AbortSignal.timeout(15000)});
 let result={};try{result=await response.json();}catch{}return {ok:response.ok,status:response.status,id:typeof result.id==='string'?result.id:null};
}
export async function sendConfirmation(email,url){const c=mailConfig();return requestMailgun('/v3/'+encodeURIComponent(c.domain)+'/messages',{from:c.from,to:email,subject:'Verify your Endgame Watch fallback email',text:'Confirm that this address may receive occasional critical fallback alerts for Satisfactory. Your web queue works without email.\n\n'+url+'\n\nThis link expires in 30 minutes. If you did not request this, ignore this message.','o:tracking':'no'});}
export async function sendFallback(email,seconds,url){const c=mailConfig();return requestMailgun('/v3/'+encodeURIComponent(c.domain)+'/messages',{from:c.from,to:email,subject:'Endgame Watch: help needed below 2 minutes',text:'The reported Gamefound countdown was '+seconds+' seconds remaining, and nobody had acknowledged the on-call role.\n\nOpen your private queue to volunteer, pass, mark your one extension complete, or stop alerts:\n'+url+'\n\nCampaign:\n'+CAMPAIGN_URL+'\n\nThe timer may already have reset by the time this arrives. Check the live page before acting. Email delivery is not guaranteed.','o:tag':'endgame-critical-fallback','o:tracking':'no'});}
