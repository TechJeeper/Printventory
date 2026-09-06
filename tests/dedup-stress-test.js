/**
 * Stress DeDup at large-library scale (the Discord 100k+ crash case).
 *
 * Seeds an isolated SQLite DB with N duplicate groups (2 files each),
 * launches Electron against it, then measures:
 *   - getDuplicates IPC time / payload size
 *   - DOM node count (must stay windowed, not N groups)
 *   - scroll + Easy/Clear selection
 *   - process memory / renderer survival
 *
 * Usage:
 *   node tests/dedup-stress-test.js [groups] [filesPerGroup]
 *
 * Defaults: groups=25000  filesPerGroup=2  → 50k models
 * For the reported crash shape: node tests/dedup-stress-test.js 50000
 *
 * Close other Printventory/Electron instances first (single-instance lock).
 */
const { _electron: electron } = require('@playwright/test');
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  getElectronLaunchOptions,
  acceptTerms,
  dismissOnboarding
} = require('./test-utils');

const GROUPS = Math.max(1, Number(process.argv[2] || 25000));
const FILES_PER_GROUP = Math.max(2, Number(process.argv[3] || 2));
const TOTAL_MODELS = GROUPS * FILES_PER_GROUP;

const STRESS_DIR = path.join(__dirname, 'test-dedup-stress');
const DB_PATH = path.join(STRESS_DIR, 'printventory.db');
const USER_DATA = path.join(STRESS_DIR, 'user-data');

/** Soft fail if getDuplicates takes longer than this (ms). */
const GET_DUP_BUDGET_MS = Math.max(30000, GROUPS * 2);
/** Soft fail if peak WorkingSet exceeds this (bytes). */
const MEM_BUDGET_BYTES = 3.5 * 1024 * 1024 * 1024;
/** Hard fail if more than this many .duplicate-group nodes are mounted. */
const MAX_MOUNTED_GROUPS = 80;

function formatBytes(n) {
  if (!n || n <= 0) return '0 B';
  const u = ['B', 'KiB', 'MiB', 'GiB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

function sampleElectronMem() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum"',
      { encoding: 'utf8' }
    ).trim();
    const n = Number(out);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function removeSqliteFiles(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      if (e.code !== 'EBUSY') throw e;
    }
  }
}

function resolveElectronBinary() {
  try {
    return require('electron');
  } catch {
    return path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  }
}

function seedStressDb() {
  fs.mkdirSync(STRESS_DIR, { recursive: true });
  removeSqliteFiles(DB_PATH);

  console.log(`Seeding ${GROUPS.toLocaleString()} groups × ${FILES_PER_GROUP} = ${TOTAL_MODELS.toLocaleString()} models (via Electron)...`);
  const electronBin = resolveElectronBinary();
  const seedScript = path.join(__dirname, 'scripts', 'seed-dedup-stress-db.js');
  const result = spawnSync(
    electronBin,
    [seedScript, String(GROUPS), String(FILES_PER_GROUP), DB_PATH],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      timeout: 300000
    }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    throw new Error(`Seed failed with exit ${result.status}`);
  }

  const line = (result.stdout || '').split(/\r?\n/).find((l) => l.startsWith('SEED_RESULT '));
  if (!line) throw new Error('Seed did not emit SEED_RESULT');
  return JSON.parse(line.slice('SEED_RESULT '.length));
}

async function main() {
  console.log('=== Dedup stress test ===');
  console.log(`groups=${GROUPS} filesPerGroup=${FILES_PER_GROUP} totalModels=${TOTAL_MODELS}`);

  const beforeMem = sampleElectronMem();
  if (beforeMem > 0) {
    console.warn(`WARNING: electron already running (mem=${formatBytes(beforeMem)}). Close it for accurate results.`);
  }

  const seed = seedStressDb();
  console.log(`  seed ok: ${seed.count.toLocaleString()} models, ${seed.dupGroups.toLocaleString()} groups in ${seed.seedMs}ms`);

  fs.mkdirSync(USER_DATA, { recursive: true });

  const peak = { mem: 0 };
  const bump = (m) => {
    if (m > peak.mem) peak.mem = m;
  };

  console.log('\nPhase 1: Launch Electron + IPC getDuplicates');
  const launchOpts = getElectronLaunchOptions({
    PRINTVENTORY_DB_PATH: DB_PATH
  });
  launchOpts.args = [
    path.join(__dirname, '..'),
    `--user-data-dir=${USER_DATA}`
  ];

  const app = await electron.launch(launchOpts);
  const page = await app.firstWindow();
  page.setDefaultTimeout(180000);

  const consoleErrors = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/OOM|out of memory|Zone Allocation|FATAL|Failed to load duplicate/i.test(t)) {
      consoleErrors.push(t.slice(0, 240));
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(String(err).slice(0, 240));
  });
  page.on('crash', () => {
    consoleErrors.push('RENDERER_CRASH');
  });

  try {
    await acceptTerms(page);
    await dismissOnboarding(page);
    await page.waitForFunction(() => !!(window.electron && window.electron.getDuplicates), null, {
      timeout: 90000
    });
    bump(sampleElectronMem());
    console.log(`  mem after launch: ${formatBytes(peak.mem)}`);

    // Skip hash prompt path — all rows already have hashes
    const withoutHash = await page.evaluate(() => window.electron.getModelsWithoutHash());
    console.log(`  models without hash: ${withoutHash}`);

    const ipcStart = Date.now();
    const ipcResult = await page.evaluate(async () => {
      const start = performance.now();
      const raw = await window.electron.getDuplicates(false);
      const ms = performance.now() - start;
      const groups = Array.isArray(raw)
        ? raw
        : Object.entries(raw || {}).map(([hash, files]) => ({ hash, files }));
      let fileCount = 0;
      for (const g of groups) fileCount += (g.files && g.files.length) || 0;
      return {
        ms,
        groupCount: groups.length,
        fileCount,
        isArray: Array.isArray(raw)
      };
    });
    const ipcWallMs = Date.now() - ipcStart;
    bump(sampleElectronMem());
    console.log(
      `  IPC getDuplicates: ${ipcResult.groupCount.toLocaleString()} groups / ${ipcResult.fileCount.toLocaleString()} files ` +
        `in ${Math.round(ipcResult.ms)}ms (wall ${ipcWallMs}ms), array=${ipcResult.isArray}, mem=${formatBytes(peak.mem)}`
    );

    // --- Phase 2: UI virtualization ---
    console.log('\nPhase 2: Dedup UI (virtual list)');
    await page.evaluate(() => {
      // Bypass hash-check path; open dialog and render
      if (typeof loadDuplicateFiles === 'function') {
        return loadDuplicateFiles(true);
      }
      window.electron.send?.('open-dedup');
    });

    await page.waitForFunction(
      () => {
        const dialog = document.getElementById('dedup-dialog');
        const el = dialog && dialog.querySelector('.duplicate-groups');
        if (!el || !dialog.open) return false;
        const text = el.textContent || '';
        return (
          !text.includes('Loading duplicate files') &&
          !text.includes('Analyzing duplicates') &&
          (el.querySelector('.dedup-virtual-spacer') || text.includes('No duplicate'))
        );
      },
      null,
      { timeout: 180000 }
    );
    bump(sampleElectronMem());

    const uiStats = await page.evaluate(() => {
      const el = document.querySelector('#dedup-dialog .duplicate-groups');
      const mounted = el ? el.querySelectorAll('.duplicate-group').length : -1;
      const spacer = el && el.querySelector('.dedup-virtual-spacer');
      const summary = el && el.querySelector('.dedup-virtual-summary')?.textContent;
      const state = window._dedupVirtualState;
      return {
        mounted,
        spacerHeight: spacer ? spacer.style.height : null,
        summary: summary || null,
        stateGroups: state?.groups?.length ?? 0,
        selected: state?.selectedPaths?.size ?? 0,
        dialogOpen: !!document.getElementById('dedup-dialog')?.open
      };
    });
    console.log(
      `  mounted DOM groups=${uiStats.mounted} (budget≤${MAX_MOUNTED_GROUPS}), ` +
        `stateGroups=${uiStats.stateGroups.toLocaleString()}, spacer=${uiStats.spacerHeight}, mem=${formatBytes(peak.mem)}`
    );
    console.log(`  summary: ${uiStats.summary}`);

    // Scroll through the virtual list
    console.log('  scrolling virtual list...');
    const scrollMem = await page.evaluate(async () => {
      const el = document.querySelector('#dedup-dialog .duplicate-groups');
      if (!el) return { maxMounted: -1 };
      let maxMounted = 0;
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        el.scrollTop = (el.scrollHeight * i) / steps;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        maxMounted = Math.max(maxMounted, el.querySelectorAll('.duplicate-group').length);
      }
      el.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 100));
      return {
        maxMounted,
        finalMounted: el.querySelectorAll('.duplicate-group').length
      };
    });
    bump(sampleElectronMem());
    console.log(
      `  scroll maxMounted=${scrollMem.maxMounted} finalMounted=${scrollMem.finalMounted}, mem=${formatBytes(peak.mem)}`
    );

    // Easy + Clear (call handlers directly — more reliable than click under modal)
    console.log('  Easy / Clear...');
    const easyMs = await page.evaluate(() => {
      const t0 = performance.now();
      if (typeof window.dedupEasyFromDialog === 'function') window.dedupEasyFromDialog();
      return performance.now() - t0;
    });
    const afterEasy = await page.evaluate(() => ({
      selected: window._dedupVirtualState?.selectedPaths?.size ?? 0,
      checkedVisible: document.querySelectorAll(
        '#dedup-dialog .duplicate-file input[type="checkbox"]:checked'
      ).length,
      hasApply: typeof window.applyDedupEasySelection === 'function'
    }));
    console.log(
      `  after Easy (${Math.round(easyMs)}ms): selected=${afterEasy.selected.toLocaleString()} ` +
        `visibleChecked=${afterEasy.checkedVisible} hasApply=${afterEasy.hasApply}`
    );

    await page.evaluate(() => {
      if (typeof window.dedupClearFromDialog === 'function') window.dedupClearFromDialog();
    });
    const afterClear = await page.evaluate(() => ({
      selected: window._dedupVirtualState?.selectedPaths?.size ?? 0,
      checkedVisible: document.querySelectorAll(
        '#dedup-dialog .duplicate-file input[type="checkbox"]:checked'
      ).length
    }));
    console.log(`  after Clear: selected=${afterClear.selected} visibleChecked=${afterClear.checkedVisible}`);

    await page.evaluate(() => {
      const dialog = document.getElementById('dedup-dialog');
      if (dialog?.open) dialog.close();
    });
    await page.waitForTimeout(300);
    bump(sampleElectronMem());

    const afterClose = await page.evaluate(() => ({
      state: window._dedupVirtualState,
      alive: !!(window.electron && window.electron.getDuplicates),
      groupsHtmlLen: (document.querySelector('#dedup-dialog .duplicate-groups')?.innerHTML || '').length,
      dialogOpen: !!document.getElementById('dedup-dialog')?.open
    }));
    console.log(
      `  after close: stateCleared=${afterClose.state == null} dialogOpen=${afterClose.dialogOpen} ` +
        `htmlLen=${afterClose.groupsHtmlLen}, mem=${formatBytes(peak.mem)}`
    );

    const stillAlive = afterClose.alive;
    const oomLogs = consoleErrors.filter((t) => /OOM|out of memory|Zone Allocation|RENDERER_CRASH/i.test(t));
    const expectedSelected = GROUPS * (FILES_PER_GROUP - 1);

    console.log('\n=== Results ===');
    console.log(`  seed: ${seed.count.toLocaleString()} models in ${seed.seedMs}ms`);
    console.log(`  IPC: ${ipcResult.groupCount.toLocaleString()} groups in ${Math.round(ipcResult.ms)}ms`);
    console.log(`  peak electron WorkingSet: ${formatBytes(peak.mem)}`);
    console.log(`  mounted DOM (open): ${uiStats.mounted}`);
    console.log(`  scroll max mounted: ${scrollMem.maxMounted}`);
    console.log(`  Easy selected: ${afterEasy.selected.toLocaleString()} (expected ${expectedSelected.toLocaleString()})`);
    console.log(`  window alive: ${stillAlive}`);
    console.log(`  OOM/crash console lines: ${oomLogs.length}`);
    if (consoleErrors.length) {
      console.log('  console samples:');
      for (const line of consoleErrors.slice(0, 5)) console.log('   -', line);
    }

    const pass =
      stillAlive &&
      oomLogs.length === 0 &&
      ipcResult.groupCount === GROUPS &&
      uiStats.mounted >= 1 &&
      uiStats.mounted <= MAX_MOUNTED_GROUPS &&
      scrollMem.maxMounted <= MAX_MOUNTED_GROUPS &&
      afterEasy.selected === expectedSelected &&
      afterClear.selected === 0 &&
      afterClose.state == null &&
      ipcResult.ms < GET_DUP_BUDGET_MS &&
      peak.mem < MEM_BUDGET_BYTES;

    if (!pass) {
      console.error('FAIL');
      if (ipcResult.groupCount !== GROUPS) {
        console.error(`  group count mismatch: got ${ipcResult.groupCount} expected ${GROUPS}`);
      }
      if (uiStats.mounted > MAX_MOUNTED_GROUPS || scrollMem.maxMounted > MAX_MOUNTED_GROUPS) {
        console.error('  virtualization failed — too many DOM groups mounted');
      }
      if (afterEasy.selected !== expectedSelected) {
        console.error(`  Easy selection mismatch`);
      }
      if (peak.mem >= MEM_BUDGET_BYTES) {
        console.error(`  memory budget exceeded (${formatBytes(MEM_BUDGET_BYTES)})`);
      }
      if (ipcResult.ms >= GET_DUP_BUDGET_MS) {
        console.error(`  getDuplicates over budget (${GET_DUP_BUDGET_MS}ms)`);
      }
      process.exitCode = 1;
    } else {
      console.log('PASS');
    }
  } finally {
    try {
      await app.close();
    } catch (_) {}
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
