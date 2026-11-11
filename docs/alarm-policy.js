export const FIRST_ALERT_SECONDS = 120;
export const FAILSAFE_MS = 30_000;

export function shouldAlertAll({member, now, sourceFresh, remainingMs}) {
  return Boolean(member?.state === 'active' && member.available && member.renewBy > now
    && sourceFresh && remainingMs > 0 && remainingMs <= FAILSAFE_MS);
}

export function shouldFocusAlarm({member,call,round,now,sourceFresh,sourceReset,remainingMs}){
 if(!member?.available||!call||call.memberId!==member.id||!round)return false;
 const deadline=call.status==='offered'?call.respondBy:call.status==='acknowledged'?call.actBy:0;
 return Boolean(member.renewBy>now&&deadline>now&&sourceFresh&&!sourceReset&&remainingMs>0);
}
