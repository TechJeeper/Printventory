# PowerShell wrapper for Linux AppImage build script
# This script provides a convenient way to build Linux AppImage from Windows

Write-Host "Building Linux AppImage from Windows..." -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is available
try {
    $nodeVersion = node --version
    Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Run the Node.js build script
$scriptPath = Join-Path $PSScriptRoot "build-linux-appimage.js"
node $scriptPath

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed with exit code: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

