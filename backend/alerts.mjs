import { queue } from './queue-runtime.mjs';
// Email is deprecated. A one-second pulse handles cascade deadlines between source polls.
export function createCoordinator({queue,pulseMs=0,now=Date.now}){
 let stopping=false,latest=null,busy=false,task=Promise.resolve();
 async function run(){if(stopping||busy||!latest)return;busy=true;const observation={...latest,seconds:Math.max(0,Math.ceil((latest.deadlineAt-now())/1000))};task=queue.tick(observation,{allowEmail:false});try{await task;}finally{busy=false;}}
 const pulse=pulseMs?setInterval(()=>run().catch(()=>console.error('queue_pulse_failed')),pulseMs):null;pulse?.unref();
 return {async process(observation){latest=observation;await run();},async stop(){stopping=true;if(pulse)clearInterval(pulse);await task;}};
}
const coordinator=createCoordinator({queue,pulseMs:1000});
export const processQueue=observation=>coordinator.process(observation);
export const stopQueueDelivery=()=>coordinator.stop();
