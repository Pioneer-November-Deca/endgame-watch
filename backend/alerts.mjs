import { queue } from './queue-runtime.mjs';
// Email fallback is deprecated. The browser owns sound and notification delivery.
export function createCoordinator({queue}){let stopping=false;return {async process(observation){if(!stopping)await queue.tick(observation,{allowEmail:false});},async stop(){stopping=true;}};}
const coordinator=createCoordinator({queue});
export const processQueue=observation=>coordinator.process(observation);
export const stopQueueDelivery=()=>coordinator.stop();
