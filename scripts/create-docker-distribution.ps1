# Script to create Docker distribution package for Printventory (PowerShell)

$ErrorActionPreference = "Stop"

# Get version from package.json
$packageJson = Get-Content "package.json" | ConvertFrom-Json
$version = $packageJson.version

$distDir = "dist"
$dockerDistDir = "$distDir\printventory-docker-$version"
$dockerDistZip = "$distDir\printventory-docker-$version.zip"

Write-Host "Creating Docker distribution for Printventory $version..." -ForegroundColor Green

# Create distribution directory
New-Item -ItemType Directory -Force -Path $dockerDistDir | Out-Null

# Copy Docker-related files
Write-Host "Copying Docker files..."
Copy-Item "Dockerfile" $dockerDistDir
Copy-Item "docker-compose.yml" $dockerDistDir
Copy-Item "docker-entrypoint.sh" $dockerDistDir
Copy-Item ".dockerignore" $dockerDistDir

# Copy application source files
Write-Host "Copying application files..."
Copy-Item "package.json" $dockerDistDir
if (Test-Path "package-lock.json") {
    Copy-Item "package-lock.json" $dockerDistDir
}
Copy-Item "main.js" $dockerDistDir
Copy-Item "preload.js" $dockerDistDir
Copy-Item "renderer.js" $dockerDistDir
Copy-Item "index.html" $dockerDistDir
Copy-Item "styles.css" $dockerDistDir
Copy-Item "server-bridge.js" $dockerDistDir
Copy-Item "scan-worker.js" $dockerDistDir
Copy-Item "aitagging.js" $dockerDistDir
Copy-Item "slicer.js" $dockerDistDir
Copy-Item "guide.js" $dockerDistDir
Copy-Item "search.js" $dockerDistDir

# Copy assets
Write-Host "Copying assets..."
Get-ChildItem -Filter "*.png" | Copy-Item -Destination $dockerDistDir -ErrorAction SilentlyContinue
Get-ChildItem -Filter "*.jpg" | Copy-Item -Destination $dockerDistDir -ErrorAction SilentlyContinue
Get-ChildItem -Filter "*.bmp" | Copy-Item -Destination $dockerDistDir -ErrorAction SilentlyContinue

# Copy guide directory
if (Test-Path "guide") {
    Copy-Item "guide" $dockerDistDir -Recurse
}

# Create README for Docker distribution
$readmeContent = @"
# Printventory Docker Distribution

This package contains everything needed to run Printventory in server mode using Docker.

## Quick Start

1. **Extract this archive:**
   ```bash
   unzip printventory-docker-*.zip
   cd printventory-docker-*
   ```

2. **Build and run with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

3. **Access the server:**
   Open your browser to: http://localhost:5000

## Alternative: Build and Run Manually

```bash
# Build the image
docker build -t printventory:latest .

# Run the container
docker run -d `
  --name printventory-server `
  -p 5000:5000 `
  -v printventory-data:/root/.config/Printventory `
  --restart unless-stopped `
  printventory:latest
```

## Network Shares

To access network shares, mount them into the container. See the main README.md for detailed instructions.

## Documentation

For complete documentation, see:
- Main README.md (included in full distribution)
- Docker section in application Help > Server Mode Info

## Support

For issues or questions, please refer to the main project repository.
"@

Set-Content -Path "$dockerDistDir\README.md" -Value $readmeContent

# Create zip archive
Write-Host "Creating zip archive..."
if (Test-Path $dockerDistZip) {
    Remove-Item $dockerDistZip -Force
}
Compress-Archive -Path "$dockerDistDir\*" -DestinationPath $dockerDistZip -Force

$zipSize = (Get-Item $dockerDistZip).Length / 1MB
$zipSizeFormatted = "{0:N2}" -f $zipSize

Write-Host ""
Write-Host "✓ Docker distribution created successfully!" -ForegroundColor Green
Write-Host "  Location: $dockerDistZip"
Write-Host "  Size: $zipSizeFormatted MB"
Write-Host ""
Write-Host "To distribute:"
Write-Host "  1. Upload $dockerDistZip to your release page"
Write-Host "  2. Users can extract and run: docker-compose up -d"

