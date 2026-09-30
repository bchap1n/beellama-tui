<#
.SYNOPSIS
    Trigger a GPU profile scheduled task.

.DESCRIPTION
    Starts the apply or revert task and waits for it to finish. The task runs
    with highest privileges, so this script needs no elevation: that is the
    point of the task indirection.

    Use -Revert before gaming: the reduced power limit costs performance at
    full load.

.PARAMETER PowerLimit
    Run the power-limit-only task: power limit and clock, no V/F curve.

.PARAMETER Revert
    Run the revert task.

.PARAMETER TimeoutSeconds
    Seconds to wait for the task to leave the running state. Default 30.

.EXAMPLE
    .\gpu-undervolt-tasks-run.ps1

.EXAMPLE
    .\gpu-undervolt-tasks-run.ps1 -PowerLimit

.EXAMPLE
    .\gpu-undervolt-tasks-run.ps1 -Revert

.NOTES
    Install the tasks first: sudo pwsh -File scripts/gpu-undervolt-tasks-install.ps1
    Requires PowerShell 7+.
#>
[CmdletBinding()]
param(
    [switch]$PowerLimit,
    [switch]$Revert,
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'

$taskName = if ($Revert) {
    'beellama-gpu-undervolt-revert'
} elseif ($PowerLimit) {
    'beellama-gpu-undervolt-powerlimit'
} else {
    'beellama-gpu-undervolt-apply'
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
    throw "Scheduled task '$taskName' is not registered. Install it first: sudo pwsh -File scripts/gpu-undervolt-tasks-install.ps1"
}

Start-ScheduledTask -TaskName $taskName

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') {
        break
    }
    Start-Sleep -Milliseconds 250
}

$result = (Get-ScheduledTaskInfo -TaskName $taskName).LastTaskResult
$line = & nvidia-smi '--query-gpu=power.limit,clocks.current.graphics' '--format=csv,noheader,nounits'
if ($LASTEXITCODE -ne 0) {
    throw 'nvidia-smi query failed.'
}
$f = $line -split ',\s*'
$state = "GPU now {0} W, {1} MHz" -f [int][double]$f[0], [int]$f[1]

if ($result -ne 0) {
    throw "Task '$taskName' failed with result $result. $state"
}

Write-Host "$taskName done. $state" -ForegroundColor Green
