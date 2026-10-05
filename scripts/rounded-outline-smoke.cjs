'use strict';
const {_electron:electron,expect}=require('@playwright/test');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const probe=String.raw`
param([int]$PanelProcessId,[string]$OutputFile)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public static class OutlineProbe {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb,IntPtr l);
 [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h,out int pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr h,IntPtr r);
 [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
 [DllImport("gdi32.dll")] public static extern bool PtInRegion(IntPtr r,int x,int y);
 [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr r);
 [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h,int a,out uint v,int size);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr z,int x,int y,int w,int ht,uint flags);
 public static IntPtr Find(int processId){
  SetProcessDPIAware();IntPtr target=IntPtr.Zero;
  EnumWindows((h,l)=>{int pid;GetWindowThreadProcessId(h,out pid);var s=new StringBuilder(64);GetClassNameW(h,s,64);
   if(pid==processId&&s.ToString()=="StarGlassPanel")target=h;return true;},IntPtr.Zero);
  if(target==IntPtr.Zero)throw new Exception("Test window missing");
  SetWindowPos(target,new IntPtr(-1),0,0,0,0,0x13);return target;
 }
}
"@
$target=[OutlineProbe]::Find($PanelProcessId)
$rect=New-Object OutlineProbe+RECT
[void][OutlineProbe]::GetWindowRect($target,[ref]$rect)
$width=$rect.Right-$rect.Left
$height=$rect.Bottom-$rect.Top
$region=[OutlineProbe]::CreateRectRgn(0,0,0,0)
try {
 $kind=[OutlineProbe]::GetWindowRgn($target,$region)
 $left=[OutlineProbe]::PtInRegion($region,1,$height-2)
 $right=[OutlineProbe]::PtInRegion($region,$width-2,$height-2)
 $center=[OutlineProbe]::PtInRegion($region,$width/2,$height/2)
 [uint32]$border=0
 $borderResult=[OutlineProbe]::DwmGetWindowAttribute($target,34,[ref]$border,4)
 $bitmap=New-Object System.Drawing.Bitmap($width,$height)
 $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
 try {
  $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)
  $bitmap.Save($OutputFile,[System.Drawing.Imaging.ImageFormat]::Png)
  $outside=@()
  foreach($x in @(1,3,5,($width-2),($width-4),($width-6))){
   $c=$bitmap.GetPixel($x,$height-2)
   $outside+=,@($c.R,$c.G,$c.B)
  }
 }finally{$graphics.Dispose();$bitmap.Dispose()}
 @{w=$width;h=$height;region=$kind;bottomLeft=$left;bottomRight=$right;center=$center;border=$border;borderResult=$borderResult;outside=$outside}|ConvertTo-Json -Compress -Depth 4
}finally{[void][OutlineProbe]::DeleteObject($region)}
`;
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','rounded-outline',String(Date.now()));fs.mkdirSync(out,{recursive:true});
 const data=path.join(root,'.test-data',`outline-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
 const {DEFAULTS}=require('../electron/core.cjs');
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{...DEFAULTS,repos:['demo/Outline'],alwaysOnTop:true,glassOnly:false,fontSize:14},position:{x:80,y:100},projects:{'demo/Outline':{stars:2048,downloads:12860,updatedAt:new Date().toISOString()}},history:{},errors:{},token:''}));
 const ps=path.join(out,'probe.ps1');fs.writeFileSync(ps,probe);
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_TEST_HOOKS:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.STARGLASS_OUTLINE_PACKAGED==='1';
 const app=await electron.launch(packaged?{executablePath:path.join(root,'release/win-unpacked/StarGlass.exe'),args:[],env}:{args:[root],env});
 try{
  await app.firstWindow();
  await app.evaluate(async({BrowserWindow,screen,session})=>{
   session.defaultSession.webRequest.onBeforeRequest({urls:['https://api.github.com/*']},(_,done)=>done({cancel:true}));
   const w=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,skipTaskbar:true,show:false,alwaysOnTop:true,focusable:false});
   await w.loadURL('data:text/html,<body style="margin:0;background:%23fafafa;height:100vh"></body>');w.showInactive();global.__outlineBackdrop=w;
  });
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.panelBridge()?.connected),{timeout:20000}).toBe(true);
  const pid=await app.evaluate(()=>global.__starglassTest.panelBridge().pid);
  const cases=[
   {name:'rounded',mini:false,panelShape:'rounded',radius:60,resizeEnabled:false,customSize:false,glassOnly:false},
   {name:'rounded-resizable',mini:false,panelShape:'rounded',radius:60,resizeEnabled:true,customSize:false,glassOnly:false},
   {name:'mini',mini:true,panelShape:'auto',resizeEnabled:true,customSize:false,glassOnly:false},
   {name:'mini-glass-only',mini:true,panelShape:'auto',resizeEnabled:false,customSize:false,glassOnly:true},
   {name:'pill',mini:true,panelShape:'pill',resizeEnabled:true,customSize:true,panelWidth:420,panelHeight:80,glassOnly:true},
   {name:'circle',mini:true,panelShape:'pill',resizeEnabled:true,customSize:true,panelWidth:260,panelHeight:260,glassOnly:true},
   {name:'rectangle',mini:true,panelShape:'rectangle',resizeEnabled:true,customSize:true,panelWidth:320,panelHeight:100,glassOnly:true}
  ];
  const results=[];
  for(const scenario of cases){
   const {name,...patch}=scenario;
   await app.evaluate((_,p)=>{const t=global.__starglassTest;t.updateSettings({...t.snapshot().settings,...p,allowScreenCapture:false});},patch);
   await expect.poll(()=>app.evaluate(()=>global.__starglassTest.snapshot().captureStatus)).toBe('live');
   const capture=suffix=>JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',ps,'-PanelProcessId',String(pid),'-OutputFile',path.join(out,name+suffix+'.png')],{encoding:'utf8',windowsHide:true}));
   await app.evaluate(()=>global.__starglassTest.sendNative('HOST hide'));
   await new Promise(resolve=>setTimeout(resolve,150));
   const baseline=capture('-hidden');
   await app.evaluate(()=>global.__starglassTest.sendNative('HOST show'));
   await new Promise(resolve=>setTimeout(resolve,150));
   await app.evaluate(()=>{const t=global.__starglassTest;t.updateSettings({...t.snapshot().settings,allowScreenCapture:true});});
   await expect.poll(()=>app.evaluate(()=>global.__starglassTest.snapshot().captureStatus),{timeout:15000}).toBe('live');
   let result;
   await expect.poll(()=>{result=capture('');return name==='rectangle'?result.region===0:result.region===3&&!result.bottomLeft&&!result.bottomRight&&result.center;},{timeout:8000}).toBe(true);
   if(result.borderResult===0)assert.equal(result.border,0xfffffffe);
   if(name!=='rectangle')assert.ok(result.outside.every((rgb,i)=>rgb.every((v,j)=>Math.abs(v-baseline.outside[i][j])<=3)),`${name} paints over the bottom corners: before=${JSON.stringify(baseline.outside)} after=${JSON.stringify(result.outside)}`);
   results.push({name,...result});
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({passed:true,packaged,actualRoundedWindow:true,bottomPixelsClean:true,resizingToggle:true,shapeSwitching:true,out}));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
