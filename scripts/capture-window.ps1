param(
  [Parameter(Mandatory = $true)][string]$ProcessName,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Index = 0,
  [switch]$NoFocus,
  [switch]$ForceTop
)
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI,
# so non-ASCII text here would be mis-decoded and break the parser.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinCap {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$SWP = 0x0001 -bor 0x0002 -bor 0x0040   # NOSIZE | NOMOVE | SHOWWINDOW

$procs = @(Get-Process -Name $ProcessName -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 })
if ($procs.Count -eq 0) { throw "no visible window for process '$ProcessName'" }
$p = $procs[$Index]
$h = $p.MainWindowHandle

if (-not $NoFocus) {
  if ([WinCap]::IsIconic($h)) { [void][WinCap]::ShowWindow($h, 9) }
  if ($ForceTop) { [void][WinCap]::SetWindowPos($h, $HWND_TOPMOST, 0, 0, 0, 0, $SWP) }
  [void][WinCap]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 900
}

try {
  $r = New-Object WinCap+RECT
  if (-not [WinCap]::GetWindowRect($h, [ref]$r)) { throw 'GetWindowRect failed' }
  $w = $r.Right - $r.Left
  $ht = $r.Bottom - $r.Top
  if ($w -le 0 -or $ht -le 0) { throw "invalid window size: ${w}x${ht}" }

  $fg = [WinCap]::GetForegroundWindow()
  $bmp = New-Object System.Drawing.Bitmap($w, $ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)

  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()

  $fgNote = if ($fg -eq $h) { 'demo-is-foreground' } else { "WARNING: foreground is hwnd=$fg, capture may show an occluding window" }
  "captured ${w}x${ht} at ($($r.Left),$($r.Top)) -> $Out  [$fgNote]"
}
finally {
  if ($ForceTop -and -not $NoFocus) { [void][WinCap]::SetWindowPos($h, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) }
}
