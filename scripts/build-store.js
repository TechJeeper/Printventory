/**
 * Unsigned Microsoft Store package (.appx) and bundle (.msixbundle).
 * Partner Center signs the upload. Before submitting, set the identity from
 * Partner Center → Product identity:
 *   APPX_PUBLISHER=CN=...  APPX_IDENTITY_NAME=...  npm run build:store
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

if (process.platform === 'win32') {
  const cacheResult = spawnSync(process.execPath, [path.join(__dirname, 'ensure-win-codesign-cache.js')], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (cacheResult.status !== 0) {
    process.exit(cacheResult.status ?? 1);
  }
}

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const stagingName = `store-staging-${Date.now()}`;
const stagingAbs = path.join(distDir, stagingName);
fs.mkdirSync(stagingAbs, { recursive: true });

const outputRel = path.join('dist', stagingName).replace(/\\/g, '/');
const args = [
  'electron-builder',
  '--win',
  'appx',
  '--x64',
  `--config.directories.output=${outputRel}`,
];

const overlay = { appx: {} };
if (process.env.APPX_PUBLISHER) overlay.appx.publisher = process.env.APPX_PUBLISHER;
if (process.env.APPX_IDENTITY_NAME) overlay.appx.identityName = process.env.APPX_IDENTITY_NAME;
if (process.env.APPX_PUBLISHER_DISPLAY_NAME) {
  overlay.appx.publisherDisplayName = process.env.APPX_PUBLISHER_DISPLAY_NAME;
}
if (Object.keys(overlay.appx).length > 0) {
  const overlayPath = path.join(stagingAbs, 'appx-overlay.json');
  fs.writeFileSync(overlayPath, JSON.stringify(overlay));
  args.push(`--config=${overlayPath}`);
}

const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
for (const key of ['WIN_CSC_LINK', 'CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'CSC_KEY_PASSWORD']) {
  delete env[key];
}

console.log('Building unsigned AppX for the Microsoft Store (x64)...');
const eb = spawnSync('npx', args, { cwd: projectRoot, stdio: 'inherit', shell: true, env });
if (eb.error) {
  console.error(eb.error);
  process.exit(1);
}
if (eb.status !== 0 && eb.status != null) {
  process.exit(eb.status);
}

const appxName = fs.readdirSync(stagingAbs).find((name) => name.endsWith('.appx'));
if (!appxName) {
  console.error('No .appx found in', stagingAbs);
  process.exit(1);
}

const appxSrc = path.join(stagingAbs, appxName);
const appxDest = path.join(distDir, appxName);
fs.copyFileSync(appxSrc, appxDest);
console.log('Copied package to dist:', appxName);

const bundleName = `Printventory-${pkg.version}.msixbundle`;
const bundleDest = path.join(distDir, bundleName);
const makeappx = findMakeAppx();
if (!makeappx) {
  console.error('makeappx.exe was not found. The .appx is in dist, but the .msixbundle was not created.');
  process.exit(1);
}

const bundleInput = path.join(stagingAbs, 'bundle-input');
fs.mkdirSync(bundleInput, { recursive: true });
fs.copyFileSync(appxSrc, path.join(bundleInput, appxName));

console.log('Packing', bundleName);
const bundled = spawnSync(makeappx, ['bundle', '/o', '/d', bundleInput, '/p', bundleDest], {
  stdio: 'inherit',
});
if (bundled.status !== 0) {
  process.exit(bundled.status ?? 1);
}

try {
  fs.rmSync(stagingAbs, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
} catch {
  console.warn('Could not remove staging folder (non-fatal):', stagingName);
}

console.log('Microsoft Store bundle:', bundleDest);

function findMakeAppx() {
  const roots = [
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache', 'winCodeSign'),
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
  ];
  for (const root of roots) {
    const found = walkForMakeAppx(root, 0);
    if (found) return found;
  }
  return null;
}

function walkForMakeAppx(dir, depth) {
  if (!dir || depth > 6 || !fs.existsSync(dir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'makeappx.exe') return full;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = walkForMakeAppx(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}
