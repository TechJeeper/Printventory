/**
 * macOS universal DMG build. Cleans better-sqlite3 native artifacts first so
 * electron-builder can rebuild per-arch without EACCES on .forge-meta (often
 * caused by root-owned or read-only files from sudo npm or a stale Desktop copy).
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const sqliteDir = path.join(projectRoot, 'node_modules', 'better-sqlite3');
const sqliteBuildDir = path.join(sqliteDir, 'build');

function cleanBetterSqliteBuild() {
  if (!fs.existsSync(sqliteBuildDir)) {
    return;
  }
  console.log('Cleaning better-sqlite3 native build artifacts...');
  fs.rmSync(sqliteBuildDir, { recursive: true, force: true });
}

function ensureWritableNativeModules() {
  if (process.platform === 'win32' || !fs.existsSync(sqliteDir)) {
    return;
  }
  try {
    execSync(`chmod -R u+w "${sqliteDir}"`, { stdio: 'ignore' });
  } catch (_) {
    /* best effort */
  }
}

function warnIfNativeModulesNotWritable() {
  if (process.platform === 'win32' || !fs.existsSync(sqliteDir)) {
    return;
  }
  try {
    fs.accessSync(sqliteDir, fs.constants.W_OK);
  } catch (_) {
    console.warn('');
    console.warn('Warning: node_modules/better-sqlite3 is not writable.');
    console.warn('Fix ownership on the Mac, then retry:');
    console.warn('  sudo chown -R "$(whoami)" .');
    console.warn('  chmod -R u+w node_modules/better-sqlite3');
    console.warn('Avoid running npm install with sudo.');
    console.warn('');
  }
}

console.log('Building macOS universal app...\n');

cleanBetterSqliteBuild();
ensureWritableNativeModules();
warnIfNativeModulesNotWritable();

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-builder', '--mac', '--universal'],
  { cwd: projectRoot, stdio: 'inherit', shell: false }
);

process.exit(result.status ?? 1);
