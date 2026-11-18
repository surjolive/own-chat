@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
if errorlevel 1 (
  echo.
  echo Setup failed. Review the error above and fix the required dependency or service state.
  exit /b %errorlevel%
)
