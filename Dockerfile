# Printventory Server Mode Docker Image
FROM node:20-slim

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

# Copy package files
COPY package*.json ./

# Install npm dependencies (including devDependencies for Electron)
RUN npm install && \
    npm cache clean --force

# Copy application files
COPY main.js preload.js renderer.js index.html styles.css ./
COPY server-bridge.js scan-worker.js ./
COPY aitagging.js slicer.js guide.js search.js ./
COPY *.png *.jpg *.bmp ./
COPY guide/ ./guide/

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Set environment variables
ENV DISPLAY=:99
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expose port 5000
EXPOSE 5000

# Set entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]

# Default command
CMD ["--server"]

