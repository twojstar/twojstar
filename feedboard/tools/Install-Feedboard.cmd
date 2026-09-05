@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-feedboard.ps1"
if errorlevel 1 (
  echo.
  echo Feedboard installation failed. See the error above.
  pause
  exit /b 1
)
exit /b 0
