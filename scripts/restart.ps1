param()

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptRoot 'stop.ps1')
& (Join-Path $scriptRoot 'start.ps1')
