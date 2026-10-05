$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '需要 Windows 自带的 .NET Framework 4.x C# 编译器' }
& $compiler /nologo /target:exe /platform:x64 /optimize+ /r:System.Drawing.dll "/out:$projectRoot\assets\GlassCapture.exe" "$projectRoot\native\GlassCapture.cs"
if ($LASTEXITCODE -ne 0) { throw '背景采样器构建失败' }
