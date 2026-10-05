import React,{useEffect,useRef} from 'react';
import fragment from './fragment.glsl?raw';
import {api,isDesktop} from '../api';
import {createAutoTextPolicy} from './auto-text.mjs';
const vertex=`attribute vec2 a_position; varying vec2 v_uv; void main(){v_uv=vec2((a_position.x+1.0)*.5,(1.0-a_position.y)*.5);gl_Position=vec4(a_position,0,1);}`;
const tints={pearl:[.89,.94,.945],ocean:[.67,.82,.96],rose:[.95,.8,.83],graphite:[.41,.48,.56]};
function demoSource(width,height,margin){
  const canvas=document.createElement('canvas');canvas.width=width+2*margin;canvas.height=height+2*margin;
  const c=canvas.getContext('2d');
  const gradient=c.createLinearGradient(0,0,canvas.width,canvas.height);gradient.addColorStop(0,'#dce4cf');gradient.addColorStop(.45,'#9abaaa');gradient.addColorStop(1,'#537e70');c.fillStyle=gradient;c.fillRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<4;i++){c.beginPath();c.ellipse(width*(.12+i*.36),height*(.3+i*.2),width*.3,height*.8,-.65,0,Math.PI*2);const g=c.createLinearGradient(0,i*100,width,height);g.addColorStop(0,'#eaf0db');g.addColorStop(.5,'#a4c2af');g.addColorStop(1,'#527f72');c.fillStyle=g;c.fill();}
  return canvas;
}
export function LiquidGlass({settings,demo,onStatus}){
  const ref=useRef(null),params=useRef(settings),renderRef=useRef(null);
  params.current=settings;
  useEffect(()=>{renderRef.current?.();},[settings]);
  useEffect(()=>{
    const canvas=ref.current;let disposed=false,loaded=false,sourceSize=[1,1],margin=0,bgra=0,pending=null,raf=0;
    const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
    if(!gl){onStatus({ok:false,error:'WebGL 不可用，已回退到柔雾玻璃'});return;}
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
    let program,texture,buffer,vs,fs;
    try{vs=compile(gl.VERTEX_SHADER,vertex);fs=compile(gl.FRAGMENT_SHADER,fragment);program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));}
    catch(e){onStatus({ok:false,error:'玻璃着色器初始化失败，已回退到柔雾玻璃'});console.error(e);return;}
    gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    const u=Object.fromEntries(['size','source','margin','scale','refraction','dispersion','gloss','blur','opacity','tint','pointer','bgra','pure','radius'].map(n=>[n,gl.getUniformLocation(program,`u_${n}`)]));
    let pointer=[.3,.2],colorPixels=null,colorCanvas=null,autoLight=false,colorMode='',lastColorSample=-Infinity,colorPolicy=createAutoTextPolicy();
    function draw(){if(disposed||!loaded||gl.isContextLost())return;const s=params.current;const scale=window.devicePixelRatio||1;const w=Math.round(canvas.clientWidth*scale),h=Math.round(canvas.clientHeight*scale);if(!w||!h)return;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}gl.viewport(0,0,w,h);gl.useProgram(program);gl.uniform2f(u.size,w,h);gl.uniform2f(u.source,...sourceSize);gl.uniform1f(u.margin,margin);gl.uniform1f(u.scale,scale);gl.uniform1f(u.refraction,s.refraction??32);gl.uniform1f(u.dispersion,s.dispersion??8);gl.uniform1f(u.gloss,s.gloss/100);gl.uniform1f(u.blur,s.blur);gl.uniform1f(u.opacity,s.opacity/100);gl.uniform1f(u.bgra,bgra);gl.uniform1f(u.pure,s.material==='pure'?1:0);gl.uniform1f(u.radius,s.radius??28);gl.uniform3f(u.tint,...tints[s.tint]);gl.uniform2f(u.pointer,...pointer);gl.drawArrays(gl.TRIANGLES,0,6);canvas.dataset.rendered='true';updateTextColor(s);}
    function updateTextColor(s){
      const now=performance.now();
      if(colorMode!==s.textColor){colorMode=s.textColor;colorPolicy=createAutoTextPolicy();lastColorSample=-Infinity;}
      if(s.textColor==='auto' && now-lastColorSample>=125){
        const box=canvas.getBoundingClientRect(),samples=[],ctx=colorCanvas?.getContext('2d');
        if(box.width&&box.height&&(colorPixels||ctx)){
          const fields=canvas.parentElement.querySelectorAll('.brand>span,.repo-title h1,.repo-title>span,.stat-label,.stat strong,.stat-bottom,.trend-head,.repo-meta,.panel-footer,.mini-project,.mini-metric b');
          for(const el of fields){const b=el.getBoundingClientRect();
            for(let y=0;y<2;y++)for(let x=0;x<4;x++){
              const u=(b.left-box.left+b.width*(x+.5)/4)/box.width,v=(b.top-box.top+b.height*(y+.5)/2)/box.height;
              if(u<.04||u>.96||v<.04||v>.96)continue;
              const sx=Math.max(0,Math.min(sourceSize[0]-1,Math.round(margin+u*(sourceSize[0]-2*margin)))),sy=Math.max(0,Math.min(sourceSize[1]-1,Math.round(margin+v*(sourceSize[1]-2*margin))));
              const i=(sy*sourceSize[0]+sx)*4,p=colorPixels||ctx.getImageData(sx,sy,1,1).data,j=colorPixels?i:0;
              const rgb=colorPixels?[p[j+2],p[j+1],p[j]]:[p[j],p[j+1],p[j+2]],tint=tints[s.tint],mix=s.opacity/100*.64;
              samples.push(rgb.map((c,k)=>c/255*(1-mix)+tint[k]*mix));
            }
          }
          autoLight=colorPolicy.sample(samples,now);lastColorSample=now;
        }
      }
      onStatus({ok:true,dark:autoLight});
    }
    renderRef.current=draw;
    function upload(image,m){if(disposed)return;sourceSize=[image.width,image.height];margin=m;bgra=0;colorCanvas=image;colorPixels=null;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);loaded=true;draw();}
    function receive(frame){
      if(disposed)return;
      if(!frame.ok){pending=null;loaded=false;canvas.dataset.rendered='false';onStatus(frame);return;}
      pending=frame;
      if(raf)return;
      raf=requestAnimationFrame(()=>{raf=0;const f=pending;pending=null;if(disposed||!f||gl.isContextLost())return;
        const pixels=f.pixels instanceof Uint8Array?f.pixels:new Uint8Array(f.pixels);
        gl.bindTexture(gl.TEXTURE_2D,texture);
        if(sourceSize[0]===f.width&&sourceSize[1]===f.height&&loaded)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,f.width,f.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,f.width,f.height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        sourceSize=[f.width,f.height];margin=f.margin;bgra=1;loaded=true;
        colorPixels=pixels;colorCanvas=null;draw();
      });
    }
    function makeDemo(){const scale=window.devicePixelRatio||1;const width=Math.round(canvas.clientWidth*scale),height=Math.round(canvas.clientHeight*scale);const m=36*scale;upload(demoSource(width,height,m),m);}
    const unsubscribe=demo||!isDesktop ? ()=>{} : api.onGlass(receive);
    const observer=new ResizeObserver(()=>{if(demo||!isDesktop)makeDemo();else draw();});observer.observe(canvas);
    if(demo||!isDesktop)makeDemo();
    function move(e){const box=canvas.getBoundingClientRect();pointer=[(e.clientX-box.left)/box.width,(e.clientY-box.top)/box.height];draw();}
    canvas.parentElement.addEventListener('pointermove',move);
    const parent=canvas.parentElement;
    const lost=e=>{e.preventDefault();loaded=false;onStatus({ok:false,error:'显卡上下文已丢失，请重新选择液态玻璃以重试'});};canvas.addEventListener('webglcontextlost',lost);
    return()=>{disposed=true;cancelAnimationFrame(raf);pending=null;renderRef.current=null;unsubscribe();observer.disconnect();parent.removeEventListener('pointermove',move);canvas.removeEventListener('webglcontextlost',lost);gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);gl.getExtension('WEBGL_lose_context')?.loseContext();};
  },[demo]);
  return <canvas className="liquid-canvas" ref={ref} aria-label="实时液态玻璃背景"/>;
}
