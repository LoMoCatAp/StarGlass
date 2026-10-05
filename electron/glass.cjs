const {spawn}=require('node:child_process');
const path=require('node:path');
const {FrameReader}=require('./frame-reader.cjs');
class GlassCapture {
 constructor(options){Object.assign(this,options);this.child=null;this.pending=null;this.active=false;this.timer=null;this.generation=0;this.locked=false;}
 startProcess(){
  if(this.child)return;
  const binary=this.app.isPackaged?path.join(process.resourcesPath,'GlassCapture.exe'):path.join(__dirname,'../assets/GlassCapture.exe');
  const child=spawn(binary,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});this.child=child;
  const complete=(error,pixels)=>{if(this.child!==child||!this.pending)return;const p=this.pending;this.pending=null;clearTimeout(p.timer);error?p.reject(error):p.resolve(pixels);};
  const reader=new FrameReader(pixels=>complete(null,pixels),error=>complete(error));child.stdout.on('data',chunk=>reader.push(chunk));
  const failed=()=>{if(this.child!==child)return;complete(new Error('背景采样器不可用'));this.child=null;if(!child.killed)child.kill();};
  child.once('error',failed);child.once('exit',failed);child.stdin.on('error',failed);
 }
 async capture(){
  const started=performance.now();
  this.startProcess();
  const bounds=this.panel.getContentBounds(),physical=this.screen.dipToScreenRect(this.panel,bounds);
  const scale=physical.width/bounds.width,margin=Math.round(32*scale),physicalMargin=margin;
  const width=physical.width+2*margin,height=physical.height+2*margin;
  const pixels=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending=null;const child=this.child;this.child=null;child?.kill();reject(new Error('背景采样超时'));},3000);this.pending={resolve,reject,timer};
   this.child.stdin.write([physical.x-physicalMargin,physical.y-physicalMargin,physical.width+2*physicalMargin,physical.height+2*physicalMargin,width,height,Math.round(this.fps)].join(' ')+'\n');
  });
  if(pixels.length!==width*height*4)throw new Error('背景帧尺寸不匹配');
  return {pixels,width,height,margin,format:'bgra',capturedAt:Date.now(),captureMs:performance.now()-started};
 }
 setActive(value,fps=60){this.fps=Math.min(60,Math.max(15,fps || 60));if(this.active===value)return;this.active=value;this.generation++;clearTimeout(this.timer);if(value)this.loop(this.generation);else this.stopProcess();}
 async loop(generation){
  if(!this.active||generation!==this.generation)return;const started=performance.now();let failed=false;
  if(!this.locked&&this.panel.isVisible()&&!this.panel.isMinimized()){
   try{const frame=await this.capture();if(this.active&&generation===this.generation)this.send({...frame,ok:true});}
   catch(e){failed=true;if(this.active&&generation===this.generation)this.send({ok:false,error:e.message});}
  }
  // The sampler paces frames with a high-resolution timer. Windows main-process
  // setTimeout otherwise adds a ~15 ms scheduling tick to every captured frame.
  if(this.active&&generation===this.generation){
   if(failed||this.locked||!this.panel.isVisible())this.timer=setTimeout(()=>this.loop(generation),failed?2000:250);
   else this.timer=setImmediate(()=>this.loop(generation));
  }
 }
 stopProcess(){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('采样已暂停'));this.pending=null;}const child=this.child;this.child=null;child?.kill();}
 dispose(){this.active=false;this.generation++;clearTimeout(this.timer);this.stopProcess();}
}
module.exports={GlassCapture};

