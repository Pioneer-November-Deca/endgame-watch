// Triple-beep groups repeat only while the selected watcher's offer is actionable.
export function createAlarmSound(){
 let key=null,nextAt=0,context=null;const nodes=new Set();
 function stop(){for(const node of nodes){try{node.stop();}catch{}try{node.disconnect();}catch{}}nodes.clear();key=null;nextAt=0;context=null;}
 function sync(audio,{id,enabled,remainingMs}){
  if(!audio||!enabled||!id||remainingMs<=0||audio.state==='suspended'){stop();return;}
  if(key!==id||context!==audio){stop();key=id;context=audio;}
  const start=audio.currentTime;if(start<nextAt)return;
  const end=start+remainingMs/1000;
  for(const offset of [0,.18,.36]){
   const at=start+offset,until=Math.min(at+.11,end);if(until-at<.025)continue;
   const tone=audio.createOscillator(),gain=audio.createGain();tone.frequency.value=880;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.12,at+.008);gain.gain.setValueAtTime(.12,Math.max(at+.008,until-.015));gain.gain.linearRampToValueAtTime(0,until);tone.connect(gain);gain.connect(audio.destination);nodes.add(tone);tone.onended=()=>{nodes.delete(tone);tone.disconnect();gain.disconnect();};tone.start(at);tone.stop(until);
  }
  nextAt=start+1.7;
 }
 return {sync,stop};
}
