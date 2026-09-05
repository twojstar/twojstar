[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\src\Feedboard.WidgetProvider\Assets\WidgetPreview.png')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Path (Split-Path $resolvedOutput) -Force | Out-Null

$bitmap = [System.Drawing.Bitmap]::new(300, 304, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$radius = 22
$diameter = $radius * 2
$path.AddArc(1, 1, $diameter, $diameter, 180, 90)
$path.AddArc(299 - $diameter, 1, $diameter, $diameter, 270, 90)
$path.AddArc(299 - $diameter, 303 - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc(1, 303 - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()

$background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 32, 32, 32))
$titleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 190, 190, 190))
$accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 245, 158, 11))
$dividerPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 70, 70, 70), 1)
$titleFont = [System.Drawing.Font]::new('Segoe UI Semibold', 18)
$bodyFont = [System.Drawing.Font]::new('Segoe UI', 11)
$metaFont = [System.Drawing.Font]::new('Segoe UI', 9)

try {
    $graphics.FillPath($background, $path)
    $graphics.FillEllipse($accentBrush, 20, 20, 28, 28)
    $graphics.DrawString('Feedboard', $titleFont, $titleBrush, 60, 19)

    $items = @(
        @('Windows App SDK 2.4 released', 'Microsoft · 4 min'),
        @('A calmer way to follow your feeds', 'Feedboard · 12 min'),
        @('What changed in the latest build', 'GitHub · 28 min')
    )

    $y = 78
    foreach ($item in $items) {
        $graphics.DrawString($item[0], $bodyFont, $titleBrush, 20, $y)
        $graphics.DrawString($item[1], $metaFont, $mutedBrush, 20, $y + 28)
        $graphics.DrawLine($dividerPen, 20, $y + 58, 280, $y + 58)
        $y += 70
    }

    $bitmap.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $metaFont.Dispose()
    $bodyFont.Dispose()
    $titleFont.Dispose()
    $dividerPen.Dispose()
    $accentBrush.Dispose()
    $mutedBrush.Dispose()
    $titleBrush.Dispose()
    $background.Dispose()
    $path.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

Write-Host "Materialized widget picker preview at $resolvedOutput"
