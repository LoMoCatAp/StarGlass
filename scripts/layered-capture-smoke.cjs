'use strict';
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync,spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/layered-capture',String(Date.now()));fs.mkdirSync(out,{recursive:true});
 const data=path.join(root,'.test-data',`layered-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
 const {DEFAULTS}=require('../electron/core.cjs'),repo='demo/Layered';
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{...DEFAULTS,repos:[repo],mini:true,glassOnly:true,alwaysOnTop:true,opacity:0,blur:0,gloss:0,refraction:0,dispersion:0},position:{x:120,y:140},projects:{[repo]:{stars:2345,downloads:12860}},history:{},errors:{},token:''}));
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_TEST_HOOKS:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.STARGLASS_CAPTURE_PACKAGED==='1';
 const app=await electron.launch(packaged?{executablePath:path.join(root,'release/win-unpacked/StarGlass.exe'),args:[],env}:{args:[root],env});let log='',fixture,fixtureLog='';
 app.process().stdout.on('data',s=>log+=s);app.process().stderr.on('data',s=>log+=s);
 try{
  await app.firstWindow();
  await app.evaluate(async({BrowserWindow,screen,session})=>{
   session.defaultSession.webRequest.onBeforeRequest({urls:['https://api.github.com/*']},(_,done)=>done({cancel:true}));
   const w=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,alwaysOnTop:true,focusable:false,show:false,skipTaskbar:true});
   await w.loadURL('data:text/html,<body style="margin:0;height:100vh;background:%23fafafa"></body>');w.showInactive();global.__layeredBackdrop=w;
  });
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.panelBridge()?.connected),{timeout:25000}).toBe(true);
  const pid=await app.evaluate(()=>global.__starglassTest.panelBridge().pid),results=[];
  fixture=spawn(path.join(root,'.test-data/native-fixtures/Release/layered-overlay.exe'),[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  fixture.stdout.on('data',s=>fixtureLog+=s);fixture.stderr.on('data',s=>fixtureLog+=s);
  await expect.poll(()=>fixtureLog).toContain('mode=0');
  const cases=[[0,'transparent',250],[1,'half-alpha',125],[2,'opaque',0],[3,'black-color-key',250],[4,'nonmatching-color-key',0],[5,'colored-content',310/3],[0,'transparent-again',250]];
  for(const [mode,name,expected] of cases){
   fixtureLog='';fixture.stdin.write(mode+'\n');await expect.poll(()=>fixtureLog).toContain('mode='+mode);
   let result;await expect.poll(()=>{
    result=JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/direct-capture-probe.ps1'),'-PanelProcessId',String(pid),'-OutputFile',path.join(out,name+'.png')],{encoding:'utf8',windowsHide:true}));
    return result.affinityRead&&result.affinity===0&&Math.abs(result.brightness-expected)<18;
   },{timeout:20000,message:name}).toBe(true);
   results.push({name,expected,...result});
  }
  assert.equal(results.length,cases.length);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({passed:true,packaged,alphaAndColorKey:true,externalScreenshots:true,out}));
 }finally{
  fixture?.stdin.end('quit\n');if(fixture&&fixture.exitCode===null)await new Promise(r=>{fixture.once('exit',r);setTimeout(()=>{fixture.kill();r();},3000).unref();});
  fs.writeFileSync(path.join(out,'run.log'),log);await app.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
