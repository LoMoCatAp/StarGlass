'use strict';
// Exercise the real mouse drag path on our isolated panel, identified by PID.
const { _electron: electron, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const probe = String.raw`
param([int]$PanelProcessId,[switch]$Mini)
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Threading;
public static class DragProbe {
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
 [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr z, int x, int y, int w, int ht, uint flags);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] static extern void mouse_event(uint f,uint x,uint y,uint data,UIntPtr extra);
 public static string Run(int processId,bool mini) {
  SetProcessDPIAware(); IntPtr target=IntPtr.Zero;
  EnumWindows((h,l)=>{int pid;GetWindowThreadProcessId(h,out pid);var s=new StringBuilder(64);GetClassNameW(h,s,64);
   if(pid==processId && s.ToString()=="StarGlassPanel") target=h;return true;},IntPtr.Zero);
  if(target==IntPtr.Zero) throw new Exception("Isolated panel not found");
  SetWindowPos(target,new IntPtr(-1),0,0,0,0,3); SetForegroundWindow(target);Thread.Sleep(250);
  RECT before,after;POINT original;GetWindowRect(target,out before);GetCursorPos(out original);
  var timer=new System.Diagnostics.Stopwatch();int startX=mini?before.Right-42:before.Left+90,startY=mini?(before.Top+before.Bottom)/2:before.Top+35;
  try {
   SetCursorPos(startX,startY);Thread.Sleep(100);timer.Start();mouse_event(2,0,0,0,UIntPtr.Zero);
   for(int i=1;i<=40;i++){SetCursorPos(startX-i*5,startY+i*2);Thread.Sleep(50);}
  } finally {mouse_event(4,0,0,0,UIntPtr.Zero);timer.Stop();Thread.Sleep(200);SetCursorPos(original.X,original.Y);}
  GetWindowRect(target,out after);
  return "{\"dx\":"+(after.Left-before.Left)+",\"dy\":"+(after.Top-before.Top)+",\"durationMs\":"+timer.ElapsedMilliseconds+"}";
 }
}
"@
[DragProbe]::Run($PanelProcessId,$Mini.IsPresent)
`;
(async () => {
 const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','drag');fs.mkdirSync(out,{recursive:true});
 const data=path.join(root,'.test-data',`drag-${Date.now()}`);fs.mkdirSync(data,{recursive:true});
 const {DEFAULTS}=require('../electron/core.cjs'),mini=process.env.STARGLASS_TEST_MINI==='1';
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{...DEFAULTS,repos:[],mini,glassFps:15,alwaysOnTop:true,textColor:'auto'},projects:{},history:{},errors:{},token:''}));
 const ps=path.join(out,'probe.ps1');fs.writeFileSync(ps,probe);
 const env={...process.env,STARGLASS_DATA_DIR:data,STARGLASS_TEST_HOOKS:'1',SG_TRACE_STATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[root],env});let log='';app.process().stdout.on('data',s=>log+=s);app.process().stderr.on('data',s=>log+=s);
 try {
  await app.firstWindow();
  await expect.poll(()=>app.evaluate(()=>global.__starglassTest.panelBridge()?.connected),{timeout:20000}).toBe(true);
  await expect.poll(()=>log).toContain('frameLimit=15');
  await expect.poll(()=>log).toContain('GPU sampler ready');
  const pid=await app.evaluate(()=>global.__starglassTest.panelBridge().pid);
  const movement=JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',ps,'-PanelProcessId',String(pid),...(mini?['-Mini']:[])],{encoding:'utf8',windowsHide:true}));
  await expect.poll(()=>log).toContain('[drag] end frames=');
  const frames=Number(log.match(/\[drag\] end frames=(\d+)/)[1]);
  assert.ok(Math.abs(movement.dx+200)<=2 && Math.abs(movement.dy-80)<=2,JSON.stringify(movement));
  assert.ok(frames>=80,`Only ${frames} frames rendered during 2s drag (idle cap is 15)`);
  await expect.poll(()=>JSON.parse(fs.readFileSync(path.join(data,'state.json'),'utf8')).position).not.toBeUndefined();
  console.log(JSON.stringify({passed:true,...movement,frames,idleFrameLimit:15,autoText:true,mini}));
 } finally {fs.writeFileSync(path.join(out,'run.log'),log);await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
