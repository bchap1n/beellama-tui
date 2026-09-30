<#
.SYNOPSIS
    Register the GPU profile scheduled tasks.

.DESCRIPTION
    Creates three scheduled tasks that run with highest privileges, so the TUI
    can change the GPU profile without an elevation prompt:

      beellama-gpu-undervolt-apply        runs gpu-undervolt-curve-1605-750.ps1, at logon and on TUI start
      beellama-gpu-undervolt-powerlimit   runs gpu-undervolt-apply.ps1, on demand only
      beellama-gpu-undervolt-revert       runs gpu-undervolt-revert.ps1, on demand only

    The apply task carries the Anbeeld curve: a 300 W power limit with a V/F cap
    at 0.750 V holding 1605 MHz. The curve script takes its own defaults, so the
    -PowerLimit and -Clock parameters below do not reach it. They configure the
    on-demand powerlimit task instead.

    The powerlimit task is the same power limit without the curve. Use it when
    the curve is not wanted: a flat 0.750 V cap is slower for prefill-heavy work
    than an unlocked clock at the same limit.

    The apply task has an at-logon trigger, so the card comes up on the Anbeeld
    curve by default. The revert task has no trigger: run it manually before
    gaming. The TUI also runs the apply task once when it starts, so serving
    after a revert returns the card to the curve profile.

    The powerlimit task bakes in the power limit and clock given here, because a
    scheduled task cannot take arguments at start time. Re-run this script after
    you change either value.

    This script needs an elevated shell. The TUI prompts for UAC when it runs
    the installer from the scripts menu.

.PARAMETER PowerLimit
    Power limit in watts for the powerlimit task. Default 0 reads
    gpu_power_limit_watts from beellama-tui.yaml, which is the single source of
    truth for the value. The apply (curve) task ignores this parameter.

.PARAMETER Clock
    Graphics clock in MHz for the powerlimit task. Default 0 leaves the clock
    unlocked. A lock measured 7 percent slower on prefill at the 250 W limit,
    so set this only for a thermally limited card.

.PARAMETER Remove
    Unregister all three tasks and exit.

.EXAMPLE
    sudo pwsh -File .\gpu-undervolt-tasks-install.ps1

.EXAMPLE
    sudo pwsh -File .\gpu-undervolt-tasks-install.ps1 -Remove

.NOTES
    Requires PowerShell 7+. Task names are stable; other scripts look them up.
#>
[CmdletBinding()]
param(
    [int]$PowerLimit = 0,
    [int]$Clock = 0,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$ApplyTask = 'beellama-gpu-undervolt-apply'
$RevertTask = 'beellama-gpu-undervolt-revert'
$PowerLimitTask = 'beellama-gpu-undervolt-powerlimit'

$elevated = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $elevated) {
    throw 'Administrator rights required. Run: sudo pwsh -File scripts/gpu-undervolt-tasks-install.ps1'
}

if (-not $Remove -and $PowerLimit -le 0) {
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

if ($Remove) {
    foreach ($name in @($ApplyTask, $RevertTask, $PowerLimitTask)) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Removed scheduled task $name." -ForegroundColor Green
        }
    }
    return
}

$pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
$applyScript = Join-Path $PSScriptRoot 'gpu-undervolt-apply.ps1'
$revertScript = Join-Path $PSScriptRoot 'gpu-undervolt-revert.ps1'
$logonScript = Join-Path $PSScriptRoot 'gpu-undervolt-curve-1605-750.ps1'
foreach ($script in @($applyScript, $revertScript, $logonScript)) {
    if (-not (Test-Path -LiteralPath $script)) {
        throw "Missing script: $script"
    }
}

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

$applyAction = New-ScheduledTaskAction `
    -Execute $pwshPath `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$applyScript`" -PowerLimit $PowerLimit -Clock $Clock" `
    -WorkingDirectory $PSScriptRoot

$logonAction = New-ScheduledTaskAction `
    -Execute $pwshPath `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$logonScript`"" `
    -WorkingDirectory $PSScriptRoot

$revertAction = New-ScheduledTaskAction `
    -Execute $pwshPath `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$revertScript`"" `
    -WorkingDirectory $PSScriptRoot

# At-logon only for apply: the card returns to the serving profile after a
# reboot. Revert stays triggerless because gaming is a manual decision.
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

$applyClock = if ($Clock -gt 0) { "$Clock MHz lock" } else { 'clock unlocked' }
Register-ScheduledTask -TaskName $ApplyTask -Trigger $logonTrigger -Action $logonAction -Principal $principal -Settings $settings `
    -Description 'Apply the Anbeeld undervolt curve at logon: 300 W limit, 0.750 V cap at 1605 MHz. Runs at logon and on TUI start.' -Force | Out-Null
Register-ScheduledTask -TaskName $RevertTask -Action $revertAction -Principal $principal -Settings $settings `
    -Description 'Revert the beellama GPU profile: unlock the graphics clock, clear the V/F curve, restore the default power limit. On demand only.' -Force | Out-Null
Register-ScheduledTask -TaskName $PowerLimitTask -Action $applyAction -Principal $principal -Settings $settings `
    -Description "Apply the power-limit-only profile: $PowerLimit W limit, $applyClock, no V/F curve. On demand only." -Force | Out-Null

Write-Host "Registered $ApplyTask (curve 1605 MHz / 750 mV / 300 W, at logon and on TUI start), $PowerLimitTask ($PowerLimit W, $applyClock, on demand), and $RevertTask (on demand)." -ForegroundColor Green
Write-Host 'Run them with: pwsh -File scripts/gpu-undervolt-tasks-run.ps1 [-PowerLimit|-Revert]'
