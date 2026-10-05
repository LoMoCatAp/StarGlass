param([int]$PanelProcessId,[string]$OutputFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CaptureProbe {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h,out uint a);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int hgt,uint f);
 public static IntPtr Find(uint pid){SetProcessDPIAware();IntPtr result=IntPtr.Zero;EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);var name=new StringBuilder(80);GetClassName(h,name,80);if(owner==pid&&name.ToString()=="StarGlassPanel")result=h;return true;},IntPtr.Zero);return result;}
}
'@
$window=[CaptureProbe]::Find([uint32]$PanelProcessId)
if($window -eq [IntPtr]::Zero){throw 'Owned test panel missing'}
[void][CaptureProbe]::SetWindowPos($window,[IntPtr](-1),0,0,0,0,0x13)
Start-Sleep -Milliseconds 160
$rect=New-Object CaptureProbe+Rect
[void][CaptureProbe]::GetWindowRect($window,[ref]$rect)
$affinity=[uint32]0
$affinityRead=[CaptureProbe]::GetWindowDisplayAffinity($window,[ref]$affinity)
$width=$rect.Right-$rect.Left;$height=$rect.Bottom-$rect.Top
$bitmap=New-Object System.Drawing.Bitmap($width,$height)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
try{
 $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)
 $bitmap.Save($OutputFile,[System.Drawing.Imaging.ImageFormat]::Png)
 $ink=0;$sum=0;$count=0
 for($y=[int]($height*.18);$y -lt [int]($height*.82);$y++){
  for($x=[int]($width*.1);$x -lt [int]($width*.9);$x++){
   $color=$bitmap.GetPixel($x,$y)
   if($color.R -lt 100 -and $color.G -lt 100 -and $color.B -lt 100){$ink++}
  }
 }
 # A strip above the text, away from the shape boundary.
 for($y=[int]($height*.20);$y -lt [int]($height*.27);$y++){
  for($x=[int]($width*.46);$x -lt [int]($width*.54);$x++){
   $color=$bitmap.GetPixel($x,$y);$sum+=($color.R+$color.G+$color.B)/3;$count++
  }
 }
 @{w=$width;h=$height;affinityRead=$affinityRead;affinity=$affinity;ink=$ink;brightness=$sum/[Math]::Max(1,$count)}|ConvertTo-Json -Compress
}finally{$graphics.Dispose();$bitmap.Dispose()}
