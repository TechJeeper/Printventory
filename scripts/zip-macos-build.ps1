# Create a zip of files needed for macOS build (electron-builder --mac --universal)
# Run from repo root. On macOS: unzip, npm install, npm run build:mac

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

# Version from package.json
$packageJson = Get-Content -Raw -Path "package.json" | ConvertFrom-Json
$version = $packageJson.version

$distDir = "dist"
$stagingName = "printventory-macos-build-$version"
$stagingPath = Join-Path $distDir $stagingName
$zipPath = Join-Path $distDir "printventory-macos-build-$version.zip"

Write-Host "=== Printventory macOS build package ===" -ForegroundColor Cyan
Write-Host "Version: $version"
Write-Host ""

# Ensure dist exists
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

# Remove existing staging and zip
if (Test-Path $stagingPath) { Remove-Item $stagingPath -Recurse -Force }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

New-Item -ItemType Directory -Path $stagingPath | Out-Null

# Root files (from package.json "files" + mac-specific)
$rootFiles = @(
    "package.json",
    "package-lock.json",
    "main.js",
    "preload.js",
    "renderer.js",
    "index.html",
    "styles.css",
    "server-bridge.js",
    "scan-worker.js",
    "aitagging.js",
    "slicer.js",
    "guide.js",
    "preview.js",
    "preview-3mf-worker-node.js",
    "threemf-loader-simple.js",
    "search.js",
    "installer.nsh",
    "logo.png",
    "logo.icns",
    "dup.png",
    "roulette.png",
    "tag.png",
    "3d.png",
    "file-icon.png",
    "sidebar-bg.jpg",
    "bg.png"
)

Write-Host "Copying root files..."
foreach ($f in $rootFiles) {
    if (Test-Path $f) {
        Copy-Item -Path $f -Destination (Join-Path $stagingPath $f) -Force
    }
}

# Optional config
if (Test-Path ".npmrc") { Copy-Item ".npmrc" (Join-Path $stagingPath ".npmrc") -Force }

# build/ (entitlements.mac.plist etc.)
if (Test-Path "build") {
    Write-Host "Copying build/"
    Copy-Item -Path "build" -Destination (Join-Path $stagingPath "build") -Recurse -Force
}

# scripts/
Write-Host "Copying scripts/"
Copy-Item -Path "scripts" -Destination (Join-Path $stagingPath "scripts") -Recurse -Force

# guide/
if (Test-Path "guide") {
    Write-Host "Copying guide/"
    Copy-Item -Path "guide" -Destination (Join-Path $stagingPath "guide") -Recurse -Force
}

# README for the zip
$readme = @"
Printventory macOS build package ($version)
==========================================

On macOS:
  1. unzip this file
  2. cd printventory-macos-build-$version
  3. npm install
  4. npm run build:mac

Output: dist/*.dmg (universal)
"@
Set-Content -Path (Join-Path $stagingPath "README-MACOS-BUILD.txt") -Value $readme

# Create zip
Write-Host "Creating zip: $zipPath"
Compress-Archive -Path $stagingPath -DestinationPath $zipPath -Force

# Remove staging dir
Remove-Item $stagingPath -Recurse -Force

Write-Host ""
Write-Host "Done. Package: $zipPath" -ForegroundColor Green
Write-Host "On macOS: unzip, then npm install && npm run build:mac"
