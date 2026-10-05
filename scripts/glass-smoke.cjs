const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
(async()=>{
 const root=path.join(__dirname,'..'),env={...process.env,STARGLASS_DATA_DIR:path.join(root,'.test-data',`glass-${Date.now()}`)};delete env.ELECTRON_RUN_AS_NODE;
 const output=path.join(root,'test-results');fs.mkdirSync(output,{recursive:true});
 const app=await electron.launch({args:[root],env});
 try{
  const page=await app.firstWindow();await page.getByRole('heading',{name:'Bika-HarmonyOS'}).waitFor();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{window.glassFrames=[];window.captureTimes=[];window.stopGlassProbe=window.starglass.onGlass(frame=>{window.lastGlassFrame=frame;if(frame.ok){window.glassFrames.push(performance.now());window.captureTimes.push(frame.captureMs);}});});
  // Create a known local backdrop to validate capture alignment and avoid capturing personal desktop content in artifacts.
  await app.evaluate(async({BrowserWindow})=>{
   const panel=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='StarGlass'),b=panel.getBounds();
   const backdrop=new BrowserWindow({x:b.x-60,y:b.y-60,width:570,height:840,frame:false,show:false,skipTaskbar:true,webPreferences:{sandbox:true}});
   backdrop.setTitle('Glass test backdrop');
   await backdrop.loadURL('data:text/html,'+encodeURIComponent('<html><body style="margin:0;height:100vh;background:repeating-linear-gradient(55deg,#a1c0b2 0px,#dce7d2 80px,#8bac9b 160px,#507e71 240px)"></body></html>'));
   backdrop.setAlwaysOnTop(true);backdrop.show();panel.setAlwaysOnTop(true);panel.show();panel.moveTop();
  });
  await expect.poll(()=>page.locator('.liquid-canvas').getAttribute('data-rendered'),{timeout:15000}).toBe('true');
  await expect.poll(()=>page.evaluate(()=>window.glassFrames.length),{timeout:10000}).toBeGreaterThan(8);
  await expect.poll(()=>page.evaluate(()=>window.glassFrames.length),{timeout:15000}).toBeGreaterThan(150);
  const result=await page.evaluate(()=>{
   const canvas=document.querySelector('.liquid-canvas');const gl=canvas.getContext('webgl');const pixel=new Uint8Array(4);gl.readPixels(12,canvas.height/2|0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
   return {frames:window.glassFrames.length,elapsed:window.glassFrames.at(-1)-window.glassFrames[0],fps:1000*(window.glassFrames.length-21)/(window.glassFrames.at(-1)-window.glassFrames[20]),captureMs:window.captureTimes.slice(20).reduce((a,b)=>a+b,0)/window.captureTimes.slice(20).length,pixel:[...pixel],width:canvas.width,height:canvas.height,error:gl.getError()};
  });
  assert.equal(result.error,0);assert.equal(result.pixel[3],255);assert.ok(result.pixel[1]>30);
  await page.screenshot({path:path.join(output,'liquid-panel.png'),omitBackground:true});
  // Check that the captured region excludes the widget itself (solid-color backdrop).
  await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()!=='StarGlass');await w.webContents.executeJavaScript("document.body.style.background='rgb(34, 102, 153)'");});
  const before=await page.evaluate(()=>window.glassFrames.length);
  await expect.poll(()=>page.evaluate(()=>window.glassFrames.length)).toBeGreaterThan(before+2);
  const sourcePixel=await page.evaluate(()=>{const f=window.lastGlassFrame;const i=((f.height/2|0)*f.width+(f.width/2|0))*4;return [f.pixels[i+2],f.pixels[i+1],f.pixels[i],255];});
  const positions=await app.evaluate(({BrowserWindow,screen})=>BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),bounds:w.getBounds(),physical:screen.dipToScreenRect(w,w.getContentBounds())})));
  assert.ok(Math.abs(sourcePixel[0]-34)<8&&Math.abs(sourcePixel[1]-102)<8&&Math.abs(sourcePixel[2]-153)<8,`Capture recursion or alignment error: ${sourcePixel}; ${JSON.stringify(positions)}`);
  // Turning liquid off releases the native sampling process and canvas.
  await page.evaluate(async()=>{const s=await window.starglass.getState();await window.starglass.saveSettings({...s.settings,material:'acrylic'});});
  await expect(page.locator('.liquid-canvas')).toHaveCount(0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,render:result,sourcePixel,captureExclusion:true},null,2));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
