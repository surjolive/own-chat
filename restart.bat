@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
