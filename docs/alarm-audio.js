// Triple-beep groups repeat only while the selected watcher's offer is actionable.
export function createAlarmSound(){
 let key=null,nextAt=0,context=null;const nodes=new Set();
 function stop(){for(const node of nodes){try{node.stop();}catch{}try{node.disconnect();}catch{}}nodes.clear();key=null;nextAt=0;context=null;}
 function sync(audio,{id,enabled,remainingMs}){
  if(!audio||!enabled||!id||remainingMs<=0||audio.state==='suspended'){stop();return;}
  if(key!==id||context!==audio){stop();key=id;context=audio;}
  const start=audio.currentTime;if(start<nextAt)return;
  const end=start+remainingMs/1000;
  for(const offset of [0,.28,.56]){
   const at=start+offset,until=Math.min(at+.16,end);if(until-at<.025)continue;
   const tone=audio.createOscillator(),gain=audio.createGain();tone.type='square';tone.frequency.value=1200;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.075,at+.008);gain.gain.setValueAtTime(.075,Math.max(at+.008,until-.015));gain.gain.linearRampToValueAtTime(0,until);tone.connect(gain);gain.connect(audio.destination);nodes.add(tone);tone.onended=()=>{nodes.delete(tone);tone.disconnect();gain.disconnect();};tone.start(at);tone.stop(until);
  }
  nextAt=start+2;
 }
 return {sync,stop};
}
// A quiet, one-off readiness cue, distinct from the repeating turn alarm.
export function createAttentionCue(){
 let played=null;const tones=new Set();
 function stop(){for(const tone of tones){try{tone.stop();}catch{}try{tone.disconnect();}catch{}}tones.clear();}
 function sync(audio,{key,enabled,suppressed=false}){
  if(!key){stop();played=null;return;}
  if(suppressed){stop();played=key;return;}
  if(!enabled||!audio||audio.state!=='running'){stop();return;}
  if(played===key)return;stop();played=key;
  for(const [offset,frequency] of [[0,330],[.19,390],[.4,620]]){const at=audio.currentTime+offset,tone=audio.createOscillator(),gain=audio.createGain();tone.type='sine';tone.frequency.value=frequency;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.055,at+.025);gain.gain.linearRampToValueAtTime(0,at+.15);tone.connect(gain);gain.connect(audio.destination);tones.add(tone);tone.onended=()=>{tones.delete(tone);tone.disconnect();gain.disconnect();};tone.start(at);tone.stop(at+.15);}
 }
 return {sync,stop};
}
