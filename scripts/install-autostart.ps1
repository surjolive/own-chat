param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$taskName = 'SURJO WhatsApp AI Keepalive'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'Removed the SURJO WhatsApp AI logon task.'
  exit 0
}

$keepaliveScript = Join-Path $PSScriptRoot 'keepalive.ps1'
if (-not (Test-Path $keepaliveScript)) {
  throw "Keepalive script not found: $keepaliveScript"
}

$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$keepaliveScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Keeps the local SURJO WhatsApp AI stack running while this Windows user is signed in.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed and started '$taskName' for $currentUser."
Write-Host 'The PC must remain awake and this user must stay signed in for the local stack to remain available.'