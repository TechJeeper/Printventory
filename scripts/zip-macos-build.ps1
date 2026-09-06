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
    "preview-wall.css",
    "thumbnail-progress.css",
    "thumbnail-progress.js",
    "server-bridge.js",
    "scan-worker.js",
    "parse-worker.js",
    "aitagging.js",
    "thumbnail-compress.js",
    "slicer.js",
    "guide.js",
    "preview.js",
    "query-builder.js",
    "filament.js",
    "spoolman.js",
    "preview-3mf-worker-node.js",
    "threemf-loader-simple.js",
    "threemf-mesh-extract.js",
    "search.js",
    "installer.nsh",
    "logo.png",
    "logo.icns",
    "dup.png",
    "roulette.png",
    "tag.png",
    "filament.png",
    "3d.png",
    "file-icon.png",
    "sidebar-bg.jpg",
    "bg.png"
)

# Merge electron-builder file list so new app files are not omitted from macOS zip builds
if ($packageJson.build -and $packageJson.build.files) {
    foreach ($entry in $packageJson.build.files) {
        if ($entry -match '[\*\?]' -or $entry.StartsWith('node_modules/')) { continue }
        if ($entry -notin $rootFiles) { $rootFiles += $entry }
    }
}

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

# vendor/ (Three.js + loaders - required for index.html and parse-worker importScripts)
if (Test-Path "vendor") {
    Write-Host "Copying vendor/"
    Copy-Item -Path "vendor" -Destination (Join-Path $stagingPath "vendor") -Recurse -Force
} else {
    Write-Warning "vendor/ folder missing - macOS build will fail to load 3D previews."
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

# Create zip (tar produces forward-slash paths; Compress-Archive breaks macOS unzip)
Write-Host "Creating zip: $zipPath"
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    Write-Error "tar is required for macOS-compatible zips. Use Windows 10+ or install bsdtar."
}
Push-Location $distDir
try {
    if (Test-Path (Split-Path -Leaf $zipPath)) { Remove-Item (Split-Path -Leaf $zipPath) -Force }
    & tar -a -c -f (Split-Path -Leaf $zipPath) $stagingName
    if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

# Remove staging dir
Remove-Item $stagingPath -Recurse -Force

Write-Host ""
Write-Host "Done. Package: $zipPath" -ForegroundColor Green
Write-Host "On macOS: unzip, then npm install; npm run build:mac"
