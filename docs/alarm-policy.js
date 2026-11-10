export function shouldFocusAlarm({member,call,round,now,sourceFresh,sourceReset,remainingMs}){
 if(!member?.available||!call||call.memberId!==member.id||!round)return false;
 const deadline=call.status==='offered'?call.respondBy:call.status==='acknowledged'?call.actBy:0;
 return Boolean(member.renewBy>now&&deadline>now&&sourceFresh&&!sourceReset&&remainingMs>0);
}
