Write-Host 'Stopping local services...'

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectRootNormalized = $projectRoot.TrimEnd('\')

Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and
  $_.CommandLine -match [regex]::Escape($projectRootNormalized)
} | ForEach-Object {
  Write-Host "Stopping $($_.Name) (PID $($_.ProcessId))"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Get-Service -Name 'Redis' -ErrorAction SilentlyContinue | Stop-Service -ErrorAction SilentlyContinue
Get-Service -Name 'postgresql-*' -ErrorAction SilentlyContinue | Stop-Service -ErrorAction SilentlyContinue

Write-Host 'Processes stopped.'
