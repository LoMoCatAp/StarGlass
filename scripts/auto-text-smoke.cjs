'use strict';
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','auto-text');fs.mkdirSync(out,{recursive:true});
 const data=path.join(root,'.test-data',`auto-text-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
 const {DEFAULTS}=require('../electron/core.cjs'),repo='LoMoCatAp/Bika-HarmonyOS';
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{...DEFAULTS,repos:[repo],alwaysOnTop:true,opacity:0,blur:0,gloss:0,refraction:0,dispersion:0},projects:{[repo]:{stars:2048,downloads:12860,forks:12,version:'v1.4.0',description:'背景自适应文字测试',updatedAt:new Date().toISOString()}},history:{},errors:{},token:''}));
 const raw=path.join(out,'panel.raw');
 for(const f of fs.readdirSync(out))if(/^panel\.raw.*\.txt$/.test(f))fs.rmSync(path.join(out,f),{force:true});
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_TEST_HOOKS:'1',SG_TRACE_STATE:'1',SG_DUMP_FRAME:raw,SG_DUMP_AT:'60000'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[root],env});let log='';app.process().stdout.on('data',s=>log+=s);app.process().stderr.on('data',s=>log+=s);
 try{
  await app.firstWindow();
  await app.evaluate(async({BrowserWindow,screen,session})=>{
   session.defaultSession.webRequest.onBeforeRequest({urls:['https://api.github.com/*']},(_,done)=>done({cancel:true}));
   const w=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,show:false,skipTaskbar:true});
   await w.loadURL('data:text/html,<body style="margin:0;background:%23fafafa;height:100vh"></body>');w.show();global.__autoBackdrop=w;
  });
  const changeBackground=color=>app.evaluate((_,c)=>global.__autoBackdrop.webContents.executeJavaScript(`document.body.style.background=${JSON.stringify(c)}`),color);
  const changeSettings=patch=>app.evaluate((_,p)=>global.__starglassTest.updateSettings({...global.__starglassTest.snapshot().settings,...p}),patch);
  let captureIndex=0;
  const capture=async(settle=300)=>{await pause(settle);await app.evaluate(()=>global.__starglassTest.captureFrame());const file=`${raw}.request-${++captureIndex}`;await expect.poll(()=>fs.existsSync(file+'.txt')).toBe(true);return file;};
  const waitTransition=target=>new Promise((resolve,reject)=>{
   const start=log.length,process=app.process();
   const check=()=>{if(log.slice(start).includes(`to=${target.toFixed(3)} durationMs=250`)){clearTimeout(timer);process.stdout.off('data',check);resolve();}};
   const timer=setTimeout(()=>{process.stdout.off('data',check);reject(new Error('Color transition did not start'));},8000);
   process.stdout.on('data',check);
  });
  const opening=app.waitForEvent('window');await app.evaluate(()=>global.__starglassTest.showSettings());const settings=await opening;
  await settings.getByRole('combobox',{name:'面板文字颜色',exact:true}).selectOption('auto');
  await settings.getByRole('button',{name:'应用设置',exact:true}).click();
  assert.equal(JSON.parse(fs.readFileSync(path.join(data,'state.json'),'utf8')).settings.textColor,'auto');
  await settings.getByRole('button',{name:'关闭设置',exact:true}).click();
  await expect.poll(()=>log,{timeout:12000}).toContain('GPU sampler ready');
  await expect.poll(()=>log,{timeout:12000}).toContain('mode=auto color=dark');
  const bright=await capture();
  let at=log.length;const lightTransition=waitTransition(1);await changeBackground('#080c10');
  await lightTransition;await pause(100);
  const midpoint=await capture(0),midpointRequest=captureIndex;
  await expect.poll(()=>log.slice(at),{timeout:8000}).toContain('mode=auto color=light');
  const dark=await capture();
  // A brief bright flash must not invert the entire panel.
  at=log.length;await changeBackground('#fafafa');await pause(200);await changeBackground('#080c10');await pause(1200);
  assert.ok(!log.slice(at).includes('mode=auto color=dark'),'Brief flash caused an unwanted color switch');
  // Manual override remains dark even though automatic ink was light.
  at=log.length;const darkTransition=waitTransition(0);await changeSettings({textColor:'dark'});
  await darkTransition;await pause(100);
  const reverseMidpoint=await capture(0),reverseRequest=captureIndex;
  await expect.poll(()=>log.slice(at)).toContain('[auto-text] mode=dark');
  const manual=await capture();
  const countInk=(file,rgb)=>{const pixels=fs.readFileSync(file);let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>250&&rgb.every((v,k)=>Math.abs(pixels[i+k]-v)<=8))++count;return count;};
  assert.ok(countInk(bright,[27,49,52])>100,'Missing dark glyphs on bright glass');
  assert.ok(countInk(dark,[247,251,250])>100,'Missing light glyphs on dark glass');
  assert.ok(countInk(manual,[27,49,52])>100,'Manual dark override did not reach actual glyphs');
  const verifyIntermediate=(file,request)=>{
   const mix=Number(log.match(new RegExp(`\\[capture\\] request=${request} textMix=([\\d.]+)`))[1]);
   assert.ok(mix>.05&&mix<.95,`Expected an intermediate color, got ${mix}`);
   const rgb=[27,49,52].map((v,k)=>Math.round(v+([247,251,250][k]-v)*mix));
   assert.ok(countInk(file,rgb)>100,'Intermediate color did not reach actual glyphs');return mix;
  };
  const transitionMix=verifyIntermediate(midpoint,midpointRequest),reverseMix=verifyIntermediate(reverseMidpoint,reverseRequest);
  // Reverse while a fade is still in progress: its start must be the visible
  // intermediate color, rather than either palette endpoint.
  const interrupted=waitTransition(1);await changeSettings({textColor:'light'});await interrupted;await pause(75);
  at=log.length;await changeSettings({textColor:'dark'});
  await expect.poll(()=>log.slice(at)).toMatch(/start from=0\.\d+ to=0\.000/);
  const interruptedFrom=Number(log.slice(at).match(/start from=([\d.]+) to=0\.000/)[1]);
  assert.ok(interruptedFrom>.05&&interruptedFrom<.95,'Interrupted transition jumped to a palette endpoint');
  await pause(300);
  // Re-enable auto on a dark desktop, then change the glass itself to pale/opaque.
  at=log.length;await changeSettings({textColor:'auto'});
  await expect.poll(()=>log.slice(at)).toContain('mode=auto color=light');
  at=log.length;await changeSettings({opacity:90,tint:'pearl'});
  await expect.poll(()=>log.slice(at),{timeout:8000}).toContain('mode=auto color=dark');
  await capture();
  // Sustained bright/dark changes still work after opacity updates.
  at=log.length;await changeSettings({opacity:0});
  await expect.poll(()=>log.slice(at),{timeout:8000}).toContain('mode=auto color=light');
  at=log.length;await changeBackground('#fafafa');
  await expect.poll(()=>log.slice(at),{timeout:8000}).toContain('mode=auto color=dark');
  await settings.reload();await app.evaluate(()=>global.__starglassTest.showSettings());
  await expect(settings.getByRole('combobox',{name:'面板文字颜色',exact:true})).toHaveValue('auto');
  console.log(JSON.stringify({passed:true,gpuSampling:true,brightDark:true,debounce:true,manualOverride:true,glassOpacity:true,persistence:true,smoothTransition:true,transitionMix,reverseMix,interruptedFrom,out}));
 }finally{fs.writeFileSync(path.join(out,'run.log'),log);await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
