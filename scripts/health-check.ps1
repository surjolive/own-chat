Write-Host 'Checking application health...'

$apiHealthy = $false
try {
  $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/health' -UseBasicParsing -TimeoutSec 5
  if ($response.StatusCode -eq 200) {
    $apiHealthy = $true
    Write-Host 'API status: healthy'
  }
} catch {
  Write-Host 'API status: unavailable'
}

$pgHealthy = $false
$redisHealthy = $false

try {
  $pgCheck = Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue
  if ($pgCheck.TcpTestSucceeded) {
    $pgHealthy = $true
    Write-Host 'PostgreSQL status: reachable on 5432'
  }
} catch {
  Write-Host 'PostgreSQL status: unavailable'
}

try {
  $redisCheck = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue
  if ($redisCheck.TcpTestSucceeded) {
    $redisHealthy = $true
    Write-Host 'Redis status: reachable on 6379'
  }
} catch {
  Write-Host 'Redis status: unavailable'
}

if (-not $apiHealthy -or -not $pgHealthy -or -not $redisHealthy) {
  Write-Host 'One or more required services are not healthy.' -ForegroundColor Yellow
  exit 1
}

Write-Host 'System health check passed.' -ForegroundColor Green
