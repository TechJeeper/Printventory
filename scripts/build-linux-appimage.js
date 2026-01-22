const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

console.log('Building Linux AppImage from Windows...\n');

// Check if WSL is available
function checkWSL() {
  try {
    execSync('wsl --list --quiet', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Check if Docker is available
function checkDocker() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Convert Windows path to WSL path
function toWSLPath(winPath) {
  // Normalize path separators
  const normalized = path.resolve(winPath).replace(/\\/g, '/');
  // Extract drive letter (should be first character)
  const drive = normalized[0].toLowerCase();
  // Convert C:/path to /mnt/c/path
  return `/mnt/${drive}${normalized.substring(2)}`;
}

// Build using WSL
function buildWithWSL() {
  console.log('Using WSL for Linux build...\n');
  
  const wslProjectRoot = toWSLPath(projectRoot);
  const wslDistDir = toWSLPath(distDir);
  
  // Check if Node.js is installed in WSL
  try {
    execSync('wsl which node', { stdio: 'ignore' });
  } catch (error) {
    console.error('ERROR: Node.js not found in WSL.');
    console.error('Please install Node.js in your WSL distribution:');
    console.error('  wsl sudo apt-get update');
    console.error('  wsl sudo apt-get install -y nodejs npm');
    process.exit(1);
  }
  
  // Always install/rebuild dependencies in WSL to ensure native modules are built for Linux
  // Windows node_modules won't work for Linux builds (especially better-sqlite3)
  console.log('Installing/rebuilding dependencies in WSL (native modules need Linux build)...');
  try {
    execSync(`wsl bash -c "cd '${wslProjectRoot}' && npm install"`, { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to install dependencies in WSL');
    process.exit(1);
  }
  
  // Clean any existing native module builds to ensure fresh rebuild
  console.log('Cleaning existing native module builds...');
  try {
    execSync(`wsl bash -c "cd '${wslProjectRoot}' && rm -rf node_modules/better-sqlite3/build"`, { stdio: 'inherit' });
  } catch (error) {
    // Ignore errors if directory doesn't exist
  }
  
  // Explicitly rebuild native modules for Electron on Linux
  // Use @electron/rebuild which is more reliable than electron-builder install-app-deps
  console.log('Rebuilding native modules for Electron on Linux...');
  try {
    execSync(`wsl bash -c "cd '${wslProjectRoot}' && npx @electron/rebuild --version=\$(node -p 'require(\\\"electron/package.json\\\").version')"`, { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to rebuild native modules for Electron');
    console.error('Trying alternative method...');
    // Fallback to electron-builder install-app-deps
    try {
      execSync(`wsl bash -c "cd '${wslProjectRoot}' && npx electron-builder install-app-deps"`, { stdio: 'inherit' });
    } catch (fallbackError) {
      console.error('Both rebuild methods failed. Please ensure build tools are installed in WSL:');
      console.error('  wsl sudo apt-get update');
      console.error('  wsl sudo apt-get install -y build-essential python3');
      process.exit(1);
    }
  }
  
  // Verify the native module was built correctly
  console.log('Verifying native module build...');
  try {
    const nativeModulePath = `node_modules/better-sqlite3/build/Release/better_sqlite3.node`;
    execSync(`wsl bash -c "cd '${wslProjectRoot}' && test -f '${nativeModulePath}' && file '${nativeModulePath}'"`, { stdio: 'inherit' });
    console.log('✓ Native module built successfully');
  } catch (error) {
    console.warn('⚠ Warning: Could not verify native module build');
  }
  
  // Build the AppImage
  console.log('Building AppImage in WSL...\n');
  try {
    execSync(`wsl bash -c "cd '${wslProjectRoot}' && npm run build:linux:internal"`, { stdio: 'inherit' });
    console.log('\n✓ Build completed successfully!');
    console.log(`AppImage should be in: ${distDir}`);
  } catch (error) {
    console.error('\n✗ Build failed!');
    process.exit(1);
  }
}

// Build using Docker
function buildWithDocker() {
  console.log('Using Docker for Linux build...\n');
  
  // Create a temporary Dockerfile for building
  const dockerfileContent = `FROM node:20-slim

# Install build dependencies for AppImage and native modules
RUN apt-get update && apt-get install -y \\
    g++ \\
    make \\
    python3 \\
    libnss3 \\
    libatk-bridge2.0-0 \\
    libdrm2 \\
    libxkbcommon0 \\
    libxcomposite1 \\
    libxdamage1 \\
    libxfixes3 \\
    libxrandr2 \\
    libgbm1 \\
    libasound2 \\
    libpango-1.0-0 \\
    libatk1.0-0 \\
    libcairo-gobject2 \\
    libgtk-3-0 \\
    libgdk-pixbuf2.0-0 \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Configure npm for better network reliability
RUN npm config set fetch-retries 5 && \\
    npm config set fetch-retry-mintimeout 20000 && \\
    npm config set fetch-retry-maxtimeout 120000 && \\
    npm config set fetch-timeout 300000

# Copy package files and scripts (needed for postinstall hook)
COPY package*.json ./
COPY scripts/ ./scripts/

# Install dependencies with retry logic
RUN npm install --loglevel=error || \\
    (sleep 5 && npm install --loglevel=error) || \\
    (sleep 10 && npm install --loglevel=error) && \\
    npm cache clean --force

# Clean any existing native module builds to ensure fresh rebuild
RUN rm -rf node_modules/better-sqlite3/build || true

# Explicitly rebuild native modules for Electron on Linux
# Use @electron/rebuild which is more reliable
RUN npx @electron/rebuild --version=$(node -p 'require("electron/package.json").version') || npx electron-builder install-app-deps

# Copy application files
COPY . .

# Build AppImage
RUN npm run build:linux:internal

# The output will be in /app/dist
`;

  const dockerfilePath = path.join(projectRoot, 'Dockerfile.build-linux');
  fs.writeFileSync(dockerfilePath, dockerfileContent);
  
  console.log('Building Docker image for Linux build...');
  try {
    execSync(`docker build -f "${dockerfilePath}" -t printventory-linux-builder "${projectRoot}"`, { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to build Docker image');
    fs.unlinkSync(dockerfilePath);
    process.exit(1);
  }
  
  console.log('\nRunning build in Docker container...');
  const containerName = `printventory-linux-builder-${Date.now()}`;
  
  try {
    // Run the build
    execSync(`docker run --name "${containerName}" printventory-linux-builder`, { stdio: 'inherit' });
    
    // Create dist directory if it doesn't exist
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }
    
    // Copy the AppImage from container
    console.log('\nCopying AppImage from container...');
    const tempDist = path.join(projectRoot, 'dist-temp');
    if (fs.existsSync(tempDist)) {
      fs.rmSync(tempDist, { recursive: true, force: true });
    }
    execSync(`docker cp "${containerName}:/app/dist" "${tempDist}"`, { stdio: 'inherit' });
    
    // Merge contents into actual dist directory
    if (fs.existsSync(distDir)) {
      const files = fs.readdirSync(tempDist);
      files.forEach(file => {
        const src = path.join(tempDist, file);
        const dest = path.join(distDir, file);
        try {
          if (fs.statSync(src).isDirectory()) {
            if (fs.existsSync(dest)) {
              fs.rmSync(dest, { recursive: true, force: true });
            }
            fs.cpSync(src, dest, { recursive: true });
          } else {
            if (fs.existsSync(dest)) {
              fs.unlinkSync(dest);
            }
            fs.copyFileSync(src, dest);
          }
        } catch (err) {
          console.warn(`Warning: Could not copy ${file}: ${err.message}`);
        }
      });
      fs.rmSync(tempDist, { recursive: true, force: true });
    } else {
      // If dist doesn't exist, just rename the temp directory
      try {
        fs.renameSync(tempDist, distDir);
      } catch (err) {
        // Fallback: copy if rename fails (e.g., across drives)
        fs.cpSync(tempDist, distDir, { recursive: true });
        fs.rmSync(tempDist, { recursive: true, force: true });
      }
    }
    
    // Cleanup
    console.log('Cleaning up container...');
    execSync(`docker rm "${containerName}"`, { stdio: 'ignore' });
    fs.unlinkSync(dockerfilePath);
    
    console.log('\n✓ Build completed successfully!');
    console.log(`AppImage should be in: ${distDir}`);
  } catch (error) {
    console.error('\n✗ Build failed!');
    // Try to cleanup on error
    try {
      execSync(`docker rm "${containerName}"`, { stdio: 'ignore' });
    } catch (e) {}
    fs.unlinkSync(dockerfilePath);
    process.exit(1);
  }
}

// Main execution
function main() {
  if (checkDocker()) {
    buildWithDocker();
  } else if (checkWSL()) {
    buildWithWSL();
  } else {
    console.error('ERROR: Neither Docker nor WSL is available.');
    console.error('\nTo build Linux AppImage from Windows, you need one of:');
    console.error('1. Docker Desktop - Recommended');
    console.error('   Install: https://www.docker.com/products/docker-desktop');
    console.error('\n2. WSL (Windows Subsystem for Linux)');
    console.error('   Install: wsl --install');
    console.error('   Then install Node.js in WSL: sudo apt-get install nodejs npm');
    process.exit(1);
  }
}

main();

