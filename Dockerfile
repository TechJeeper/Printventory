# Printventory Server Mode Docker Image
# Electron 43+ V8 headers require C++20 (GCC 13+). Bookworm's GCC 12 fails to compile better-sqlite3.
FROM node:22-trixie-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Build tools for native modules (better-sqlite3)
    g++ \
    make \
    python3 \
    # Xvfb for headless display support
    xvfb \
    # Chromium dependencies for Puppeteer
    chromium \
    chromium-sandbox \
    # Additional dependencies
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and scripts (needed for postinstall hook)
COPY package*.json ./
COPY scripts/ ./scripts/

# Set environment variables for npm and electron
# Explicitly disable proxy settings that might interfere with Docker builds
ENV HTTP_PROXY=""
ENV HTTPS_PROXY=""
ENV http_proxy=""
ENV https_proxy=""
ENV NO_PROXY="*"
ENV no_proxy="*"
# Configure npm to handle network issues better with retries
ENV npm_config_fetch_retries=10
ENV npm_config_fetch_retry_mintimeout=20000
ENV npm_config_fetch_retry_maxtimeout=120000
ENV npm_config_fetch_timeout=300000
# Configure electron to download directly without proxy
ENV ELECTRON_GET_USE_PROXY=false
ENV ELECTRON_BUILDER_CACHE=/tmp/.electron-builder-cache
# Use electron mirror (optional - uncomment to use a specific mirror)
# ENV ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

# Install npm dependencies (including devDependencies for Electron)
# Skip postinstall during install; rebuild native modules explicitly below
RUN npm config set proxy null && \
    npm config set https-proxy null && \
    npm config set registry https://registry.npmjs.org/ && \
    npm install --ignore-scripts || \
    (echo "First install attempt failed, retrying..." && \
     sleep 10 && \
     npm install --ignore-scripts) || \
    (echo "Second install attempt failed, retrying with clean cache..." && \
     npm cache clean --force && \
     sleep 10 && \
     npm install --ignore-scripts) && \
    npm cache clean --force

# Rebuild native modules for Electron (requires GCC 13+ from trixie)
RUN rm -rf node_modules/better-sqlite3/build || true && \
    npx @electron/rebuild --version=$(node -p 'require("electron/package.json").version') || \
    npx electron-builder install-app-deps

# Copy application files
COPY main.js bundle-keys.js preload.js renderer.js index.html styles.css preview-wall.css ./
COPY server-bridge.js scan-worker.js parse-worker.js ./
COPY preview-3mf-worker-node.js threemf-loader-simple.js threemf-mesh-extract.js ./
COPY preview.js query-builder.js aitagging.js slicer.js guide.js search.js thumbnail-compress.js ./
COPY vendor/ ./vendor/
COPY favicon.ico ./
COPY *.png *.jpg *.bmp ./
COPY guide/ ./guide/

# Fail the build if required app modules were omitted from COPY above
RUN for f in bundle-keys.js thumbnail-compress.js threemf-mesh-extract.js; do \
      test -f "$f" || (echo "Missing required app file: $f" >&2; exit 1); \
    done

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Set environment variables
ENV DISPLAY=:99
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Disable dconf to prevent warnings in headless Docker environment
ENV DCONF_DISABLE=1
ENV GIO_USE_VFS=local
ENV GIO_USE_VOLUME_MONITOR=unix

# Expose port 5000
EXPOSE 5000

# Set entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]

# Default command
CMD ["--server"]

