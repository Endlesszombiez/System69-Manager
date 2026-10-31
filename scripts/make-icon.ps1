# Rasterizes the selected Foundry mark in Signal cobalt for Windows icons.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$images = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = [Drawing.Bitmap]::new($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.ScaleTransform($size / 64.0, $size / 64.0)
    $brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#235CD8'))
    $outline = [Drawing.Drawing2D.GraphicsPath]::new()
    $outline.FillMode = [Drawing.Drawing2D.FillMode]::Alternate
    $outline.AddPolygon([Drawing.PointF[]]@([Drawing.PointF]::new(13,19),[Drawing.PointF]::new(31,9),[Drawing.PointF]::new(51,20),[Drawing.PointF]::new(51,43),[Drawing.PointF]::new(33,54),[Drawing.PointF]::new(13,43)))
    $outline.AddPolygon([Drawing.PointF[]]@([Drawing.PointF]::new(22,24),[Drawing.PointF]::new(22,38),[Drawing.PointF]::new(33,44),[Drawing.PointF]::new(42,39),[Drawing.PointF]::new(42,25),[Drawing.PointF]::new(31,19)))
    $graphics.FillPath($brush,$outline)
    $pen = [Drawing.Pen]::new($brush,4)
    $graphics.DrawLines($pen,[Drawing.PointF[]]@([Drawing.PointF]::new(15,20),[Drawing.PointF]::new(33,30),[Drawing.PointF]::new(50,21)))
    $graphics.DrawLine($pen,33,30,33,52)
    $stream = [IO.MemoryStream]::new()
    $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
    $images += ,([pscustomobject]@{ Size=$size; Bytes=$stream.ToArray() })
    if ($size -eq 256) { $bitmap.Save((Join-Path $PSScriptRoot '..\assets\icon.png'),[Drawing.Imaging.ImageFormat]::Png) }
    $stream.Dispose(); $pen.Dispose(); $outline.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$target = Join-Path $PSScriptRoot '..\installer\icon.ico'
$file = [IO.File]::Create($target)
$writer = [IO.BinaryWriter]::new($file)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    foreach ($item in $images) {
        $dimension = if ($item.Size -eq 256) { 0 } else { $item.Size }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$item.Bytes.Length); $writer.Write([uint32]$offset)
        $offset += $item.Bytes.Length
    }
    foreach ($item in $images) { $writer.Write([byte[]]$item.Bytes) }
} finally { $writer.Dispose(); $file.Dispose() }
Write-Output "Created $target"
