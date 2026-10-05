// Capture visibility is unconditional. Independent window GPU sources avoid
// feedback without ever excluding a panel or freezing the desktop.
class CaptureCoordinator {
 constructor({getBridges,onStatus}){Object.assign(this,{getBridges,onStatus});this.signature='';}
 reconcile(force=false){
  const entries=this.getBridges().filter(([,b])=>b);
  const signature=JSON.stringify(entries.map(([id,b])=>[id,b.connected]));
  if(!force&&signature===this.signature)return;this.signature=signature;
  for(const [,bridge]of entries)bridge.send('HOST captureLive');
  this.onStatus(entries.length&&entries.every(([,b])=>b.connected)?'live':'preparing');
 }
 acknowledge(){} // Accept old worker messages without entering snapshot mode.
 fail(){this.onStatus('error');}
 stop(){this.signature='';}
}
module.exports={CaptureCoordinator};
