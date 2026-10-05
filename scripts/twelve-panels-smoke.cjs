'use strict';
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','twelve-panels',String(Date.now()));fs.mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const {DEFAULTS}=require('../electron/core.cjs');
const repos=Array.from({length:12},(_,i)=>`demo/Repo${String(i+1).padStart(2,'0')}`);
const data=path.join(root,'.test-data',`twelve-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
const settings={...DEFAULTS,repos,mini:true,multiMini:true,alwaysOnTop:true,opacity:0,blur:0,gloss:0,refraction:0,dispersion:0,textColor:'auto',glassFps:30};
const projects=Object.fromEntries(repos.map(repo=>[repo,{stars:2048,downloads:12860,updatedAt:new Date().toISOString()}]));
fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings,projects,history:{},errors:{},token:''}));
const raw=path.join(out,'panel.raw'),requests=new Map();
function frameBrightness(file){
 const [w,h,fmt]=fs.readFileSync(file+'.txt','utf8').trim().split(/\s+/).map(Number);assert.ok([28,87,88].includes(fmt));
 const pixels=fs.readFileSync(file),values=[];assert.equal(pixels.length,w*h*4);
 for(let y=Math.floor(h*.21);y<=Math.floor(h*.27);y++)for(let x=Math.floor(w*.47);x<=Math.floor(w*.53);x++){
  const at=(y*w+x)*4;values.push((pixels[at]+pixels[at+1]+pixels[at+2])/3);
 }
 values.sort((a,b)=>a-b);return {w,h,brightness:values[Math.floor(values.length/2)],pixels};
}
const inkCount=pixels=>{let n=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>250&&[27,49,52].every((v,j)=>Math.abs(pixels[i+j]-v)<9))n++;return n;};
(async()=>{
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_TEST_HOOKS:'1',SG_TRACE_STATE:'1',SG_DUMP_FRAME:raw,SG_DUMP_AT:'60000'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.STARGLASS_TWELVE_PACKAGED==='1';
 const app=await electron.launch(packaged?{executablePath:path.join(root,'release/win-unpacked/StarGlass.exe'),args:[],env}:{args:[root],env});let log='';
 app.process().stdout.on('data',s=>log+=s);app.process().stderr.on('data',s=>log+=s);
 try{
  await app.firstWindow();
  await app.evaluate(async({BrowserWindow,screen,session})=>{
   session.defaultSession.webRequest.onBeforeRequest({urls:['https://api.github.com/*']},(_,done)=>done({cancel:true}));
   const w=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,skipTaskbar:true,show:false,alwaysOnTop:true,focusable:false});
   await w.loadURL('data:text/html,<body style="margin:0;background:%23fafafa;height:100vh"></body>');w.showInactive();global.__twelveBackdrop=w;
  });
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.panelBridge()?.connected),{timeout:25000}).toBe(true);
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.capsules().filter(c=>c.connected).length),{timeout:30000}).toBe(11);
  await expect.poll(()=>log).toContain('[shared-gpu] role=producer enabled=1');
  await expect.poll(()=>log.match(/\[shared-gpu\] role=consumer enabled=1/g)?.length||0).toBe(11);
  const captureAll=async()=>{
   await app.evaluate((_,all)=>{global.__starglassTest.captureFrame();for(const repo of all.slice(1))global.__starglassTest.captureFrame(repo);},repos);
   const frames=[];
   for(const [index,repo]of repos.entries()){
    const n=(requests.get(repo)||0)+1;requests.set(repo,n);
    const base=index===0?raw:`${raw}.${repo.replace(/[^a-z0-9]/gi,'-')}`;
    const file=`${base}.request-${n}`;await expect.poll(()=>fs.existsSync(file+'.txt'),{timeout:20000}).toBe(true);
    frames.push({...frameBrightness(file),repo,file});
   }
   return frames;
  };
  await pause(1500);const bright=await captureAll();
  assert.ok(bright.every(f=>f.brightness>170),`Some panels did not get the bright GPU background: ${bright.map(f=>f.brightness)}`);
  const opening=app.waitForEvent('window');await app.evaluate((_,repo)=>global.__starglassTest.showSettings(repo),repos[1]);const page=await opening;
  await expect(page.getByRole('combobox',{name:'配置面板',exact:true})).toHaveValue(repos[1]);
  const pure=page.getByRole('switch',{name:'仅显示玻璃',exact:true});await expect(pure).toBeEnabled();await pure.click();
  await page.getByRole('combobox',{name:'面板形状',exact:true}).selectOption('rectangle');
  await page.getByRole('slider',{name:'文字大小',exact:true}).fill('18');
  await page.getByRole('switch',{name:'自定义尺寸',exact:true}).click();
  await page.getByRole('slider',{name:'面板宽度',exact:true}).fill('430');
  await page.getByRole('slider',{name:'面板高度',exact:true}).fill('70');
  await page.getByRole('button',{name:'应用设置',exact:true}).click();
  await expect.poll(()=>JSON.parse(fs.readFileSync(path.join(data,'state.json'),'utf8')).settings.panelOverrides['demo/repo02']?.glassOnly).toBe(true);
  const stored=JSON.parse(fs.readFileSync(path.join(data,'state.json'),'utf8')).settings;
  assert.equal(stored.fontSize,14);assert.equal(stored.customSize,false);assert.equal(stored.glassOnly,false);
  await page.screenshot({path:path.join(out,'individual-settings.png')});
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await pause(600);
  const dpi=await app.evaluate(({screen})=>screen.getPrimaryDisplay().scaleFactor);
  const individual=await captureAll();assert.equal(individual[1].w,Math.round(430*dpi));assert.equal(individual[1].h,Math.round(70*dpi));
  assert.equal(individual[0].w,Math.round(320*dpi));assert.ok(inkCount(individual[1].pixels)<20,'Glass-only mini still contains text');
  // GPU sharing must keep EVERY window live after a desktop change, not merely
  // create twelve processes with eleven frozen or empty backgrounds.
  await app.evaluate(()=>global.__twelveBackdrop.webContents.executeJavaScript('document.body.style.background="#080c10"'));
  await pause(1800);const dark=await captureAll();
  assert.ok(dark.every(f=>f.brightness<80),`Some panels froze or failed to consume a GPU frame: ${dark.map(f=>f.brightness)}`);
  await app.evaluate(()=>global.__twelveBackdrop.webContents.executeJavaScript('document.body.style.background="#fafafa"'));
  await pause(1500);const restored=await captureAll();assert.ok(restored.every(f=>f.brightness>170));
  // Old capture toggles must not freeze or exclude any of the twelve workers.
  await app.evaluate(()=>{const t=global.__starglassTest;t.updateSettings({...t.snapshot().settings,allowScreenCapture:true});});
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.snapshot().captureStatus),{timeout:15000}).toBe('live');
  await app.evaluate(()=>{const t=global.__starglassTest;t.updateSettings({...t.snapshot().settings,allowScreenCapture:false});});
  await app.evaluate((_,repo)=>global.__starglassTest.showSettings(repo),repos[1]);
  await expect(page.getByRole('combobox',{name:'配置面板',exact:true})).toHaveValue(repos[1]);
  await page.getByRole('button',{name:'恢复默认外观',exact:true}).click();await page.getByRole('button',{name:'应用设置',exact:true}).click();
  await expect.poll(()=>JSON.parse(fs.readFileSync(path.join(data,'state.json'),'utf8')).settings.panelOverrides['demo/repo02']).toBeUndefined();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await pause(300);const reset=await captureAll();assert.equal(reset[1].w,Math.round(320*dpi));
  console.log(JSON.stringify({passed:true,packaged,twelveLivePanels:true,sharedGPU:true,independentSettings:true,miniGlassOnly:true,resetAppearance:true,twelveLiveCapture:true,out}));
 }finally{fs.writeFileSync(path.join(out,'run.log'),log);await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
