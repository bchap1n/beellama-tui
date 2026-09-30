<#
.SYNOPSIS
    Revert the GPU serving profile: unlock the clock, restore the power limit.

.DESCRIPTION
    Removes the graphics clock lock, clears any applied V/F curve, and restores
    the default power limit. Use this before gaming or any workload that wants
    the full 370 W boost range.

    Run this through the scheduled task beellama-gpu-undervolt-revert, or from
    an elevated shell.

.PARAMETER PowerLimit
    Power limit in watts. Default 0 restores the card default reported by
    nvidia-smi (370 W on the RTX 3090). A positive value sets that limit.

.PARAMETER ToolPath
    Path to simple-nvidia-undervolt.exe. Used to restore the baseline V/F curve.
    Ignored when the tool is absent.

.PARAMETER BaselineFile
    JSON tuning file holding the card's baseline curve. Defaults to
    scripts/gpu-baseline-tuning.json. When missing, the curve is cleared to
    stock instead, which measured 3 percent slower on prefill.

.EXAMPLE
    .\gpu-undervolt-revert.ps1

.EXAMPLE
    .\gpu-undervolt-revert.ps1 -PowerLimit 300

.NOTES
    Requires PowerShell 7+ and nvidia-smi on PATH.
#>
[CmdletBinding()]
param(
    [int]$PowerLimit = 0,
    [string]$ToolPath = $(if ($env:SNU_PATH) { $env:SNU_PATH } else { "$env:USERPROFILE\tools\simple-nvidia-undervolt\simple-nvidia-undervolt.exe" }),
    [string]$BaselineFile = (Join-Path $PSScriptRoot 'gpu-baseline-tuning.json')
)

$ErrorActionPreference = 'Stop'

$elevated = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $elevated) {
    throw 'Administrator rights required. Run the scheduled task: pwsh -File scripts/gpu-undervolt-tasks-run.ps1 -Revert'
}

& nvidia-smi -rgc | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "nvidia-smi -rgc failed (exit $LASTEXITCODE)."
}

# Restore the baseline curve, which is the card's pre-existing overclock and
# measured 3 percent faster than stock. Fall back to clearing the curve when the
# baseline file is absent. Failures here must not abort the revert.
if (Test-Path -LiteralPath $ToolPath) {
    if (Test-Path -LiteralPath $BaselineFile) {
        & $ToolPath --in-tuning-file $BaselineFile --no-persist *> $null
    } else {
        & $ToolPath clear *> $null
    }
}

if ($PowerLimit -le 0) {
    $line = & nvidia-smi '--query-gpu=power.default_limit' '--format=csv,noheader,nounits'
    if ($LASTEXITCODE -ne 0) {
        throw 'nvidia-smi query failed.'
    }
    $PowerLimit = [int][double]($line -split ',\s*')[0]
}

& nvidia-smi -pl $PowerLimit | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "nvidia-smi -pl $PowerLimit failed (exit $LASTEXITCODE)."
}

Start-Sleep -Milliseconds 300
$line = & nvidia-smi '--query-gpu=power.limit,clocks.current.graphics' '--format=csv,noheader,nounits'
if ($LASTEXITCODE -ne 0) {
    throw 'nvidia-smi query failed.'
}
$f = $line -split ',\s*'
Write-Host ("GPU profile reverted: {0} W limit, {1} MHz graphics clock." -f [int][double]$f[0], [int]$f[1]) -ForegroundColor Green
