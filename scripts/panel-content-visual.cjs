// Controlled-background visual cases for native layouts at their size limits.
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {DEFAULTS}=require('../electron/core.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..');
 for(const scenario of ['compact-large','empty']) {
  const dir=path.join(root,'.test-data',`visual-${scenario}-${Date.now()}`),out=path.join(root,'test-results','content-theme',scenario);
  fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(out,{recursive:true});
  const repo='Example/An-extremely-long-repository-name-for-layout-validation';
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({settings:{...DEFAULTS,compact:true,fontSize:18,alwaysOnTop:true,repos:scenario==='empty'?[]:[repo]},projects:{[repo]:{stars:1234567890,downloads:9876543210,forks:111,version:'v123-preview',updatedAt:new Date().toISOString()}},history:{},errors:{},token:''}));
  const env={...process.env,STARGLASS_DATA_DIR:dir,SG_DUMP_FRAME:path.join(out,'panel.raw'),SG_DUMP_AT:'120'};delete env.ELECTRON_RUN_AS_NODE;
  fs.rmSync(path.join(out,'panel.raw.txt'),{force:true});
  const app=await electron.launch({args:[root],env});
  try {
   await app.firstWindow();
   await app.evaluate(async({BrowserWindow,screen,session})=>{
    session.defaultSession.webRequest.onBeforeRequest({urls:['https://api.github.com/*']},(_,done)=>done({cancel:true}));
    const w=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,show:false,skipTaskbar:true});
    await w.loadURL('data:text/html,<body style="margin:0;background:linear-gradient(30deg,%232c5161,%239bbab0);height:100vh"></body>');w.show();global.__visualBackdrop=w;
   });
   await expect.poll(()=>fs.existsSync(path.join(out,'panel.raw.txt')),{timeout:20000}).toBe(true);
   console.log(`${scenario}: ${fs.readFileSync(path.join(out,'panel.raw.txt'),'utf8').trim()}`);
  } finally {await app.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
