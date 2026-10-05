const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/direct-capture',String(Date.now()));fs.mkdirSync(out,{recursive:true});
 const data=path.join(root,'.test-data',`capture-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
 const {DEFAULTS}=require('../electron/core.cjs'),repo='demo/Capture';
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{...DEFAULTS,repos:[repo],mini:true,alwaysOnTop:true,fontSize:18,textColor:'dark',opacity:0,blur:0,gloss:0,refraction:0,dispersion:0,allowScreenCapture:false},position:{x:120,y:140},projects:{[repo]:{stars:2345,downloads:12860,updatedAt:new Date().toISOString()}},history:{},errors:{},token:''}));
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_TEST_HOOKS:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.STARGLASS_CAPTURE_PACKAGED==='1';
 const app=await electron.launch(packaged?{executablePath:path.join(root,'release/win-unpacked/StarGlass.exe'),args:[],env}:{args:[root],env});let log='';app.process().stdout.on('data',s=>log+=s);app.process().stderr.on('data',s=>log+=s);
 try{
  await app.firstWindow();
  await app.evaluate(async({BrowserWindow,screen,session})=>{
   session.defaultSession.webRequest.onBeforeRequest({urls:['https://api.github.com/*']},(_,done)=>done({cancel:true}));
   const window=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,alwaysOnTop:true,focusable:false,show:false,skipTaskbar:true});
   await window.loadURL('data:text/html,<body style="margin:0;height:100vh;background:%23fafafa"></body>');window.showInactive();global.__captureBackdrop=window;
  });
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.panelBridge()?.connected),{timeout:25000}).toBe(true);
  await expect.poll(()=>log).toContain('[live-desktop] independent GPU window capture ready');
  const pid=await app.evaluate(()=>global.__starglassTest.panelBridge().pid),results=[];
  const probe=name=>JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/direct-capture-probe.ps1'),'-PanelProcessId',String(pid),'-OutputFile',path.join(out,name+'.png')],{encoding:'utf8',windowsHide:true}));
  const check=async(name,dark=false)=>{let result;await expect.poll(()=>{result=probe(name);return result.affinityRead&&result.affinity===0&&(dark?result.brightness<80:result.brightness>170&&result.ink>70);},{timeout:20000}).toBe(true);results.push({name,...result});};
  const change=patch=>app.evaluate((_,p)=>{const t=global.__starglassTest;t.updateSettings({...t.snapshot().settings,...p});},patch);
  await check('mini-bright');
  await app.evaluate(({screen})=>{const b=screen.getPrimaryDisplay().bounds;global.__captureBackdrop.setBounds({...b,width:Math.max(800,b.width-300),height:Math.max(500,b.height-200)});});
  await app.evaluate(()=>global.__captureBackdrop.webContents.executeJavaScript('document.body.style.background="#080c10"'));
  await check('mini-dark',true);
  await app.evaluate(({screen})=>global.__captureBackdrop.setBounds(screen.getPrimaryDisplay().bounds));
  await app.evaluate(()=>global.__captureBackdrop.webContents.executeJavaScript('document.body.style.background="#fafafa"'));
  await check('mini-bright-again');
  await change({allowScreenCapture:true});await check('old-option-enabled');
  await change({allowScreenCapture:false});await check('old-option-disabled');
  await change({mini:false,compact:true,radius:60,fontSize:14});
  // In the full panel the upper test strip contains the title, so check real
  // text visibility and capture affinity without applying the mini luminance rule.
  let regular;await expect.poll(()=>{regular=probe('rounded-content');return regular.affinityRead&&regular.affinity===0&&regular.ink>100;}).toBe(true);results.push({name:'rounded-content',...regular});
  assert.equal(await app.evaluate(()=>global.__starglassTest.snapshot().settings.allowScreenCapture),true);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({passed:true,packaged,externalScreenshots:true,liveBackground:true,backgroundWindowResize:true,oldConfigMigration:true,contentVisible:true,out}));
 }finally{fs.writeFileSync(path.join(out,'run.log'),log);await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
