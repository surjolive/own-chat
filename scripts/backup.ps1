param()

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $PWD 'data\backups\backup-' + $timestamp
New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
Write-Host "Created backup directory: $backupPath"
Write-Host 'Database and session metadata should be exported here.'
