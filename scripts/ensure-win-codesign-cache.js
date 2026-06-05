/**
 * Pre-populate electron-builder winCodeSign cache from the GitHub source zip.
 * The default .7z download contains macOS symlinks that fail to extract on Windows
 * without Administrator or Developer Mode. Once this folder exists, electron-builder
 * skips the download entirely.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CACHE_VERSION = 'winCodeSign-2.6.0';
const ZIP_URL =
  'https://github.com/electron-userland/electron-builder-binaries/archive/refs/tags/winCodeSign-2.6.0.zip';

function cacheIsReady(cacheRoot) {
  if (!fs.existsSync(cacheRoot)) return false;
  return fs.existsSync(path.join(cacheRoot, 'rcedit-x64.exe'));
}

function runPowerShell(script) {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { stdio: 'inherit' }
  );
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  if (process.platform !== 'win32') {
    return;
  }

  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cacheRoot = path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign', CACHE_VERSION);

  if (cacheIsReady(cacheRoot)) {
    console.log('winCodeSign cache ready:', cacheRoot);
    return;
  }

  console.log('Pre-populating winCodeSign cache (avoids Windows symlink extraction error)...');

  const tempRoot = path.join(os.tmpdir(), `winCodeSign-cache-${Date.now()}`);
  const zipPath = path.join(tempRoot, 'winCodeSign.zip');
  const extractDir = path.join(tempRoot, 'extract');
  const archiveRoot = path.join(extractDir, 'electron-builder-binaries-winCodeSign-2.6.0', 'winCodeSign');

  fs.mkdirSync(tempRoot, { recursive: true });

  const ps = [
    `$ErrorActionPreference = 'Stop'`,
    `New-Item -ItemType Directory -Force -Path '${extractDir.replace(/'/g, "''")}' | Out-Null`,
    `Invoke-WebRequest -Uri '${ZIP_URL}' -OutFile '${zipPath.replace(/'/g, "''")}'`,
    `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
    `if (-not (Test-Path '${archiveRoot.replace(/'/g, "''")}')) { throw "Unexpected archive layout: ${archiveRoot.replace(/'/g, "''")}" }`,
    `New-Item -ItemType Directory -Force -Path '${cacheRoot.replace(/'/g, "''")}' | Out-Null`,
    `Copy-Item -Path '${archiveRoot.replace(/'/g, "''")}\\*' -Destination '${cacheRoot.replace(/'/g, "''")}' -Recurse -Force`,
  ].join('; ');

  try {
    runPowerShell(ps);
    if (!cacheIsReady(cacheRoot)) {
      console.error('winCodeSign cache population failed:', cacheRoot);
      process.exit(1);
    }
    console.log('winCodeSign cache populated:', cacheRoot);
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* non-fatal */
    }
  }
}

main();
