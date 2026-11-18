param(
  [switch]$SkipInstall,
  [switch]$SkipServices,
  [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-Directory([string]$Path) {
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Add-EnvIfMissing([string]$EnvFile, [string[]]$RequiredKeys) {
  if (-not (Test-Path $EnvFile)) {
    throw "Missing environment file: $EnvFile"
  }

  $content = Get-Content $EnvFile -Raw
  foreach ($key in $RequiredKeys) {
    if ($content -notmatch "(?m)^$([regex]::Escape($key))=") {
      Add-Content -Path $EnvFile -Value "$key="
    }
  }
}

function Set-EnvDefault([string]$EnvFile, [string]$Key, [string]$Value) {
  $lines = Get-Content $EnvFile
  $updated = @()

  foreach ($line in $lines) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=") {
      if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*$") {
        $updated += "$Key=$Value"
      } else {
        $updated += $line
      }
    } else {
      $updated += $line
    }
  }

  if (-not ($updated | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" })) {
    $updated += "$Key=$Value"
  }

  Set-Content -Path $EnvFile -Value $updated
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Step 'Checking Windows version...'
$osVersion = [System.Environment]::OSVersion.Version
if ($osVersion.Major -lt 10) {
  throw 'This project requires Windows 10 or later.'
}

Write-Step 'Creating required folders...'
Ensure-Directory (Join-Path $projectRoot 'data\sessions')
Ensure-Directory (Join-Path $projectRoot 'data\backups')
Ensure-Directory (Join-Path $projectRoot 'data\logs')

$envExample = Join-Path $projectRoot '.env.example'
$envFile = Join-Path $projectRoot '.env'
if (-not (Test-Path $envFile)) {
  Copy-Item $envExample $envFile
  Write-Host 'Created .env from .env.example'
}

$requiredEnv = @(
  'NODE_ENV',
  'APP_NAME',
  'APP_HOST',
  'APP_PORT',
  'DASHBOARD_PORT',
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'COOKIE_SECRET',
  'SESSION_ENCRYPTION_KEY',
  'SUPER_ADMIN_USERNAME',
  'SUPER_ADMIN_EMAIL',
  'SUPER_ADMIN_PASSWORD'
)
Add-EnvIfMissing $envFile $requiredEnv

Set-EnvDefault $envFile 'NODE_ENV' 'development'
Set-EnvDefault $envFile 'APP_NAME' 'SURJO_WHATSAPP_AI'
Set-EnvDefault $envFile 'APP_HOST' '127.0.0.1'
Set-EnvDefault $envFile 'APP_PORT' '3000'
Set-EnvDefault $envFile 'DASHBOARD_PORT' '5174'
Set-EnvDefault $envFile 'DATABASE_URL' 'postgresql://postgres:postgres@127.0.0.1:5432/surjo_whatsapp_ai?schema=public'
Set-EnvDefault $envFile 'REDIS_URL' 'redis://127.0.0.1:6379'
Set-EnvDefault $envFile 'JWT_SECRET' ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
Set-EnvDefault $envFile 'COOKIE_SECRET' ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
Set-EnvDefault $envFile 'SESSION_ENCRYPTION_KEY' ([guid]::NewGuid().ToString('N'))
Set-EnvDefault $envFile 'SUPER_ADMIN_USERNAME' 'superadmin'
Set-EnvDefault $envFile 'SUPER_ADMIN_EMAIL' 'admin@surjo.local'
Set-EnvDefault $envFile 'SUPER_ADMIN_PASSWORD' ('ChangeMe-' + [guid]::NewGuid().ToString('N'))

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
}

Write-Step 'Checking dependencies...'
$missingTools = @()
if (-not (Test-Command node)) { $missingTools += 'node' }
if (-not (Test-Command npm)) { $missingTools += 'npm' }
if (-not (Test-Command python)) { $missingTools += 'python' }

if ($missingTools.Count -gt 0 -and -not $SkipInstall) {
  Write-Host "Missing tools: $($missingTools -join ', ')"
  if (Test-Command winget) {
    foreach ($tool in $missingTools) {
      switch ($tool) {
        'node' { winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e } 
        'npm' { winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e }
        'python' { winget install --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements -e }
      }
    }
  } elseif (Test-Command choco) {
    foreach ($tool in $missingTools) {
      switch ($tool) {
        'node' { choco install nodejs-lts -y }
        'npm' { choco install nodejs-lts -y }
        'python' { choco install python -y }
      }
    }
  } else {
    throw 'No supported Windows package manager was found. Install Node.js and Python manually, then re-run setup.'
  }
}

if (-not (Test-Command pnpm)) {
  Write-Host 'pnpm was not found. Installing globally...'
  npm install -g pnpm
}

if (-not (Test-Command docker) -and -not (Test-Command redis-server) -and -not (Test-Command psql)) {
  Write-Host 'PostgreSQL and Redis were not detected on the system.'
  if (Test-Command winget) {
    Write-Step 'Installing PostgreSQL and Redis with winget...'
    $postgresPackageIds = @('PostgreSQL.PostgreSQL.16', 'PostgreSQL.PostgreSQL.17', 'PostgreSQL.PostgreSQL.15', 'PostgreSQL.PostgreSQL')
    $installedPostgres = $false
    foreach ($packageId in $postgresPackageIds) {
      try {
        winget install --id $packageId --accept-source-agreements --accept-package-agreements -e
        $installedPostgres = $true
        break
      } catch {
        Write-Host "PostgreSQL package $packageId was not available. Trying the next candidate."
      }
    }
    if (-not $installedPostgres) {
      throw 'PostgreSQL could not be installed with winget. Please install PostgreSQL manually and rerun setup.'
    }
    winget install --id Redis.Redis --accept-source-agreements --accept-package-agreements -e
  } elseif (Test-Command choco) {
    Write-Step 'Installing PostgreSQL and Redis with Chocolatey...'
    choco install postgresql redis -y
  } else {
    throw 'Unable to find PostgreSQL or Redis. Install them manually or enable Docker, then rerun setup.'
  }
}

Write-Step 'Installing project dependencies...'
pnpm install

if (-not $SkipServices) {
  Write-Step 'Starting PostgreSQL and Redis...'

  $pgRoot = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if ($pgRoot) {
    $pgBin = Join-Path $pgRoot.FullName 'bin'
    $dataDir = Join-Path $pgRoot.FullName 'data'
    $pgLog = Join-Path $env:TEMP 'surjo-postgres.log'
    $pgCtl = Join-Path $pgBin 'pg_ctl.exe'

    $pgService = Get-Service -Name '*postgres*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pgService) {
      try {
        $serviceStatus = (Get-Service $pgService.Name).Status
        if ($serviceStatus -ne 'Running') {
          Start-Service $pgService.Name
        }
      } catch {
        Write-Host 'The PostgreSQL Windows service is not usable in this environment. Falling back to pg_ctl.'
        if (Test-Path $pgCtl) {
          & $pgCtl -D $dataDir -l $pgLog start
        }
      }
    } elseif (Test-Path $pgCtl) {
      & $pgCtl -D $dataDir -l $pgLog start
    }
  }

  if (Test-Command redis-server) {
    $redisService = Get-Service -Name 'Redis' -ErrorAction SilentlyContinue
    if ($redisService) {
      $serviceStatus = (Get-Service $redisService.Name).Status
      if ($serviceStatus -ne 'Running') {
        Start-Service $redisService.Name
      }
    } else {
      Start-Process -FilePath (Get-Command redis-server).Source -ArgumentList '--save "" --appendonly no' -WindowStyle Hidden
    }
  } elseif (Test-Command docker) {
    Write-Host 'Docker detected. Starting the project Redis/Postgres stack...'
    docker compose -f (Join-Path $projectRoot 'infra\docker-compose.yml') up -d
  }
}

Write-Step 'Checking database connectivity...'
$postgresReady = $false
$psqlCandidate = @(
  (Get-Command psql -ErrorAction SilentlyContinue).Source,
  (Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter 'psql.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
)
$psqlExe = $psqlCandidate | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($psqlExe) {
  $dbName = 'surjo_whatsapp_ai'
  $env:PGPASSWORD = 'postgres'
  $dbCheck = & $psqlExe -h 127.0.0.1 -U postgres -d postgres -At -c "SELECT 1" 2>$null
  if (-not $LASTEXITCODE -or $LASTEXITCODE -eq 0) {
    $postgresReady = $true
    $dbExists = & $psqlExe -h 127.0.0.1 -U postgres -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname = 'surjo_whatsapp_ai';" 2>$null
    if (-not ($dbExists -match '1')) {
      & $psqlExe -h 127.0.0.1 -U postgres -d postgres -c 'CREATE DATABASE "surjo_whatsapp_ai";' 2>$null | Out-Null
    }
  }
} else {
  $pgIsReady = Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter 'pg_isready.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pgIsReady) {
    & $pgIsReady.FullName -h 127.0.0.1 -p 5432
    $postgresReady = $LASTEXITCODE -eq 0
  }
}
if (-not $postgresReady) {
  throw 'PostgreSQL did not respond on localhost:5432. Please start the database service and rerun setup.'
}

Write-Step 'Checking Redis connectivity...'
if (Test-Command redis-cli) {
  redis-cli -p 6379 ping | Out-Null
} elseif (Test-Command redis-server) {
  & (Get-Command redis-server).Source --port 6379 --save "" --appendonly no --daemonize yes
}

Write-Step 'Running Prisma migrations...'
pnpm db:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma client generation failed.' }
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Prisma migration failed.' }

Write-Step 'Starting application services...'
if (-not $SkipLaunch) {
  & (Join-Path $projectRoot 'start.bat')
  Start-Sleep 3
  Start-Process "http://127.0.0.1:5174"
}

Write-Host ''
Write-Host 'Setup completed.' -ForegroundColor Green
Write-Host 'Open the dashboard at http://127.0.0.1:5174' -ForegroundColor Green
Write-Host 'Use the WhatsApp QR login to scan with your phone in WhatsApp > Linked Devices.' -ForegroundColor Yellow
