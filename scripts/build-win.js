/**
 * Windows NSIS build into a fresh dist/win-staging-<timestamp> folder, then promote the
 * installer to dist/. Avoids EPERM when dist/win-unpacked is locked by another process.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

if (process.platform === 'win32') {
  const cacheResult = spawnSync(process.execPath, [path.join(__dirname, 'ensure-win-codesign-cache.js')], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (cacheResult.status !== 0) {
    process.exit(cacheResult.status ?? 1);
  }
}

function tryRemoveQuiet(p) {
  if (!fs.existsSync(p)) return;
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  } catch (_) {
    /* locked — build still works via staging */
  }
}

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const staleUnpacked = path.join(distDir, 'win-unpacked');
if (fs.existsSync(staleUnpacked)) {
  try {
    fs.rmSync(staleUnpacked, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    console.log('Removed dist\\win-unpacked');
  } catch (_) {
    console.warn(
      'dist\\win-unpacked is locked; skipping delete. Building to a new staging folder under dist\\.'
    );
  }
}

const stagingName = `win-staging-${Date.now()}`;
const stagingAbs = path.join(distDir, stagingName);
fs.mkdirSync(stagingAbs, { recursive: true });

const outputRel = path.join('dist', stagingName).replace(/\\/g, '/');
const configOutput = `--config.directories.output=${outputRel}`;

const eb = spawnSync(
  'npx',
  ['electron-builder', '-w', '--config.nsis.differentialPackage=false', configOutput],
  { cwd: projectRoot, stdio: 'inherit', shell: true, env: process.env }
);

if (eb.error) {
  console.error(eb.error);
  process.exit(1);
}
if (eb.status !== 0 && eb.status != null) {
  process.exit(eb.status);
}

let promoted = 0;
if (fs.existsSync(stagingAbs)) {
  for (const name of fs.readdirSync(stagingAbs)) {
    if (name.startsWith('Printventory-Setup') && name.endsWith('.exe')) {
      const src = path.join(stagingAbs, name);
      const dest = path.join(distDir, name);
      fs.copyFileSync(src, dest);
      console.log('Copied installer to dist:', name);
      promoted++;
    }
  }
}

if (promoted === 0) {
  console.warn('No Printventory-Setup*.exe found in staging; check', stagingAbs);
}

tryRemoveQuiet(stagingAbs);
if (fs.existsSync(stagingAbs)) {
  console.warn('Could not remove staging folder (non-fatal):', stagingName);
}

spawnSync(process.execPath, [path.join(__dirname, 'cleanup-win-build.js')], {
  cwd: projectRoot,
  stdio: 'inherit',
});
