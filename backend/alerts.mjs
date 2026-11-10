import { queue } from './queue-runtime.mjs';
import { alertReady,sendFallback,privateLink } from './mailgun.mjs';
import { fetchCampaign } from './gamefound-api.mjs';
import { shouldAlert } from './domain.mjs';
// Email delivery must never block the five-second source watcher or reset handling.
export function createCoordinator({queue,source=fetchCampaign,enabled=alertReady,send=sendFallback,link=token=>privateLink('access',token)}){
 let stopping=false,sending=false,task=Promise.resolve();
 async function dispatch(reservations){
  let cancelled=false;
  for(const reservation of reservations){
   let attempted=false;
   try{
    if(stopping||cancelled||!enabled()){await queue.finishMail(reservation.id,'cancelled');continue;}
    const fresh=await source();
    if(!shouldAlert(fresh)||Date.parse(fresh.campaignEndDate)!==reservation.sourceDeadline||!await queue.canSend(reservation)){
     cancelled=true;await queue.finishMail(reservation.id,'cancelled');continue;
    }
    attempted=true;const result=await send(reservation.email,fresh.seconds,link(reservation.token));
    await queue.finishMail(reservation.id,result.ok?'accepted':'rejected',result.id);
    console.log(JSON.stringify({event:'queue_fallback',status:result.ok?'accepted':'rejected'}));
   }catch{cancelled=true;await queue.finishMail(reservation.id,attempted?'delivery-unknown':'cancelled');if(attempted)console.error('queue_fallback_delivery_unknown');}
  }
 }
 return {
  async process(observation){
   if(stopping)return;
   const reservations=await queue.tick(observation,{allowEmail:enabled()&&!sending});
   if(reservations.length){sending=true;task=dispatch(reservations).catch(()=>console.error('queue_fallback_worker_failed')).finally(()=>{sending=false;});}
  },
  async stop(){stopping=true;await task;}
 };
}
const coordinator=createCoordinator({queue});
export const processQueue=observation=>coordinator.process(observation);
export const stopQueueDelivery=()=>coordinator.stop();
