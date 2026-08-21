# install-extension.ps1 — copy extension/beellama.ts into the omp extensions dir.
$ErrorActionPreference = "Stop"
$src = Join-Path $PSScriptRoot "..\extension\beellama.ts"
$dstDir = Join-Path $HOME ".omp\agent\extensions"
if (-not (Test-Path $src))
{ Write-Error "extension source not found: $src" 
}
New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
Copy-Item $src (Join-Path $dstDir "beellama.ts") -Force
Write-Host "installed: $(Join-Path $dstDir 'beellama.ts')"
