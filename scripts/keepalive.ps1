param()

$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $projectRoot 'data\logs'
$backendLog = Join-Path $logsDir 'backend.log'
$dashboardLog = Join-Path $logsDir 'frontend.log'
$keepaliveLog = Join-Path $logsDir 'keepalive.log'
$mutex = New-Object System.Threading.Mutex($false, 'Local\SurjoWhatsAppAIKeepalive')

if (-not $mutex.WaitOne(0)) { exit 0 }

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Set-Location $projectRoot

function Write-KeepaliveLog([string]$Message) {
  Add-Content -Path $keepaliveLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}

function Test-LocalPort([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(1200)) { return $false }
    $client.EndConnect($pending)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Start-ProjectProcess([string]$Command, [string]$LogPath) {
  $safeRoot = $projectRoot.Replace("'", "''")
  $safeLog = $LogPath.Replace("'", "''")
  $script = "Set-Location -LiteralPath '$safeRoot'; pnpm $Command *>> '$safeLog'"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
}

$pgRoot = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -First 1
$pgCtl = if ($pgRoot) { Join-Path $pgRoot.FullName 'bin\pg_ctl.exe' }
$pgData = if ($pgRoot) { Join-Path $pgRoot.FullName 'data' }
$pgLog = Join-Path $env:TEMP 'surjo-postgres.log'
$backendProcess = $null
$dashboardProcess = $null

Write-KeepaliveLog 'Supervisor started.'
while ($true) {
  if (-not (Test-LocalPort 5432) -and $pgCtl -and (Test-Path $pgCtl)) {
    Write-KeepaliveLog 'Starting PostgreSQL.'
    & $pgCtl -D $pgData -l $pgLog start *> $null
  }

  if (-not (Test-LocalPort 6379)) {
    $redisService = Get-Service -Name 'Redis' -ErrorAction SilentlyContinue
    if ($redisService -and $redisService.Status -ne 'Running') {
      try { Start-Service -Name 'Redis' -ErrorAction Stop } catch { Write-KeepaliveLog "Could not start Redis service: $($_.Exception.Message)" }
    }
    if (-not (Test-LocalPort 6379)) {
      $redisCommand = Get-Command redis-server -ErrorAction SilentlyContinue
      if ($redisCommand) {
        Write-KeepaliveLog 'Starting Redis server.'
        Start-Process -FilePath $redisCommand.Source -ArgumentList @('--port', '6379', '--save', '', '--appendonly', 'no') -WindowStyle Hidden | Out-Null
      }
    }
  }

  $apiReady = $false
  try { $apiReady = (Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 3).status -eq 'ready' } catch { }
  if (-not $apiReady -and (-not $backendProcess -or $backendProcess.HasExited)) {
    Write-KeepaliveLog 'Starting backend.'
    $backendProcess = Start-ProjectProcess '--dir apps/server dev' $backendLog
  }

  if (-not (Test-LocalPort 5174) -and (-not $dashboardProcess -or $dashboardProcess.HasExited)) {
    Write-KeepaliveLog 'Starting dashboard.'
    $dashboardProcess = Start-ProjectProcess '--dir apps/dashboard dev -- --host 127.0.0.1 --port 5174 --strictPort' $dashboardLog
  }

  Start-Sleep -Seconds 15
}