@echo off
setlocal

if /I "%~1"=="classic-standard" (
  set "PDN_INSTALL_KIND=classic-standard"
  set "PDN_ELEVATED=1"
)
if /I "%~1"=="classic-custom" (
  set "PDN_INSTALL_KIND=classic-custom"
  set "PDN_ELEVATED=1"
)

if not defined PDN_INSTALL_KIND (
  echo Travny Paint.NET AI installer
  echo.
  echo [1] Classic Paint.NET ^(Program Files^)
  echo [2] Microsoft Store Paint.NET ^(Documents^)
  echo [3] Classic Paint.NET ^(custom folder^)
  choice /C 123 /N /M "Choose installation type [1/2/3]: "
  if errorlevel 3 (
    set "PDN_INSTALL_KIND=classic-custom"
  ) else if errorlevel 2 (
    set "PDN_INSTALL_KIND=store"
  ) else (
    set "PDN_INSTALL_KIND=classic-standard"
  )
)

if /I "%PDN_INSTALL_KIND%"=="classic-custom" if not defined PDN_CLASSIC_DIR (
  set /p "PDN_CLASSIC_DIR=Classic Paint.NET folder (without quotes): "
  if not defined PDN_CLASSIC_DIR (
    echo Classic Paint.NET folder is required.
    exit /b 1
  )
)

if /I not "%PDN_INSTALL_KIND%"=="store" if not defined PDN_ELEVATED (
  set "PDN_INSTALLER=%~f0"
  set "PDN_CHILD_ARG=%PDN_INSTALL_KIND%"
  echo Requesting administrator permission for the Classic Paint.NET install...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; try { $p = Start-Process -FilePath $env:PDN_INSTALLER -ArgumentList $env:PDN_CHILD_ARG -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { Write-Error $_; exit 1 }"
  if errorlevel 1 (
    echo Administrator elevation was cancelled or installation failed.
    exit /b 1
  )
  exit /b 0
)

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

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $common = [IO.Path]::GetFullPath($env:AI_COMMON); $adapter = [IO.Path]::GetFullPath($env:AI_ADAPTER); $kind = $env:PDN_INSTALL_KIND; if ($kind -eq 'store') { $target = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Paint.NET App Files\Effects\Travny.PaintDotNet.AI' } else { if ($kind -eq 'classic-custom') { $classic = $env:PDN_CLASSIC_DIR } else { $roots = @([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles), [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique; $classic = $roots | ForEach-Object { Join-Path $_ 'paint.net' } | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'paintdotnet.exe') -PathType Leaf } | Select-Object -First 1; if (-not $classic) { throw 'Classic Paint.NET was not found in Program Files. Rerun and choose the custom-folder option.' } }; if ([string]::IsNullOrWhiteSpace($classic)) { throw 'Classic Paint.NET folder is required.' }; $classic = [IO.Path]::GetFullPath($classic.Trim()); if (-not (Test-Path -LiteralPath (Join-Path $classic 'paintdotnet.exe') -PathType Leaf)) { throw 'The selected folder does not contain paintdotnet.exe.' }; $target = Join-Path $classic 'Effects\Travny.PaintDotNet.AI' }; New-Item -ItemType Directory -Force -Path $target | Out-Null; Get-ChildItem -LiteralPath $common -Force | Copy-Item -Destination $target -Recurse -Force; $installed = Join-Path $target ([IO.Path]::GetFileName($adapter)); Copy-Item -LiteralPath $adapter -Destination $installed -Force; $other = Join-Path $target $env:AI_OTHER; if (Test-Path -LiteralPath $other) { Remove-Item -LiteralPath $other -Force }; if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw 'Adapter installation verification failed.' }; if (-not (Test-Path -LiteralPath (Join-Path $target 'model\realesr-general-x4v3.onnx') -PathType Leaf)) { throw 'Model installation verification failed.' }; Get-ChildItem -LiteralPath $target -Recurse -File | Unblock-File -ErrorAction SilentlyContinue; Write-Host ('Installed to ' + $target)"
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
