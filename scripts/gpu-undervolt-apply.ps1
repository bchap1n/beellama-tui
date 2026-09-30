<#
.SYNOPSIS
    Apply the GPU serving profile: power limit and optional clock lock.

.DESCRIPTION
    Sets the power limit and the graphics clock lock.

    The power limit is the useful knob for local inference: 250 W against the
    370 W default costs about 5 percent prefill throughput and drops the card
    out of its highest boost states.

    The clock lock is off by default. Measured on this box at the 250 W limit
    with Qwen3.8-27B-UD-Q4_K_M (pp512/tg128, interleaved, r5), a 1350 MHz lock
    was 7 percent slower on prefill than an unlocked clock (1028 t/s against
    1106 t/s) and neutral on decode. The power cap already bounds voltage, so
    the lock adds no thermal headroom. Pass -Clock only when a card is
    thermally limited and needs a hard ceiling for fan noise.

    -Clock 0 means unlocked, not 0 MHz: the script removes any existing lock so
    the driver manages boost again.

    Run this through the scheduled task beellama-gpu-undervolt-apply, or from
    an elevated shell. That task also has an at-logon trigger, so the profile is
    re-applied after a reboot.

    nvidia-smi settings do not survive a reboot. Run gpu-undervolt-revert.ps1
    before gaming: the reduced limit costs performance at full load.

.PARAMETER PowerLimit
    Power limit in watts. Default 0 reads gpu_power_limit_watts from
    beellama-tui.yaml, the single source of truth for the value.

.PARAMETER Clock
    Graphics clock to lock, in MHz. Default 0 removes any clock lock.
    Supported clocks step by 15 MHz.

.EXAMPLE
    .\gpu-undervolt-apply.ps1

.EXAMPLE
    .\gpu-undervolt-apply.ps1 -PowerLimit 200

.NOTES
    Requires PowerShell 7+ and nvidia-smi on PATH.
#>
[CmdletBinding()]
param(
    [int]$PowerLimit = 0,
    [int]$Clock = 0
)

$ErrorActionPreference = 'Stop'

$elevated = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $elevated) {
    throw 'Administrator rights required. Run the scheduled task: pwsh -File scripts/gpu-undervolt-tasks-run.ps1'
}

if ($PowerLimit -le 0) {
    $configPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'beellama-tui.yaml'
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Cannot read the power limit: $configPath not found. Pass -PowerLimit explicitly."
    }
    $match = Select-String -Path $configPath -Pattern '^\s*gpu_power_limit_watts:\s*(\d+)' | Select-Object -First 1
    if (-not $match) {
        throw "gpu_power_limit_watts is not set in $configPath. Pass -PowerLimit explicitly."
    }
    $PowerLimit = [int]$match.Matches[0].Groups[1].Value
}

if ($PowerLimit -gt 0) {
    & nvidia-smi -pl $PowerLimit | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "nvidia-smi -pl $PowerLimit failed (exit $LASTEXITCODE)."
    }
}

if ($Clock -gt 0) {
    & nvidia-smi -lgc "$Clock,$Clock" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "nvidia-smi -lgc $Clock,$Clock failed (exit $LASTEXITCODE)."
    }
} else {
    & nvidia-smi -rgc | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "nvidia-smi -rgc failed (exit $LASTEXITCODE)."
    }
}

Start-Sleep -Milliseconds 300
$line = & nvidia-smi '--query-gpu=power.limit,clocks.current.graphics' '--format=csv,noheader,nounits'
if ($LASTEXITCODE -ne 0) {
    throw 'nvidia-smi query failed.'
}
$watts = [int][double]($line -split ',\s*')[0]
$clockText = if ($Clock -gt 0) { "$Clock MHz locked" } else { 'clock unlocked' }
Write-Host "GPU profile applied: $watts W limit, $clockText." -ForegroundColor Green
