$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'assets\feedboard.png.b64'
$outDir = Join-Path $root 'assets\generated'
$outFile = Join-Path $outDir 'Feedboard.png'
$packageAssetsDir = Join-Path $root 'packaging\Assets'
$packageIcon = Join-Path $packageAssetsDir 'Feedboard.png'

New-Item -ItemType Directory -Path $outDir -Force | Out-Null
New-Item -ItemType Directory -Path $packageAssetsDir -Force | Out-Null
$base64 = (Get-Content -Raw $source) -replace '\s', ''
$bytes = [Convert]::FromBase64String($base64)
[IO.File]::WriteAllBytes($outFile, $bytes)
[IO.File]::WriteAllBytes($packageIcon, $bytes)
Write-Host "Wrote $outFile"
Write-Host "Wrote $packageIcon"
