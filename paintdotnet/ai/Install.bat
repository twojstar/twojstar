@echo off
setlocal

echo Travny Paint.NET AI installer
echo.
set "AI_SOURCE=%~dp0Effects\Travny.PaintDotNet.AI"
if not exist "%AI_SOURCE%\Travny.PaintDotNet.AI.dll" goto :incomplete
if not exist "%AI_SOURCE%\onnxruntime.dll" goto :incomplete
if not exist "%AI_SOURCE%\model\realesr-general-x4v3.onnx" goto :incomplete

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $source = [IO.Path]::GetFullPath($env:AI_SOURCE); $target = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Paint.NET App Files\Effects\Travny.PaintDotNet.AI'; New-Item -ItemType Directory -Force -Path $target | Out-Null; Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $target -Recurse -Force; Get-ChildItem -LiteralPath $target -Recurse -File | Unblock-File -ErrorAction SilentlyContinue; Write-Host ('Installed to ' + $target)"
if errorlevel 1 (
  echo Installation failed.
  pause
  exit /b 1
)

echo.
echo Restart Paint.NET to load AI Restore.
echo Portable users: copy Effects\Travny.PaintDotNet.AI into the portable Effects folder.
pause
exit /b 0

:incomplete
echo The package is incomplete.
pause
exit /b 1
