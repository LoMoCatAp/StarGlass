$ErrorActionPreference = 'Stop'
# ASCII-only so Windows PowerShell 5.1 can read this without a BOM.

$projectRoot = Split-Path $PSScriptRoot -Parent
$sourceDir = Join-Path $projectRoot 'native'
$buildDir = Join-Path $sourceDir 'build'
$cmakeCommand = Get-Command cmake.exe -ErrorAction SilentlyContinue
$cmake = if ($cmakeCommand) { $cmakeCommand.Source } else { 'C:\Program Files\CMake\bin\cmake.exe' }

if (-not (Test-Path -LiteralPath $cmake)) { throw 'Install CMake 3.20+ and add it to PATH.' }
& $cmake -S $sourceDir -B $buildDir -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { throw 'cmake configure failed' }

& $cmake --build $buildDir --config Release --target glasspanel --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'cmake build failed' }

$src = Join-Path $buildDir 'Release\glasspanel.exe'
$dst = Join-Path $projectRoot 'native\glass-panel\glasspanel.exe'
try { Copy-Item -LiteralPath $src -Destination $dst -Force }
catch { throw "Could not replace glasspanel.exe. Exit the running development app, then retry. $($_.Exception.Message)" }
Write-Host "glasspanel.exe -> $dst"
