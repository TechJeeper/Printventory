const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = path.join(__dirname, '..');
const DEFAULT_LARGE_IMAGE_PATH = 'C:\\Users\\cld\\Downloads\\10mb-example-jpg.jpg';
const DB_SCRIPT = path.join(__dirname, 'scripts', 'thumbnail-perf-db.js');
const ELECTRON_BIN = path.join(
  APP_ROOT,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
);

function getDbPath() {
  return path.join(APP_ROOT, 'printventory.db');
}

function runDbScript(mode, imagePath = DEFAULT_LARGE_IMAGE_PATH) {
  const args = [DB_SCRIPT, mode];
  if (mode !== 'clear') args.push(imagePath);

  const env = { ...process.env };
  if (mode === 'clear') {
    env.ELECTRON_RUN_AS_NODE = '1';
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ATOM_SHELL_INTERNAL_RUN_AS_NODE;
  }

  const result = spawnSync(ELECTRON_BIN, args, {
    cwd: __dirname,
    encoding: 'utf8',
    env,
    maxBuffer: 256 * 1024 * 1024,
    timeout: 600000
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `thumbnail-perf-db ${mode} failed (exit ${result.status}): ${result.stderr || result.stdout}`
    );
  }

  const line = (result.stdout || '').trim().split('\n').pop();
  return JSON.parse(line);
}

function loadImageAsDataUrl(imagePath = DEFAULT_LARGE_IMAGE_PATH) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Large test image not found: ${imagePath}`);
  }
  const buf = fs.readFileSync(imagePath);
  const base64 = buf.toString('base64');
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

function clearAllThumbnails() {
  return runDbScript('clear');
}

function setSingleThumbnailPerModel(imagePath = DEFAULT_LARGE_IMAGE_PATH) {
  return runDbScript('single', imagePath);
}

function setTripleThumbnailPerModel(imagePath = DEFAULT_LARGE_IMAGE_PATH) {
  return runDbScript('triple', imagePath);
}

function getDbFileSize(dbPath = getDbPath()) {
  try {
    return fs.statSync(dbPath).size;
  } catch {
    return 0;
  }
}

function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return 'n/a';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return 'n/a';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

module.exports = {
  DEFAULT_LARGE_IMAGE_PATH,
  getDbPath,
  loadImageAsDataUrl,
  clearAllThumbnails,
  setSingleThumbnailPerModel,
  setTripleThumbnailPerModel,
  getDbFileSize,
  formatMs,
  formatBytes
};
