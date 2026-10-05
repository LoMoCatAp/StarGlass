'use strict';
// Force-end only this isolated test's children. Never enumerate or stop the
// user's normal application. Tests both native closure and the explicit legacy
// development override; also verifies the actual tray Exit handler.
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','panel-exit');
fs.mkdirSync(out,{recursive:true});
const packaged=process.env.STARGLASS_LIFECYCLE_PACKAGED==='1';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function launch(mode){
 const data=path.join(root,'.test-data',`panel-exit-${mode}-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
 const {DEFAULTS}=require('../electron/core.cjs');
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{...DEFAULTS,mini:true,multiMini:true,repos:['one/First','two/Second','three/Third']},projects:{},history:{},errors:{},token:''}));
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_TEST_HOOKS:'1',STARGLASS_NATIVE_PANEL:mode==='legacy'?'0':'1'};
 delete env.ELECTRON_RUN_AS_NODE;delete env.STARGLASS_PANEL_EXE;
 if(mode==='missing')env.STARGLASS_PANEL_EXE=path.join(data,'intentionally-absent.exe');
 const app=await electron.launch(packaged?{executablePath:path.join(root,'release/win-unpacked/StarGlass.exe'),args:[],env}:{args:[root],env});
 let log='';app.process().stdout.on('data',s=>log+=s);app.process().stderr.on('data',s=>log+=s);
 await app.firstWindow();
 await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://api.github.com/*']},(_,done)=>done({cancel:true})));
 return {app,saveLog:()=>fs.writeFileSync(path.join(out,`${mode}${packaged?'-packaged':''}.log`),log)};
}
const legacyVisible=app=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='StarGlass')?.isVisible()??false);
const current=app=>app.evaluate(()=>({native:global.__starglassTest.snapshot().nativePanel,bridge:global.__starglassTest.panelBridge(),capsules:global.__starglassTest.capsules()}));
const change=app=>app.evaluate(()=>{const t=global.__starglassTest;t.updateSettings({...t.snapshot().settings,opacity:67});});
const connected=app=>expect.poll(async()=>Boolean((await current(app)).bridge?.connected),{timeout:20000}).toBe(true);
async function trayExit(app){
 const closed=app.waitForEvent('close',{timeout:15000});
 // Main-process evaluation may lose its target during the intentional quit.
 await app.evaluate(()=>global.__starglassTest.trayAction('quit')).catch(e=>{if(!/closed|destroyed|Execution context/i.test(e.message))throw e;});
 await closed;
}
(async()=>{
 const first=await launch('native'),app=first.app;let exited=false;
 try{
  await connected(app);await expect.poll(async()=> (await current(app)).capsules.filter(c=>c.connected).length,{timeout:20000}).toBe(2);
  const before=await current(app);const victim=before.capsules[0];process.kill(victim.pid,'SIGTERM');
  await expect.poll(async()=> (await current(app)).capsules.length).toBe(1);
  await change(app);await pause(400);assert.equal((await current(app)).capsules.length,1,'Settings resurrected the terminated extra capsule');
  await app.evaluate(()=>global.__starglassTest.showPanel());
  await expect.poll(async()=> (await current(app)).capsules.filter(c=>c.connected).length,{timeout:20000}).toBe(2);
  const oldPid=(await current(app)).bridge.pid;process.kill(oldPid,'SIGTERM');
  await expect.poll(async()=> (await current(app)).native).toBe(false);
  assert.equal((await current(app)).bridge,null);assert.equal((await current(app)).capsules.length,0);
  assert.equal(await legacyVisible(app),false,'Force-ending native opened the legacy panel');
  await change(app);await pause(400);assert.equal((await current(app)).bridge,null);assert.equal(await legacyVisible(app),false);
  // The same menu action as a user selecting Show Panel restarts native glass.
  await app.evaluate(()=>global.__starglassTest.trayAction('panel-visibility'));await connected(app);
  assert.notEqual((await current(app)).bridge.pid,oldPid);assert.equal(await legacyVisible(app),false);
  await app.evaluate(()=>global.__starglassTest.trayAction('panel-visibility'));await pause(250);
  assert.equal(await legacyVisible(app),false);assert.equal((await current(app)).native,true);
  await trayExit(app);exited=true;
 }finally{first.saveLog();if(!exited)await app.close();}
 const missing=await launch('missing');exited=false;
 try{
  assert.equal((await current(missing.app)).native,false);assert.equal(await legacyVisible(missing.app),false);
  await missing.app.evaluate(()=>global.__starglassTest.trayAction('panel-visibility'));await change(missing.app);await pause(250);
  assert.equal(await legacyVisible(missing.app),false);assert.equal((await current(missing.app)).bridge,null);
  await trayExit(missing.app);exited=true;
 }finally{missing.saveLog();if(!exited)await missing.app.close();}
 const legacy=await launch('legacy');exited=false;
 try{
  await expect.poll(()=>legacyVisible(legacy.app)).toBe(true);
  await legacy.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='StarGlass').close());
  await expect.poll(()=>legacyVisible(legacy.app)).toBe(false);
  await change(legacy.app);await pause(300);assert.equal(await legacyVisible(legacy.app),false);
  await trayExit(legacy.app);exited=true;
 }finally{legacy.saveLog();if(!exited)await legacy.app.close();}
 console.log(JSON.stringify({passed:true,packaged,noAutomaticFallback:true,noCapsuleResurrection:true,explicitNativeRestart:true,trayExit:true,legacyClose:true,missingBinaryStaysClosed:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
