/**
 * STL Home + excluded directories: single and multiple, desktop and Docker.
 *
 *   node tests/stl-home-exclude-matrix.js
 *
 * Desktop uses an isolated database. Docker starts throwaway containers on
 * port 15021 with the current main/renderer/scan files bind-mounted.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { _electron: electron, chromium } = require('@playwright/test');
const { getTestEnv, acceptTerms, dismissOnboarding } = require('./test-utils');
const { toPosix, dismissUiChrome, waitForAppReady, docker, waitForHttp, sleep } = require('./perf-enhancements-helpers');

const APP_ROOT = path.join(__dirname, '..');
const WORK = path.join(__dirname, 'test-user-data', 'stl-home-matrix');
const FILES = path.join(WORK, 'files');
const CUBE = path.join(__dirname, 'test-fixtures', 'scan-me', 'cube.stl');
const CONTAINER = 'printventory-stl-home-matrix';
const HOST_PORT = '15021';
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
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

function assertNames(label, actual, present, absent) {
  const set = new Set(actual);
  const problems = [];
  for (const name of present) {
    if (!set.has(name)) problems.push('missing ' + name);
  }
  for (const name of absent) {
    if (set.has(name)) problems.push('included excluded ' + name);
  }
  if (problems.length) {
    throw new Error(`${label}: ${problems.join('; ')} (got ${[...set].join(', ') || 'none'})`);
  }
}

async function scanNames(page, directory) {
  return page.evaluate(async (dir) => {
    const result = await window.electron.scanDirectory(dir, { isStlHomeScan: true });
    return (result && result.files ? result.files : []).map((file) => file.fileName);
  }, directory);
}

async function readDialogLists(page) {
  return page.evaluate(async () => {
    if (typeof window.openSTLHomeDialog !== 'function') {
      throw new Error('openSTLHomeDialog is not available');
    }
    await window.openSTLHomeDialog();
    const homes = document.getElementById('stl-home-directories-list')?.innerText || '';
    const excludes = document.getElementById('stl-home-exclude-list')?.innerText || '';
    document.getElementById('stl-home-dialog')?.close();
    return { homes, excludes };
  });
}

async function addPath(page, inputId, addId, value) {
  await page.locator(inputId).fill(value);
  await page.locator(addId).click();
}

async function runDesktop() {
  const dbPath = path.join(WORK, 'desktop.db');
  const profile = path.join(WORK, 'desktop-profile');
  fs.rmSync(profile, { recursive: true, force: true });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
  }
  fs.mkdirSync(profile, { recursive: true });

  const app = await electron.launch({
    args: [APP_ROOT, `--user-data-dir=${profile}`],
    env: getTestEnv({ PRINTVENTORY_DB_PATH: dbPath }),
    cwd: APP_ROOT
  });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await acceptTerms(window);
    await dismissOnboarding(window);
    await window.waitForFunction(() => typeof window.openSTLHomeDialog === 'function');

    const homeA = hostHome(HOME_A);
    const homeB = hostHome(HOME_B);
    const excludeA = path.join(homeA, 'skip-one');
    const excludeB = path.join(homeB, 'skip-two');

    await window.evaluate(() => window.openSTLHomeDialog());
    await addPath(window, '#stl-home-directories-input', '#stl-home-directories-add', homeA);
    await addPath(window, '#stl-home-exclude-input', '#stl-home-exclude-add', excludeA);
    await window.locator('#save-stl-home-button').click();
    await window.locator('#stl-home-dialog').waitFor({ state: 'hidden' });

    const singleLists = await readDialogLists(window);
    if (!singleLists.homes.includes(homeA) || singleLists.homes.includes(homeB)) {
      throw new Error('single home list: ' + singleLists.homes);
    }
    if (!singleLists.excludes.includes(excludeA) || singleLists.excludes.includes(excludeB)) {
      throw new Error('single exclude list: ' + singleLists.excludes);
    }
    const singleFiles = await scanNames(window, homeA);
    assertNames('desktop single', singleFiles,
      [KEEP_A, VISIBLE_A, SKIP_A_TWO],
      [SKIP_A_ONE, KEEP_B, SKIP_B_ONE, SKIP_B_TWO]);
    record('desktop single STL Home + single exclude', true, singleFiles.join(', '));

    await window.evaluate(() => window.openSTLHomeDialog());
    await addPath(window, '#stl-home-directories-input', '#stl-home-directories-add', homeB);
    await addPath(window, '#stl-home-exclude-input', '#stl-home-exclude-add', excludeB);
    await window.locator('#save-stl-home-button').click();
    await window.locator('#stl-home-dialog').waitFor({ state: 'hidden' });

    const multiLists = await readDialogLists(window);
    if (!multiLists.homes.includes(homeA) || !multiLists.homes.includes(homeB)) {
      throw new Error('multi home list: ' + multiLists.homes);
    }
    if (!multiLists.excludes.includes(excludeA) || !multiLists.excludes.includes(excludeB)) {
      throw new Error('multi exclude list: ' + multiLists.excludes);
    }
    const filesA = await scanNames(window, homeA);
    const filesB = await scanNames(window, homeB);
    assertNames('desktop multi home A', filesA,
      [KEEP_A, VISIBLE_A, SKIP_A_TWO],
      [SKIP_A_ONE]);
    assertNames('desktop multi home B', filesB,
      [KEEP_B, VISIBLE_B, SKIP_B_ONE],
      [SKIP_B_TWO]);
    record('desktop multiple STL Homes + multiple excludes', true, `A[${filesA.join(', ')}] B[${filesB.join(', ')}]`);
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
    '-e', 'PRINTVENTORY_ENV_OVERRIDES_SETTINGS=1',
    '-v', `${toPosix(dataDir)}:/root/.config/printventory`,
    '-v', `${toPosix(FILES)}:${MOUNT}`,
    '-v', `${toPosix(path.join(APP_ROOT, 'main.js'))}:/app/main.js:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'renderer.js'))}:/app/renderer.js:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'index.html'))}:/app/index.html:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'styles.css'))}:/app/styles.css:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'theme.css'))}:/app/theme.css:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'scan-worker.js'))}:/app/scan-worker.js:ro`,
    '-v', `${toPosix(path.join(APP_ROOT, 'scan-skip.js'))}:/app/scan-skip.js:ro`,
    IMAGE
  ];
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`docker run failed: ${result.stderr || result.stdout}`);
  }
}

async function runDockerCase(label, stlHome, stlExclude, checks) {
  const dataDir = path.join(WORK, 'docker-' + label.replace(/\s+/g, '-'));
  startContainer(dataDir, stlHome, stlExclude);
  const base = `http://127.0.0.1:${HOST_PORT}`;
  await waitForHttp(base, 120000);
  await sleep(2000);
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissUiChrome(page);
    await waitForAppReady(page);
    const settings = await page.evaluate(async () => ({
      homes: await window.electron.getSetting('stlHomeDirectories'),
      legacy: await window.electron.getSetting('stlHome'),
      excludes: await window.electron.getSetting('stlHomeExcludeDirectories')
    }));
    const homes = JSON.parse(settings.homes || '[]');
    const excludes = JSON.parse(settings.excludes || '[]');
    if (JSON.stringify(homes) !== JSON.stringify(checks.homes)) {
      throw new Error(`STL_HOME stored ${settings.homes}, legacy ${settings.legacy}`);
    }
    if (JSON.stringify(excludes) !== JSON.stringify(checks.excludes)) {
      throw new Error(`STL_HOME_EXCLUDE stored ${settings.excludes}`);
    }
    if (settings.legacy !== checks.homes[0]) {
      throw new Error(`stlHome legacy mirror ${settings.legacy}`);
    }
    const lists = await readDialogLists(page);
    for (const home of checks.homes) {
      if (!lists.homes.includes(home)) throw new Error('dialog missing home ' + home + ': ' + lists.homes);
    }
    for (const exclude of checks.excludes) {
      if (!lists.excludes.includes(exclude)) throw new Error('dialog missing exclude ' + exclude + ': ' + lists.excludes);
    }
    for (const scan of checks.scans) {
      const names = await scanNames(page, scan.dir);
      assertNames(label + ' ' + scan.dir, names, scan.present, scan.absent);
    }
    record(label, true, `homes=${homes.length} excludes=${excludes.length}`);
  } finally {
    await browser.close();
    try { docker(`docker rm -f ${CONTAINER}`); } catch (_) {}
  }
}

async function main() {
  if (!fs.existsSync(CUBE)) throw new Error('Missing fixture ' + CUBE);
  seedFiles();
  console.log('Fixtures:', FILES);

  try {
    await runDesktop();
  } catch (error) {
    record('desktop', false, error.stack || error.message);
  }

  const singleHome = dockerHome(HOME_A);
  const multiHome = `${dockerHome(HOME_A)},${dockerHome(HOME_B)}`;
  const singleExclude = `${dockerHome(HOME_A)}/skip-one`;
  const multiExclude = `${dockerHome(HOME_A)}/skip-one,${dockerHome(HOME_B)}/skip-two`;

  try {
    await runDockerCase('docker single STL Home + single exclude', singleHome, singleExclude, {
      homes: [singleHome],
      excludes: [singleExclude],
      scans: [{
        dir: singleHome,
        present: [KEEP_A, VISIBLE_A, SKIP_A_TWO],
        absent: [SKIP_A_ONE, KEEP_B]
      }]
    });
  } catch (error) {
    record('docker single STL Home + single exclude', false, error.stack || error.message);
    try { console.error(docker(`docker logs ${CONTAINER} --tail 60`)); } catch (_) {}
    try { docker(`docker rm -f ${CONTAINER}`); } catch (_) {}
  }

  try {
    await runDockerCase('docker multiple STL Homes + multiple excludes', multiHome, multiExclude, {
      homes: [dockerHome(HOME_A), dockerHome(HOME_B)],
      excludes: [`${dockerHome(HOME_A)}/skip-one`, `${dockerHome(HOME_B)}/skip-two`],
      scans: [
        {
          dir: dockerHome(HOME_A),
          present: [KEEP_A, VISIBLE_A, SKIP_A_TWO],
          absent: [SKIP_A_ONE]
        },
        {
          dir: dockerHome(HOME_B),
          present: [KEEP_B, VISIBLE_B, SKIP_B_ONE],
          absent: [SKIP_B_TWO]
        }
      ]
    });
  } catch (error) {
    record('docker multiple STL Homes + multiple excludes', false, error.stack || error.message);
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
