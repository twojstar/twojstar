@echo off
setlocal

echo Travny Paint.NET AI installer
echo.
echo [1] Paint.NET 5.1.x
echo [2] Paint.NET 5.2+
choice /C 12 /N /M "Choose Paint.NET version [1/2]: "
if errorlevel 2 goto modern
set "AI_ADAPTER=%~dp0Paint.NET-5.1\Travny.PaintDotNet.AI.dll"
set "AI_OTHER=Travny.PaintDotNet.AI.Modern.dll"
goto install

:modern
set "AI_ADAPTER=%~dp0Paint.NET-5.2+\Travny.PaintDotNet.AI.Modern.dll"
set "AI_OTHER=Travny.PaintDotNet.AI.dll"

:install
set "AI_COMMON=%~dp0Common\Travny.PaintDotNet.AI"
if not exist "%AI_ADAPTER%" goto :incomplete
if not exist "%AI_COMMON%\Microsoft.ML.OnnxRuntime.dll" goto :incomplete
if not exist "%AI_COMMON%\onnxruntime.dll" goto :incomplete
if not exist "%AI_COMMON%\model\realesr-general-x4v3.onnx" goto :incomplete

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $common = [IO.Path]::GetFullPath($env:AI_COMMON); $adapter = [IO.Path]::GetFullPath($env:AI_ADAPTER); $target = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Paint.NET App Files\Effects\Travny.PaintDotNet.AI'; New-Item -ItemType Directory -Force -Path $target | Out-Null; Get-ChildItem -LiteralPath $common -Force | Copy-Item -Destination $target -Recurse -Force; $installed = Join-Path $target ([IO.Path]::GetFileName($adapter)); Copy-Item -LiteralPath $adapter -Destination $installed -Force; $other = Join-Path $target $env:AI_OTHER; if (Test-Path -LiteralPath $other) { Remove-Item -LiteralPath $other -Force }; if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw 'Adapter installation verification failed.' }; if (-not (Test-Path -LiteralPath (Join-Path $target 'model\realesr-general-x4v3.onnx') -PathType Leaf)) { throw 'Model installation verification failed.' }; Get-ChildItem -LiteralPath $target -Recurse -File | Unblock-File -ErrorAction SilentlyContinue; Write-Host ('Installed to ' + $target)"
if errorlevel 1 (
  echo Installation failed.
  pause
  exit /b 1
)

echo.
echo Restart Paint.NET to load AI Restore.
echo Portable users: combine Common\Travny.PaintDotNet.AI with the matching adapter DLL in Effects\Travny.PaintDotNet.AI.
pause
exit /b 0

:incomplete
echo The package is incomplete.
pause
exit /b 1
