/**
 * Startup STL Home scans only. The test never calls scanDirectory.
 * Desktop: fresh app launch with STL_HOME / STL_HOME_EXCLUDE already set.
 * Docker: container start; the server window scans, the browser only reads the library.
 *
 *   node tests/stl-home-startup-matrix.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { _electron: electron, chromium } = require('@playwright/test');
const { getTestEnv, acceptTerms, dismissOnboarding } = require('./test-utils');
const { toPosix, dismissUiChrome, waitForAppReady, docker, waitForHttp, sleep } = require('./perf-enhancements-helpers');

const APP_ROOT = path.join(__dirname, '..');
const WORK = path.join(__dirname, 'test-user-data', 'stl-home-startup');
const FILES = path.join(WORK, 'files');
const CUBE = path.join(__dirname, 'test-fixtures', 'scan-me', 'cube.stl');
const CONTAINER = 'printventory-stl-home-startup';
const HOST_PORT = '15022';
const IMAGE = 'printventory/printventory:latest';
const MOUNT = '/mnt/homes';

const HOME_A = 'home-a';
const HOME_B = 'home-b';
const KEEP_A = 'keep-a.stl';
const VISIBLE_A = 'visible-a.stl';
const SKIP_A_ONE = 'skip-a-one.stl';
const SKIP_A_TWO = 'skip-a-two.stl';
const KEEP_B = 'keep-b.stl';
const VISIBLE_B = 'visible-b.stl';
const SKIP_B_ONE = 'skip-b-one.stl';
const SKIP_B_TWO = 'skip-b-two.stl';

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n  ' + detail : ''}`);
}

function seedFiles() {
  const layout = [
    [HOME_A, KEEP_A],
    [HOME_A, 'nested', VISIBLE_A],
    [HOME_A, 'skip-one', SKIP_A_ONE],
    [HOME_A, 'skip-two', SKIP_A_TWO],
    [HOME_B, KEEP_B],
    [HOME_B, 'nested', VISIBLE_B],
    [HOME_B, 'skip-one', SKIP_B_ONE],
    [HOME_B, 'skip-two', SKIP_B_TWO]
  ];
  fs.rmSync(FILES, { recursive: true, force: true });
  for (const parts of layout) {
    const dest = path.join(FILES, ...parts);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(CUBE, dest);
  }
}

function hostHome(name) {
  return path.join(FILES, name);
}

function dockerHome(name) {
  return `${MOUNT}/${name}`;
}

async function libraryNames(page) {
  return page.evaluate(async () => {
    const models = await window.electron.getAllModels('name-asc', 0);
    return (Array.isArray(models) ? models : []).map((model) => model.fileName);
  });
}

async function waitForStartupLibrary(page, present, absent, timeoutMs) {
  const start = Date.now();
  let last = [];
  while (Date.now() - start < timeoutMs) {
    last = await libraryNames(page);
    const set = new Set(last);
    const leaked = absent.filter((name) => set.has(name));
    if (leaked.length) {
      throw new Error(`startup indexed excluded files: ${leaked.join(', ')} (library: ${last.join(', ') || 'empty'})`);
    }
    if (present.every((name) => set.has(name))) {
      await sleep(3000);
      last = await libraryNames(page);
      const later = new Set(last);
      const leakedLater = absent.filter((name) => later.has(name));
      if (leakedLater.length) {
        throw new Error(`excluded files appeared after startup scan: ${leakedLater.join(', ')}`);
      }
      if (!present.every((name) => later.has(name))) {
        throw new Error(`startup library lost expected files: ${last.join(', ')}`);
      }
      return last;
    }
    await sleep(2000);
  }
  throw new Error(`startup scan did not index [${present.join(', ')}] within ${timeoutMs}ms (library: ${last.join(', ') || 'empty'})`);
}

async function runDesktop(label, stlHome, stlExclude, present, absent) {
  const id = label.replace(/\s+/g, '-');
  const dbPath = path.join(WORK, id + '.db');
  const profile = path.join(WORK, id + '-profile');
  fs.rmSync(profile, { recursive: true, force: true });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
  }
  fs.mkdirSync(profile, { recursive: true });

  const logs = [];
  const app = await electron.launch({
    args: [APP_ROOT, `--user-data-dir=${profile}`],
    env: getTestEnv({
      PRINTVENTORY_DB_PATH: dbPath,
      PRINTVENTORY_TEST_SCAN_PATH: FILES,
      STL_HOME: stlHome,
      STL_HOME_EXCLUDE: stlExclude
    }),
    cwd: APP_ROOT
  });
  try {
    const window = await app.firstWindow();
    window.on('console', (msg) => {
      const text = msg.text();
      if (/STL Home|Background scan|Performing STL Home scan|scan-directory/i.test(text)) logs.push(text);
    });
    await window.waitForLoadState('domcontentloaded');
    await acceptTerms(window);
    await dismissOnboarding(window);
    const names = await waitForStartupLibrary(window, present, absent, 120000);
    const startupLog = logs.find((line) => line.includes('STL Home scan in background'));
    if (!startupLog) {
      throw new Error('library filled without the startup scan log. logs:\n' + logs.join('\n'));
    }
    if (!stlHome.split(',').every((dir) => startupLog.includes(dir))) {
      throw new Error('startup log did not list every STL Home: ' + startupLog);
    }
    record(label, true, `${startupLog}\n  library: ${names.join(', ')}`);
  } finally {
    await app.close();
  }
}

function startContainer(dataDir, stlHome, stlExclude) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  try { docker(`docker rm -f ${CONTAINER}`); } catch (_) {}
  const args = [
    'run', '-d', '--name', CONTAINER,
    '-p', `${HOST_PORT}:5000`,
    '--memory=2g',
    '-e', `STL_HOME=${stlHome}`,
    '-e', `STL_HOME_EXCLUDE=${stlExclude}`,
    '-e', `PRINTVENTORY_TEST_SCAN_PATH=${MOUNT}`,
    '-e', 'ELECTRON_ENABLE_LOGGING=1',
    '-v', `${toPosix(dataDir)}:/root/.config/printventory`,
    '-v', `${toPosix(FILES)}:${MOUNT}`,
    '-v', `${toPosix(path.join(APP_ROOT, 'main.js'))}:/app/main.js:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'renderer.js'))}:/app/renderer.js:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'index.html'))}:/app/index.html:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'styles.css'))}:/app/styles.css:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'scan-worker.js'))}:/app/scan-worker.js:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'scan-skip.js'))}:/app/scan-skip.js:ro`,
    IMAGE
  ];
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`docker run failed: ${result.stderr || result.stdout}`);
  }
}

async function runDocker(label, stlHome, stlExclude, present, absent) {
  const dataDir = path.join(WORK, 'docker-' + label.replace(/\s+/g, '-'));
  startContainer(dataDir, stlHome, stlExclude);
  const base = `http://127.0.0.1:${HOST_PORT}`;
  await waitForHttp(base, 120000);
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.__scanCalls = [];
      const timer = setInterval(() => {
        if (!window.electron || typeof window.electron.scanDirectory !== 'function') return;
        if (window.electron.scanDirectory.__wrapped) return;
        const orig = window.electron.scanDirectory.bind(window.electron);
        const wrapped = function (dir, options) {
          window.__scanCalls.push(String(dir || ''));
          return orig(dir, options);
        };
        wrapped.__wrapped = true;
        window.electron.scanDirectory = wrapped;
      }, 5);
      setTimeout(() => clearInterval(timer), 30000);
    });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissUiChrome(page);
    await waitForAppReady(page);
    const names = await waitForStartupLibrary(page, present, absent, 150000);
    const scanCalls = await page.evaluate(() => window.__scanCalls || []);
    if (scanCalls.length) {
      throw new Error('browser called scanDirectory during startup check: ' + scanCalls.join(', '));
    }
    const logged = spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' });
    const serverLog = `${logged.stdout || ''}\n${logged.stderr || ''}`;
    const interesting = serverLog.split(/\r?\n/).filter((line) => /STL Home|Performing STL Home scan|stlHomeDirectories/i.test(line));
    record(label, true, `browser scanDirectory calls: 0\n  library: ${names.join(', ')}\n  server log:\n  ${interesting.slice(-12).join('\n  ') || '(no STL Home lines in container log)'}`);
  } finally {
    await browser.close();
    try { docker(`docker rm -f ${CONTAINER}`); } catch (_) {}
  }
}

async function main() {
  if (!fs.existsSync(CUBE)) throw new Error('Missing fixture ' + CUBE);
  seedFiles();
  const homeA = hostHome(HOME_A);
  const homeB = hostHome(HOME_B);
  const excludeA = path.join(homeA, 'skip-one');
  const excludeB = path.join(homeB, 'skip-two');

  try {
    await runDesktop(
      'desktop startup single STL Home + single exclude',
      homeA,
      excludeA,
      [KEEP_A, VISIBLE_A, SKIP_A_TWO],
      [SKIP_A_ONE, KEEP_B, SKIP_B_ONE, SKIP_B_TWO]
    );
  } catch (error) {
    record('desktop startup single STL Home + single exclude', false, error.stack || error.message);
  }

  try {
    await runDesktop(
      'desktop startup multiple STL Homes + multiple excludes',
      `${homeA},${homeB}`,
      `${excludeA},${excludeB}`,
      [KEEP_A, VISIBLE_A, SKIP_A_TWO, KEEP_B, VISIBLE_B, SKIP_B_ONE],
      [SKIP_A_ONE, SKIP_B_TWO]
    );
  } catch (error) {
    record('desktop startup multiple STL Homes + multiple excludes', false, error.stack || error.message);
  }

  const dHomeA = dockerHome(HOME_A);
  const dHomeB = dockerHome(HOME_B);
  const dExcludeA = `${dHomeA}/skip-one`;
  const dExcludeB = `${dHomeB}/skip-two`;

  try {
    await runDocker(
      'docker startup single STL Home + single exclude',
      dHomeA,
      dExcludeA,
      [KEEP_A, VISIBLE_A, SKIP_A_TWO],
      [SKIP_A_ONE, KEEP_B]
    );
  } catch (error) {
    record('docker startup single STL Home + single exclude', false, error.stack || error.message);
    try { console.error(docker(`docker logs ${CONTAINER} --tail 80`)); } catch (_) {}
    try { docker(`docker rm -f ${CONTAINER}`); } catch (_) {}
  }

  try {
    await runDocker(
      'docker startup multiple STL Homes + multiple excludes',
      `${dHomeA},${dHomeB}`,
      `${dExcludeA},${dExcludeB}`,
      [KEEP_A, VISIBLE_A, SKIP_A_TWO, KEEP_B, VISIBLE_B, SKIP_B_ONE],
      [SKIP_A_ONE, SKIP_B_TWO]
    );
  } catch (error) {
    record('docker startup multiple STL Homes + multiple excludes', false, error.stack || error.message);
    try { console.error(docker(`docker logs ${CONTAINER} --tail 80`)); } catch (_) {}
    try { docker(`docker rm -f ${CONTAINER}`); } catch (_) {}
  }

  const failed = results.filter((item) => !item.ok);
  console.log('\n==============================');
  console.log(failed.length ? `${failed.length} FAILED` : `ALL PASSED (${results.length})`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  try { docker(`docker rm -f ${CONTAINER}`); } catch (_) {}
  process.exit(1);
});
