'use strict';
/**
 * Resize pwa-icon-512.png into chrome-extension icon16/48/128.
 * Run: node scripts/gen-extension-icon48.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const ps = `
Add-Type -AssemblyName System.Drawing
$srcPath = Join-Path (Get-Location) 'pwa-icon-512.png'
$outDir = Join-Path (Get-Location) 'chrome-extension'
function Save-Icon([int]$size, [string]$name, [bool]$iconOnly) {
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  if ($iconOnly) {
    $cropH = [int]($src.Height * 0.70)
    $cropY = [int]($src.Height * 0.03)
    $cropW = $cropH
    $cropX = [int](($src.Width - $cropW) / 2)
    $dest = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $g.DrawImage($src, $dest, $cropX, $cropY, $cropW, $cropH, [System.Drawing.GraphicsUnit]::Pixel)
  } else {
    $g.DrawImage($src, 0, 0, $size, $size)
  }
  $bmp.Save((Join-Path $outDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $src.Dispose()
}
Save-Icon 16 'icon16.png' $true
Save-Icon 48 'icon48.png' $false
Save-Icon 128 'icon128.png' $false
`;

const result = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
  cwd: root,
  encoding: 'utf8'
});
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
console.log(result.stdout || 'Wrote chrome-extension icons from pwa-icon-512.png');
