#!/bin/bash
# Script to create Docker distribution package for Printventory

set -e

VERSION=$(node -p "require('./package.json').version")
DIST_DIR="dist"
DOCKER_DIST_DIR="${DIST_DIR}/printventory-docker-${VERSION}"
DOCKER_DIST_ZIP="${DIST_DIR}/printventory-docker-${VERSION}.zip"

echo "Creating Docker distribution for Printventory ${VERSION}..."

# Create distribution directory
mkdir -p "${DOCKER_DIST_DIR}"

# Copy Docker-related files
echo "Copying Docker files..."
cp Dockerfile "${DOCKER_DIST_DIR}/"
cp docker-compose.yml "${DOCKER_DIST_DIR}/"
cp docker-entrypoint.sh "${DOCKER_DIST_DIR}/"
cp .dockerignore "${DOCKER_DIST_DIR}/"

# Copy application source files
echo "Copying application files..."
cp package.json "${DOCKER_DIST_DIR}/"
cp package-lock.json "${DOCKER_DIST_DIR}/" 2>/dev/null || true
cp main.js "${DOCKER_DIST_DIR}/"
cp preload.js "${DOCKER_DIST_DIR}/"
cp renderer.js "${DOCKER_DIST_DIR}/"
cp index.html "${DOCKER_DIST_DIR}/"
cp styles.css "${DOCKER_DIST_DIR}/"
cp server-bridge.js "${DOCKER_DIST_DIR}/"
cp scan-worker.js "${DOCKER_DIST_DIR}/"
cp aitagging.js "${DOCKER_DIST_DIR}/"
cp slicer.js "${DOCKER_DIST_DIR}/"
cp guide.js "${DOCKER_DIST_DIR}/"
cp search.js "${DOCKER_DIST_DIR}/"

# Copy assets
echo "Copying assets..."
cp *.png "${DOCKER_DIST_DIR}/" 2>/dev/null || true
cp *.jpg "${DOCKER_DIST_DIR}/" 2>/dev/null || true
cp *.bmp "${DOCKER_DIST_DIR}/" 2>/dev/null || true

# Copy guide directory
if [ -d "guide" ]; then
    cp -r guide "${DOCKER_DIST_DIR}/"
fi

# Create README for Docker distribution
cat > "${DOCKER_DIST_DIR}/README.md" << 'EOF'
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
docker run -d \
  --name printventory-server \
  -p 5000:5000 \
  -v printventory-data:/root/.config/Printventory \
  --restart unless-stopped \
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
EOF

# Create zip archive
echo "Creating zip archive..."
cd "${DIST_DIR}"
zip -r "printventory-docker-${VERSION}.zip" "printventory-docker-${VERSION}" > /dev/null
cd ..

echo ""
echo "✓ Docker distribution created successfully!"
echo "  Location: ${DOCKER_DIST_ZIP}"
echo "  Size: $(du -h "${DOCKER_DIST_ZIP}" | cut -f1)"
echo ""
echo "To distribute:"
echo "  1. Upload ${DOCKER_DIST_ZIP} to your release page"
echo "  2. Users can extract and run: docker-compose up -d"

