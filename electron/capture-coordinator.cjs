// Keep every overlay excluded while it acquires a clean GPU background. Only
// expose the windows after ALL workers acknowledge that their background froze.
class CaptureCoordinator {
 constructor({getBridges,isEnabled,onStatus}){Object.assign(this,{getBridges,isEnabled,onStatus});this.round=0;this.signature='';this.ready=new Set();this.timer=null;}
 reconcile(force=false){
  const entries=this.getBridges().filter(([,b])=>b),enabled=this.isEnabled();
  const signature=JSON.stringify([enabled,entries.map(([id,b])=>[id,b.connected])]);
  if(!force&&signature===this.signature)return;this.signature=signature;this.round++;clearTimeout(this.timer);this.ready.clear();this.targets=null;
  for(const [,b]of entries)b.send('HOST captureOff');
  if(!enabled){this.onStatus('live');return;}
  if(!entries.length||entries.some(([,b])=>!b.connected)){this.onStatus('preparing');return;}
  this.targets=new Map(entries);const round=this.round;this.onStatus('preparing');
  for(const [,b]of entries)b.send(`HOST capturePrepare id=${round}`);
  this.timer=setTimeout(()=>{if(this.round===round)this.fail({id:round});},5000);
 }
 acknowledge(id,args){
  if(Number(args.id)!==this.round||!this.targets?.has(id)||!this.isEnabled())return;
  this.ready.add(id);if(this.ready.size!==this.targets.size)return;clearTimeout(this.timer);
  for(const b of this.targets.values())b.send(`HOST captureOn id=${this.round}`);this.onStatus('recordable');
 }
 fail(args){if(Number(args.id)!==this.round)return;this.round++;clearTimeout(this.timer);this.targets=null;this.ready.clear();for(const [,b]of this.getBridges())b?.send('HOST captureOff');this.onStatus('error');}
 stop(){clearTimeout(this.timer);this.round++;}
}
module.exports={CaptureCoordinator};
