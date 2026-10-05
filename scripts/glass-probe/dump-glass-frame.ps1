param(
  [Parameter(Mandatory = $true)][string]$Config,
  [Parameter(Mandatory = $true)][string]$OutRaw,
  [int]$At = 900,
  [string]$ExeDir = 'C:\Files\Codes\Projects\Github\StarGlass\references\liquidDX11-source\build\Release'
)
# Dump one composed frame of the liquid-glass overlay.
#
# Two gotchas this script exists to handle:
#  1. The overlay sets WDA_EXCLUDEFROMCAPTURE, so screen capture can never see it;
#     the only way to observe it is the in-app back-buffer dump (GLASS_DUMP_FRAME).
#  2. An occluded window is skipped entirely by the render loop, so the overlay has
#     to be raised above the full-screen probe window or no frame is ever produced.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI.
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class GlassZ {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$HWND_TOP = [IntPtr]0
$SWP = 0x0001 -bor 0x0002 -bor 0x0040   # NOSIZE | NOMOVE | SHOWWINDOW

Get-Process liquidDX11 -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 900
Remove-Item $OutRaw, "$OutRaw.txt" -Force -ErrorAction SilentlyContinue

$env:GLASS_CONFIG     = $Config
$env:GLASS_DUMP_FRAME = $OutRaw
$env:GLASS_DUMP_AT    = "$At"

$exe = Join-Path $ExeDir 'liquidDX11.exe'
if (-not (Test-Path $exe)) { throw "missing $exe" }
$p = Start-Process -FilePath $exe -WorkingDirectory $ExeDir -PassThru

$h = [IntPtr]::Zero
for ($i = 0; $i -lt 80; $i++) {
  Start-Sleep -Milliseconds 250
  $p.Refresh()
  if ($p.HasExited) { throw "overlay exited early, code=$($p.ExitCode)" }
  if ($p.MainWindowHandle -ne 0) { $h = $p.MainWindowHandle; break }
}
if ($h -eq [IntPtr]::Zero) { throw 'overlay window never appeared' }

[void][GlassZ]::SetWindowPos($h, $HWND_TOP, 0, 0, 0, 0, $SWP)
[void][GlassZ]::SetForegroundWindow($h)

$ok = $false
for ($i = 0; $i -lt 200; $i++) {
  Start-Sleep -Milliseconds 250
  if (Test-Path $OutRaw) { $ok = $true; break }
  $p.Refresh()
  if ($p.HasExited) { break }
}
Get-Process liquidDX11 -ErrorAction SilentlyContinue | Stop-Process -Force
if (-not $ok) { throw "no frame dumped (never reached frame $At)" }

"dumped $OutRaw (" + (Get-Item $OutRaw).Length + " bytes) sidecar=" + (Get-Content "$OutRaw.txt" -Raw).Trim()
