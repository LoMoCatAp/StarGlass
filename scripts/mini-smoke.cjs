'use strict';
// Pending GUI check. Run only after rebuilding BOTH the UI and native panel.
// Uses its own data directory, worker PIDs and a controlled white background.
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const probe=String.raw`
param([int]$PanelProcessId,[string]$OutputFile)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public static class MiniProbe {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb,IntPtr l);
 [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h,out int pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 public static RECT Find(int processId) {
  SetProcessDPIAware();IntPtr target=IntPtr.Zero;
  EnumWindows((h,l)=>{int pid;GetWindowThreadProcessId(h,out pid);var name=new StringBuilder(64);GetClassNameW(h,name,64);
   if(pid==processId&&name.ToString()=="StarGlassPanel")target=h;return true;},IntPtr.Zero);
  if(target==IntPtr.Zero)throw new Exception("Isolated capsule not found");
  RECT r;GetWindowRect(target,out r);return r;
 }
}
"@
$rect=[MiniProbe]::Find($PanelProcessId)
$width=$rect.Right-$rect.Left
$height=$rect.Bottom-$rect.Top
$dark=0
if($OutputFile) {
 $bitmap=New-Object System.Drawing.Bitmap($width,$height)
 $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
 try {
  $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)
  $bitmap.Save($OutputFile,[System.Drawing.Imaging.ImageFormat]::Png)
  for($y=0;$y -lt $height;$y++){for($x=0;$x -lt $width;$x++){
   $color=$bitmap.GetPixel($x,$y)
   if($color.R -lt 150 -and $color.G -lt 150 -and $color.B -lt 150){$dark++}
  }}
 } finally {$graphics.Dispose();$bitmap.Dispose()}
}
@{w=$width;h=$height;dark=$dark}|ConvertTo-Json -Compress
`;
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','mini');fs.mkdirSync(out,{recursive:true});
 const data=path.join(root,'.test-data',`mini-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
 const {DEFAULTS}=require('../electron/core.cjs'),repos=['one/Small','two/Second','three/Third','four/Fourth'];
 const projects=Object.fromEntries(repos.map(repo=>[repo,{stars:2345,downloads:12860,updatedAt:new Date().toISOString()}]));
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{...DEFAULTS,repos,mini:true,alwaysOnTop:true,opacity:0,blur:0,refraction:0,dispersion:0,gloss:0},projects,history:{},errors:{},token:''}));
 const ps=path.join(out,'probe.ps1');fs.writeFileSync(ps,probe);
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_TEST_HOOKS:'1',SG_TRACE_STATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[root],env});let log='';app.process().stdout.on('data',s=>log+=s);
 try{
  const page=await app.firstWindow();
  await app.evaluate(async({BrowserWindow,screen,session})=>{
   session.defaultSession.webRequest.onBeforeRequest({urls:['https://api.github.com/*']},(_,done)=>done({cancel:true}));
   const w=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,skipTaskbar:true,show:false});
   await w.loadURL('data:text/html,<body style="margin:0;background:white;height:100vh"></body>');w.show();global.__miniBackdrop=w;
  });
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.panelBridge()?.connected),{timeout:20000}).toBe(true);
  const change=p=>app.evaluate((_,patch)=>global.__starglassTest.updateSettings({...global.__starglassTest.snapshot().settings,...patch}),p);
  const pid=await app.evaluate(()=>global.__starglassTest.panelBridge().pid);
  const dpi=await app.evaluate(({screen})=>screen.getPrimaryDisplay().scaleFactor);
  const geometry=(capture=false)=>JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',ps,'-PanelProcessId',String(pid),...(capture?['-OutputFile',path.join(out,'recordable.png')]:[])],{encoding:'utf8',windowsHide:true}));
  for(const [fontSize,w,h]of [[12,300,40],[14,320,44],[18,360,52]]){
   await change({fontSize});await expect.poll(()=>geometry()).toMatchObject({w:Math.round(w*dpi),h:Math.round(h*dpi)});
  }
  await expect(page.locator('.mini-content')).toBeVisible();await expect(page.locator('.panel-header')).toHaveCount(0);
  assert.equal(await page.locator('[title]').count(),0);
  await change({fontSize:14,multiMini:true});
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.capsules().filter(c=>c.connected).length),{timeout:20000}).toBe(repos.length-1);
  await change({customSize:true,panelWidth:480,panelHeight:80,panelShape:'pill'});
  await expect.poll(()=>geometry()).toMatchObject({w:Math.round(480*dpi),h:Math.round(80*dpi)});
  await change({customSize:false,multiMini:false});
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.capsules().length)).toBe(0);
  await change({allowScreenCapture:true});
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.snapshot().captureStatus),{timeout:15000}).toBe('live');
  // Unlike an internal buffer dump, this observes real system capture visibility.
  await expect.poll(()=>geometry(true).dark,{timeout:8000}).toBeGreaterThan(20);
  await change({allowScreenCapture:false});
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.snapshot().captureStatus)).toBe('live');
  await change({mini:false,compact:true});
  await expect.poll(()=>geometry()).toMatchObject({w:Math.round(440*dpi),h:Math.round(358*dpi)});
  console.log(JSON.stringify({passed:true,miniPresets:true,fourCapsules:true,customSize:true,externalScreenshot:true,out}));
 }finally{fs.writeFileSync(path.join(out,'run.log'),log);await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
