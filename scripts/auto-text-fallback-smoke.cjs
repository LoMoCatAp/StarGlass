const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=path.join(root,'.test-data',`fallback-auto-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
 const {DEFAULTS}=require('../electron/core.cjs');
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{...DEFAULTS,alwaysOnTop:true,textColor:'auto',opacity:0,blur:0},projects:{},history:{},errors:{},token:''}));
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_NATIVE_PANEL:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[root],env});
 try{
  const page=await app.firstWindow();await page.getByRole('heading',{name:'Bika-HarmonyOS'}).waitFor();
  await app.evaluate(async({BrowserWindow,screen,session})=>{
   session.defaultSession.webRequest.onBeforeRequest({urls:['https://api.github.com/*']},(_,done)=>done({cancel:true}));
   const w=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,show:false,skipTaskbar:true});
   await w.loadURL('data:text/html,<body style="margin:0;background:%23080c10;height:100vh"></body>');w.show();global.__fallbackBackdrop=w;
  });
  await expect(page.locator('.glass-panel'),{timeout:15000}).toHaveClass(/on-dark/);
  await expect.poll(()=>page.locator('.glass-panel').evaluate(el=>getComputedStyle(el).transitionDuration)).toContain('0.25s');
  await app.evaluate(()=>global.__fallbackBackdrop.webContents.executeJavaScript('document.body.style.background="#fafafa"'));
  await expect(page.locator('.glass-panel'),{timeout:15000}).not.toHaveClass(/on-dark/);
  await page.evaluate(async()=>{const s=await window.starglass.getState();await window.starglass.saveSettings({...s.settings,textColor:'light'});});
  await expect(page.locator('.glass-panel')).toHaveClass(/on-dark/);
  console.log(JSON.stringify({passed:true,fallbackAuto:true,manualOverride:true}));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
