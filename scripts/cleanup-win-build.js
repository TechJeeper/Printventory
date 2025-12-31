const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(distDir)) {
  console.log('dist directory does not exist');
  process.exit(0);
}

console.log('Cleaning up Windows build artifacts...');

const files = fs.readdirSync(distDir);
let cleaned = 0;

files.forEach(file => {
  const filePath = path.join(distDir, file);
  const stat = fs.statSync(filePath);
  
  // Remove blockmap files, win-unpacked directory, intermediate build files, and builder config files
  if (file.endsWith('.blockmap') || 
      file === 'win-unpacked' || 
      file.endsWith('.nsis.7z') ||
      file.startsWith('builder-')) {
    try {
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
      console.log(`Removed: ${file}`);
      cleaned++;
    } catch (error) {
      console.error(`Error removing ${file}:`, error.message);
    }
  }
});

console.log(`Cleanup complete. Removed ${cleaned} item(s).`);


