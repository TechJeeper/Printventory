#!/usr/bin/env node
// Cross-platform script to create Docker distribution package for Printventory

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version;

const distDir = 'dist';
const dockerDistDir = path.join(distDir, `printventory-docker-${version}`);
const dockerDistZip = path.join(distDir, `printventory-docker-${version}.zip`);

console.log(`Creating Docker distribution for Printventory ${version}...`);

// Create distribution directory
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}
if (fs.existsSync(dockerDistDir)) {
  fs.rmSync(dockerDistDir, { recursive: true, force: true });
}
fs.mkdirSync(dockerDistDir, { recursive: true });

// Files to copy
const filesToCopy = [
  'Dockerfile',
  'docker-compose.yml',
  'docker-entrypoint.sh',
  '.dockerignore',
  'package.json',
  'package-lock.json',
  'main.js',
  'preload.js',
  'renderer.js',
  'index.html',
  'favicon.ico',
  'styles.css',
  'preview-wall.css',
  'thumbnail-progress.css',
  'thumbnail-progress.js',
  'server-bridge.js',
  'scan-worker.js',
  'parse-worker.js',
  'preview-3mf-worker-node.js',
  'threemf-loader-simple.js',
  'threemf-mesh-extract.js',
  'preview.js',
  'query-builder.js',
  'aitagging.js',
  'thumbnail-compress.js',
  'slicer.js',
  'guide.js',
  'search.js'
];

// Copy files
console.log('Copying files...');
const missingFiles = filesToCopy.filter((file) => !fs.existsSync(file));
if (missingFiles.length) {
  console.error('Missing required files for Docker distribution:');
  missingFiles.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}
filesToCopy.forEach((file) => {
  fs.copyFileSync(file, path.join(dockerDistDir, file));
});

// Copy assets
console.log('Copying assets...');
['*.png', '*.jpg', '*.bmp'].forEach(pattern => {
  try {
    const files = fs.readdirSync('.').filter(f => f.match(new RegExp(pattern.replace('*', '.*'))));
    files.forEach(file => {
      fs.copyFileSync(file, path.join(dockerDistDir, file));
    });
  } catch (err) {
    // Ignore errors
  }
});

// Copy guide directory
if (fs.existsSync('guide')) {
  console.log('Copying guide directory...');
  fs.cpSync('guide', path.join(dockerDistDir, 'guide'), { recursive: true });
}

// Copy vendor (3D loaders, parse-worker importScripts)
if (fs.existsSync('vendor')) {
  console.log('Copying vendor directory...');
  fs.cpSync('vendor', path.join(dockerDistDir, 'vendor'), { recursive: true });
}

// Create README
const readmeContent = `# Printventory Docker Distribution

This package contains everything needed to run Printventory in server mode using Docker.

## Quick Start

1. **Extract this archive:**
   \`\`\`bash
   unzip printventory-docker-*.zip
   cd printventory-docker-*
   \`\`\`

2. **Build and run with Docker Compose:**
   \`\`\`bash
   docker-compose up -d
   \`\`\`

3. **Access the server:**
   Open your browser to: http://localhost:5000 (or https:// if you enable TLS — see docker-compose comments)

## HTTPS in Docker (optional)

Set \`PRINTVENTORY_TLS_CERT\` and \`PRINTVENTORY_TLS_KEY\` to PEM file paths inside the container (mount a volume for your certs). The app serves HTTPS on the same port; the browser bridge uses \`wss://\` automatically.

If you use a reverse proxy for HTTPS instead, do **not** set these — keep the container on HTTP and configure **WebSocket upgrade** on the proxy so \`wss://\` reaches port 5000.

## Alternative: Build and Run Manually

\`\`\`bash
# Build the image
docker build -t printventory:latest .

# Run the container
docker run -d \\
  --name printventory-server \\
  -p 5000:5000 \\
  -v printventory-data:/root/.config/Printventory \\
  --restart unless-stopped \\
  printventory:latest
\`\`\`

## Network Shares

To access network shares, mount them into the container. See the main README.md for detailed instructions.

## Documentation

For complete documentation, see:
- Main README.md (included in full distribution)
- Docker section in application Help > Server Mode Info

## Support

For issues or questions, please refer to the main project repository.
`;

fs.writeFileSync(path.join(dockerDistDir, 'README.md'), readmeContent);

// Create zip archive
console.log('Creating zip archive...');
try {
  // Try using native zip command (Unix) or PowerShell (Windows)
  if (process.platform === 'win32') {
    // Use PowerShell Compress-Archive
    if (fs.existsSync(dockerDistZip)) {
      fs.unlinkSync(dockerDistZip);
    }
    execSync(`powershell -Command "Compress-Archive -Path '${dockerDistDir}\\*' -DestinationPath '${dockerDistZip}' -Force"`, { stdio: 'inherit' });
  } else {
    // Use zip command
    execSync(`cd ${dockerDistDir} && zip -r ../printventory-docker-${version}.zip .`, { stdio: 'inherit' });
  }
} catch (err) {
  console.error('Error creating zip archive:', err.message);
  console.log('Files are ready in:', dockerDistDir);
  console.log('Please create the zip archive manually.');
  process.exit(1);
}

const stats = fs.statSync(dockerDistZip);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('');
console.log('✓ Docker distribution created successfully!');
console.log(`  Location: ${dockerDistZip}`);
console.log(`  Size: ${sizeMB} MB`);
console.log('');
console.log('To distribute:');
console.log(`  1. Upload ${path.basename(dockerDistZip)} to your release page`);
console.log('  2. Users can extract and run: docker-compose up -d');






