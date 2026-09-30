<#
.SYNOPSIS
    Apply the Anbeeld GPU undervolt curve: 300 W limit, 0.750 V cap at 1605 MHz.

.DESCRIPTION
    Sets the power limit, then flattens the V/F curve at a voltage cap with a
    clock target, using simple-nvidia-undervolt (NVAPI). nvidia-smi has no
    voltage API, so real undervolting needs that tool.

    The curve is Ivan Neustroev's RTX 3090 profile: 1605 MHz at 0.750 V, with
    the power limit left at 300 W. The stock curve reaches only 1380 MHz at the
    same 0.750 V, so the cap adds a 225 MHz offset. Typical draw during
    inference is 240 to 250 W, well under the limit: the limit guards the peak
    and the curve does the efficiency work.

    The source curve is drawn in MSI Afterburner and keeps rising above 0.750 V,
    to about 2178 MHz at 1.100 V. This script does not. simple-nvidia-undervolt
    flattens the curve at the cap, so the clock holds at 1605 MHz for every
    voltage at or above 0.750 V. That is the stricter reading of "limited to
    1605 MHz at 0.750 V".

    Keep the power limit and the curve separate. A power limit alone loses
    throughput and does not gain the efficiency of a raised curve: on a 3090 at
    310 W the two differ by 3 to 5 percentage points, and at 290 W by 5 to 7.

    This is a standalone profile. It does not read beellama-tui.yaml. The
    scheduled task beellama-gpu-undervolt-apply runs it at logon and on TUI
    start. The yaml keys gpu_power_limit_watts and gpu_clock_mhz configure the
    on-demand powerlimit task instead, not this script.

.PARAMETER PowerLimit
    Power limit in watts. Default 300.

.PARAMETER Millivolts
    Voltage cap in mV. Default 750.

.PARAMETER ClockMhz
    Clock to hold at the cap, in MHz. Default 1605.

.PARAMETER ToolPath
    Path to simple-nvidia-undervolt.exe. Defaults to the installed copy.

.EXAMPLE
    .\gpu-undervolt-curve-1605-750.ps1

.EXAMPLE
    .\gpu-undervolt-curve-1605-750.ps1 -PowerLimit 280 -Millivolts 800 -ClockMhz 1700

.NOTES
    Requires PowerShell 7+, nvidia-smi, and simple-nvidia-undervolt.
    Run gpu-undervolt-revert.ps1 to return to stock.
#>
[CmdletBinding()]
param(
    [int]$PowerLimit = 300,
    [int]$Millivolts = 750,
    [int]$ClockMhz = 1605,
    [string]$ToolPath = 'C:\Users\brock\tools\simple-nvidia-undervolt\simple-nvidia-undervolt.exe'
)

$ErrorActionPreference = 'Stop'

$elevated = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $elevated) {
    throw 'Administrator rights required. Run from an elevated shell: sudo pwsh -File scripts/gpu-undervolt-curve-1605-750.ps1'
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
    throw ("Undervolt to " + $Millivolts + " mV / " + $ClockMhz + " MHz failed (exit " + $LASTEXITCODE + "): " + ($toolOutput -join " | "))
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
