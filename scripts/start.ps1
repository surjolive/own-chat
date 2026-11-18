param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$logsDir = Join-Path $projectRoot 'data\logs'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

Write-Host 'Starting backend server...'
$backendCommand = 'pnpm --dir apps/server dev'
$backendLog = Join-Path $logsDir 'backend.log'
$backend = Start-Process -FilePath 'powershell' -ArgumentList @('-NoLogo', '-NoExit', '-Command', $backendCommand) -WorkingDirectory $projectRoot -PassThru
Write-Host "Backend started with PID $($backend.Id)"

Write-Host 'Starting dashboard...'
$frontendCommand = 'pnpm --dir apps/dashboard dev -- --host 127.0.0.1 --port 5174'
$frontendLog = Join-Path $logsDir 'frontend.log'
$frontend = Start-Process -FilePath 'powershell' -ArgumentList @('-NoLogo', '-NoExit', '-Command', $frontendCommand) -WorkingDirectory $projectRoot -PassThru
Write-Host "Dashboard started with PID $($frontend.Id)"

Start-Sleep 2
Start-Process 'http://127.0.0.1:5174'

Write-Host 'Dashboard URL: http://127.0.0.1:5174'
Write-Host 'Backend health: http://127.0.0.1:3000/health'
