<#
.SYNOPSIS
    Apply the beellama GPU serving curve: 300 W limit, 0.800 V cap at 1700 MHz.

.DESCRIPTION
    Sets the power limit, then flattens the V/F curve at a voltage cap with a
    clock target, using simple-nvidia-undervolt (NVAPI). nvidia-smi has no
    voltage API, so real undervolting needs that tool.

    The logon profile. It caps the V/F curve at 0.800 V, holds 1700 MHz, and
    sets the power limit to 300 W. The earlier 0.750 V / 1605 MHz point was
    dropped: the card logged nvlddmkm event 153 under it (12 events from
    2026-10-15 to 2026-11-12, in bursts, with no TDR and no bus drop). One step
    up the voltage curve adds margin. The cause is not proven.

    simple-nvidia-undervolt flattens the curve at the cap, so the clock holds at
    1700 MHz for every voltage at or above 0.800 V.

    This is a standalone profile. It does not read beellama-tui.yaml. The
    scheduled task beellama-gpu-undervolt-apply runs it at logon. The yaml keys
    gpu_power_limit_watts and gpu_clock_mhz configure the on-demand powerlimit
    task instead, not this script.

.PARAMETER PowerLimit
    Power limit in watts. Default 300.

.PARAMETER Millivolts
    Voltage cap in mV. Default 800.

.PARAMETER ClockMhz
    Clock to hold at the cap, in MHz. Default 1700.

.PARAMETER ToolPath
    Path to simple-nvidia-undervolt.exe. Defaults to the installed copy.

.EXAMPLE
    .\gpu-undervolt-curve-800-1700.ps1

.EXAMPLE
    .\gpu-undervolt-curve-800-1700.ps1 -PowerLimit 280 -Millivolts 750 -ClockMhz 1605

.NOTES
    Requires PowerShell 7+, nvidia-smi, and simple-nvidia-undervolt.
    Run gpu-undervolt-revert.ps1 to return to stock.
#>
[CmdletBinding()]
param(
    [int]$PowerLimit = 300,
    [int]$Millivolts = 800,
    [int]$ClockMhz = 1700,
    [string]$ToolPath = $(if ($env:SNU_PATH) { $env:SNU_PATH } else { "$env:USERPROFILE\tools\simple-nvidia-undervolt\simple-nvidia-undervolt.exe" })
)

$ErrorActionPreference = 'Stop'

$elevated = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $elevated) {
    throw 'Administrator rights required. Run from an elevated shell: sudo pwsh -File scripts/gpu-undervolt-curve-800-1700.ps1'
}

if ($PowerLimit -le 0 -or $Millivolts -le 0 -or $ClockMhz -le 0) {
    throw 'PowerLimit, Millivolts, and ClockMhz must all be greater than 0.'
}

if (-not (Test-Path -LiteralPath $ToolPath)) {
    throw ("Undervolt tool not found: " + $ToolPath + " (get it from github.com/vuplea/simple-nvidia-undervolt).")
}

& nvidia-smi -pl $PowerLimit | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "nvidia-smi -pl $PowerLimit failed (exit $LASTEXITCODE)."
}

# --no-persist: the tool's own logon task would fight our apply task.
$toolOutput = & $ToolPath --mv $Millivolts --mhz $ClockMhz --no-persist 2>&1
if ($LASTEXITCODE -ne 0) {
    throw ("Undervolt to " + $Millivolts + " mV / " + $ClockMhz + " MHz failed (exit $LASTEXITCODE): " + ($toolOutput -join " | "))
}

Start-Sleep -Milliseconds 300
$line = & nvidia-smi '--query-gpu=power.limit,clocks.current.graphics' '--format=csv,noheader,nounits'
if ($LASTEXITCODE -ne 0) {
    throw 'nvidia-smi query failed.'
}
$watts = [int][double]($line -split ',\s*')[0]

Write-Host "GPU curve profile applied: $watts W limit, $Millivolts mV cap at $ClockMhz MHz." -ForegroundColor Green
$point = $toolOutput | Select-String -Pattern 'Confirming operating point' | Select-Object -First 1
if ($point) {
    Write-Host ('  ' + $point.Line.Trim())
}
