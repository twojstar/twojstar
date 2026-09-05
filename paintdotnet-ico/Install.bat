@echo off
setlocal

echo Paint.NET ICO FileType installer
echo.
echo [1] Paint.NET 5.1.x
echo [2] Paint.NET 5.2+
choice /C 12 /N /M "Choose Paint.NET version [1/2]: "
if errorlevel 2 goto modern
set "PDN_ICO_SOURCE=%~dp0Paint.NET-5.1\Travny.PaintDotNet.IcoFileType.dll"
set "PDN_ICO_OTHER=Travny.PaintDotNet.IcoFileType.Modern.dll"
goto install

:modern
set "PDN_ICO_SOURCE=%~dp0Paint.NET-5.2+\Travny.PaintDotNet.IcoFileType.Modern.dll"
set "PDN_ICO_OTHER=Travny.PaintDotNet.IcoFileType.dll"

:install
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $target = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Paint.NET App Files\FileTypes'; New-Item -ItemType Directory -Force -Path $target | Out-Null; $other = Join-Path $target $env:PDN_ICO_OTHER; if (Test-Path -LiteralPath $other) { Remove-Item -LiteralPath $other -Force }; $installed = Join-Path $target ([IO.Path]::GetFileName($env:PDN_ICO_SOURCE)); Copy-Item -LiteralPath $env:PDN_ICO_SOURCE -Destination $installed -Force; if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw 'Installation verification failed.' }; Unblock-File -LiteralPath $installed -ErrorAction SilentlyContinue; Write-Host ('Installed to ' + $installed)"
if errorlevel 1 (
  echo Installation failed.
  pause
  exit /b 1
)
echo.
echo Restart Paint.NET to load the plugin.
echo Portable Paint.NET users should copy the matching DLL to the portable FileTypes folder instead.
pause
