// Decode length-prefixed frames without repeatedly concatenating chunks.
class FrameReader {
 constructor(onFrame,onError){this.onFrame=onFrame;this.onError=onError;this.header=Buffer.alloc(4);this.reset();}
 reset(){this.headerBytes=0;this.body=null;this.bodyBytes=0;}
 push(chunk){let offset=0;while(offset<chunk.length){
  if(this.headerBytes<4){const n=Math.min(4-this.headerBytes,chunk.length-offset);chunk.copy(this.header,this.headerBytes,offset,offset+n);this.headerBytes+=n;offset+=n;if(this.headerBytes<4)return;const length=this.header.readUInt32LE();if(length>2400*2400*4){this.reset();this.onError(new Error('无效的背景帧'));return;}if(!length){this.reset();this.onError(new Error('背景采样暂不可用'));continue;}this.body=Buffer.allocUnsafe(length);}
  const n=Math.min(this.body.length-this.bodyBytes,chunk.length-offset);chunk.copy(this.body,this.bodyBytes,offset,offset+n);this.bodyBytes+=n;offset+=n;
  if(this.bodyBytes===this.body.length){const frame=this.body;this.reset();this.onFrame(frame);}
 }}
}
function roundWindowShape(width,height,radius){const r=Math.min(radius,width/2,height/2),rects=[{x:0,y:Math.ceil(r),width,height:Math.max(1,height-2*Math.ceil(r))}];for(let y=0;y<Math.ceil(r);y++){const inset=Math.ceil(r-Math.sqrt(Math.max(0,r*r-(r-y-.5)**2)));rects.push({x:inset,y,width:width-2*inset,height:1},{x:inset,y:height-1-y,width:width-2*inset,height:1});}return rects;}
module.exports={FrameReader,roundWindowShape};

