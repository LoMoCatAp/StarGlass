const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');const data=path.join(root,'.test-data',`package-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{repos:[],material:'pure'},projects:{},history:{},errors:{},token:''}));
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_TEST_HOOKS:'1',SG_TRACE_STATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:path.join(root,'release/win-unpacked/StarGlass.exe'),args:[],env});
 let log='';app.process().stdout.on('data',s=>log+=s);
 try{
  const page=await app.firstWindow();await page.getByRole('heading',{name:'你热爱的项目，触手可及'}).waitFor();
  await expect.poll(async()=>{const b=await app.evaluate(()=>global.__starglassTest.panelBridge());return b?b.connected:false;},{timeout:20000}).toBe(true);
   assert.ok(fs.existsSync(path.join(root,'release/win-unpacked/resources/glasspanel.exe')));
  const state=await page.evaluate(()=>window.starglass.getState());assert.equal(state.settings.material,'liquid');assert.equal(state.settings.glassFps,0);
  const metadata=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged}));assert.equal(metadata.packaged,true);assert.equal(metadata.version,require('../package.json').version);
  const dpi=await app.evaluate(({screen})=>screen.getPrimaryDisplay().scaleFactor);
  for (const size of [18,12]) {
   await app.evaluate((_,fontSize)=>global.__starglassTest.updateSettings({...global.__starglassTest.snapshot().settings,fontSize}),size);
   await expect.poll(()=>log).toContain(`[draw-font] physical=${(size*dpi).toFixed(1)}`);
  }
  await app.evaluate(()=>global.__starglassTest.updateSettings({...global.__starglassTest.snapshot().settings,textColor:'auto'}));
  await expect.poll(()=>log,{timeout:12000}).toContain('GPU sampler ready');
  await expect.poll(()=>log,{timeout:12000}).toMatch(/mode=auto color=(dark|light) luminance=/);
  const windowPromise=app.waitForEvent('window');await page.getByRole('button',{name:'设置',exact:true}).click();const settings=await windowPromise;await settings.getByRole('heading',{name:'一点玻璃，一点个性。'}).waitFor();
  assert.ok(fs.existsSync(path.join(root,'release/win-unpacked/resources/GlassCapture.exe')));
  await app.evaluate(({shell})=>{global.__authorLinks=[];shell.openExternal=async url=>{global.__authorLinks.push(url);};});
  const author=settings.getByRole('link',{name:'作者 LomoCat',exact:true});
  await expect(author).toHaveAttribute('href','https://github.com/LoMoCatAp/StarGlass');
  await author.click();
  await expect.poll(()=>app.evaluate(()=>global.__authorLinks.at(-1))).toBe('https://github.com/LoMoCatAp/StarGlass');
  assert.equal(await settings.getByText('本机实时玻璃 · 隐私数据留在设备',{exact:true}).count(),0);
  assert.equal(await settings.getByText('让每一份热爱，被看见。',{exact:true}).count(),0);
  const licenses=await app.evaluate(({app})=>{const fs=process.getBuiltinModule('fs'),path=process.getBuiltinModule('path'),root=app.getAppPath();return ['LICENSE','THIRD_PARTY_NOTICES.md','licenses/FreeType-FTL.txt','licenses/Lucide-ISC.txt','licenses/React-MIT.txt'].every(file=>fs.existsSync(path.join(root,file)));});
  assert.equal(licenses,true);
  console.log(JSON.stringify({passed:true,...metadata,nativePanelBinary:true,panelBridge:true,settingsWindow:true,liveFontSize:true,autoTextGPU:true}));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
