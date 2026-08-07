/**
 * Smoke-test a packaged Printventory binary: window must appear quickly,
 * main UI must load, Chart (vendored) must be present.
 *
 * Usage:
 *   node tests/smoke-packaged-launch.js [path-to-Printventory.exe-or-.app]
 * Env:
 *   PRINTVENTORY_EXE — override executable / .app path
 *   SMOKE_USER_DATA  — optional user-data dir (default: tests/smoke-user-data)
 */
const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

const APP_ROOT = path.join(__dirname, '..');
const DEFAULT_WIN =
  process.env.PRINTVENTORY_EXE ||
  'C:\\Program Files\\Printventory\\Printventory.exe';
const DEFAULT_MAC =
  process.env.PRINTVENTORY_EXE ||
  '/Applications/Printventory.app/Contents/MacOS/Printventory';

const exePath = process.argv[2] || (process.platform === 'darwin' ? DEFAULT_MAC : DEFAULT_WIN);
const userDataDir =
  process.env.SMOKE_USER_DATA || path.join(__dirname, 'smoke-user-data');

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

async function main() {
  if (!fs.existsSync(exePath) && !fs.existsSync(exePath.replace(/\.exe$/i, ''))) {
    // On macOS executablePath can be the .app bundle
    const asApp = exePath.endsWith('.app') ? exePath : null;
    if (!asApp || !fs.existsSync(asApp)) {
      console.error('FAIL: executable not found:', exePath);
      process.exit(2);
    }
  }

  rmrf(userDataDir);
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log('Launching:', exePath);
  console.log('User data:', userDataDir);

  const t0 = Date.now();
  const app = await electron.launch({
    executablePath: exePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
    },
    timeout: 60000,
  });

  // Window must appear within 8s (force-show is 3s; allow margin)
  const window = await Promise.race([
    app.firstWindow(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('No window within 8000ms')), 8000)
    ),
  ]);
  const appearMs = Date.now() - t0;
  console.log(`Window appeared in ${appearMs}ms`);

  const title = await window.title();
  console.log('Title:', title);

  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });

  // Vendored Chart.js must load without CDN
  const chartOk = await window.evaluate(() => typeof Chart !== 'undefined');
  if (!chartOk) {
    console.error('FAIL: Chart global missing (vendored chart.js did not load)');
    await app.close().catch(() => {});
    process.exit(1);
  }
  console.log('Chart.js: OK (local vendor)');

  // Sidebar / scan button = main UI painted
  await window.waitForSelector('#scan-directory-button, #logo, .sidebar', {
    timeout: 20000,
  });
  console.log('Main UI: OK');

  await app.close();
  console.log(`PASS (${Date.now() - t0}ms total)`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
