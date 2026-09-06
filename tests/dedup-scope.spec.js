/**
 * De-Dup current-view scope (GitHub #61).
 *
 * Seeds two designers with known duplicate hashes:
 *   ScopeAlpha: two copies of cube.stl
 *   ScopeBeta:  two copies of test.stl, plus a third copy of cube.stl
 *
 * Entire library → 2 groups (cube×3, test×2)
 * ScopeAlpha     → 1 group  (cube×2)  — the beta cube copy is out of scope
 * ScopeBeta      → 1 group  (test×2)  — the cube copy is unique inside beta
 *
 * Uses PRINTVENTORY_DB_PATH so the developer's library DB is not touched.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  getElectronLaunchOptions,
  dismissOnboarding,
  acceptTerms,
  runDirectoryScan,
  applyFilters,
  clearAllFilters,
  expandSidebarFilters
} = require('./test-utils');

const APP_ROOT = path.join(__dirname, '..');
const WORK = path.join(__dirname, 'test-user-data', 'dedup-scope');
const FILES = path.join(WORK, 'files');
const DB_PATH = path.join(WORK, 'printventory.db');
const USER_DATA = path.join(WORK, 'profile');
const CUBE = path.join(__dirname, 'test-fixtures', 'scan-me', 'cube.stl');
const OTHER = path.join(__dirname, 'test-fixtures', 'scan-me', 'test.stl');

let app;
let window;

function removeSqliteFiles(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = dbPath + suffix;
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      if (e.code !== 'EBUSY') throw e;
    }
  }
}

function seedFixtureFiles() {
  fs.mkdirSync(path.join(FILES, 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(FILES, 'beta'), { recursive: true });
  fs.copyFileSync(CUBE, path.join(FILES, 'alpha', 'widget-a.stl'));
  fs.copyFileSync(CUBE, path.join(FILES, 'alpha', 'widget-a-copy.stl'));
  fs.copyFileSync(CUBE, path.join(FILES, 'beta', 'widget-a-from-beta.stl'));
  fs.copyFileSync(OTHER, path.join(FILES, 'beta', 'gadget-b.stl'));
  fs.copyFileSync(OTHER, path.join(FILES, 'beta', 'gadget-b-copy.stl'));
}

async function ensureHashes() {
  await window.evaluate(async () => {
    const models = await window.electron.getAllModels('name-asc');
    const missing = models.filter((m) => !m.hash || !String(m.hash).trim()).length;
    if (!missing) return;
    const already = await window.electron.isGeneratingHashes();
    if (!already) {
      const result = await window.electron.generateMissingHashes();
      if (result && result.total === 0) return;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for hashes')), 90000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      if (typeof window.electron.onHashGenerationComplete === 'function') {
        window.electron.onHashGenerationComplete(done);
      } else {
        setTimeout(done, 4000);
      }
    });
  });
}

async function assignDesignersFromFolders() {
  await window.evaluate(async () => {
    const models = await window.electron.getAllModels('name-asc');
    const batch = models.map((m) => {
      const p = String(m.filePath || '').replace(/\\/g, '/');
      let designer = '';
      if (p.includes('/alpha/')) designer = 'ScopeAlpha';
      else if (p.includes('/beta/')) designer = 'ScopeBeta';
      return { filePath: m.filePath, designer };
    });
    await window.electron.updateModelsBatch(batch);
    if (typeof populateDesignerDropdown === 'function') {
      await populateDesignerDropdown();
    }
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('De-Dup current-view scope', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(WORK, { recursive: true });
    fs.mkdirSync(USER_DATA, { recursive: true });
    removeSqliteFiles(DB_PATH);
    seedFixtureFiles();

    const opts = getElectronLaunchOptions({
      PRINTVENTORY_TEST_SCAN_PATH: FILES,
      PRINTVENTORY_DB_PATH: DB_PATH
    });
    opts.args = [APP_ROOT, '--user-data-dir=' + USER_DATA];

    app = await electron.launch(opts);
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await acceptTerms(window);
    await dismissOnboarding(window);
    await runDirectoryScan(window, 120000, 5);
    await ensureHashes();
    await assignDesignersFromFolders();
    await applyFilters(window);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('IPC: entire library finds both duplicate groups', async () => {
    const result = await window.evaluate(async () => {
      const raw = await window.electron.getDuplicates(false);
      const groups = Array.isArray(raw)
        ? raw
        : Object.entries(raw || {}).map(([hash, files]) => ({ hash, files }));
      return groups.map((g) => ({
        count: (g.files || []).length,
        paths: (g.files || []).map((f) => String(f.filePath || '').replace(/\\/g, '/'))
      }));
    });

    expect(result.length).toBe(2);
    const sizes = result.map((g) => g.count).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 3]);
    const cubeGroup = result.find((g) => g.paths.some((n) => n.includes('widget-a')));
    expect(cubeGroup.count).toBe(3);
    expect(cubeGroup.paths.filter((n) => n.includes('/alpha/')).length).toBe(2);
    expect(cubeGroup.paths.filter((n) => n.includes('/beta/')).length).toBe(1);
  });

  test('IPC: designer ScopeAlpha only returns intra-filter cube duplicates', async () => {
    const result = await window.evaluate(async () => {
      const models = await window.electron.getModelsFiltered({ designer: 'ScopeAlpha' });
      const paths = new Set(models.map((m) => m.filePath));
      const raw = await window.electron.getDuplicates({
        includeZip: false,
        filters: { designer: 'ScopeAlpha' }
      });
      const groups = Array.isArray(raw)
        ? raw.filter((g) => g && Array.isArray(g.files) && g.files.length > 1)
        : Object.values(raw || {}).filter((files) => Array.isArray(files) && files.length > 1)
            .map((files) => ({ files }));
      return {
        filteredCount: paths.size,
        groupCount: groups.length,
        fileCounts: groups.map((g) => g.files.length),
        allInFilter: groups.every((g) => g.files.every((f) => paths.has(f.filePath))),
        names: groups.flatMap((g) => g.files.map((f) => f.fileName || f.filePath))
      };
    });

    expect(result.filteredCount).toBe(2);
    expect(result.groupCount).toBe(1);
    expect(result.fileCounts).toEqual([2]);
    expect(result.allInFilter).toBe(true);
    expect(result.names.every((n) => String(n).includes('widget-a'))).toBe(true);
    expect(result.names.some((n) => String(n).includes('from-beta'))).toBe(false);
  });

  test('IPC: designer ScopeBeta only returns the test.stl pair', async () => {
    const result = await window.evaluate(async () => {
      const raw = await window.electron.getDuplicates({
        includeZip: false,
        filters: { designer: 'ScopeBeta' }
      });
      const groups = Array.isArray(raw)
        ? raw.filter((g) => g && Array.isArray(g.files) && g.files.length > 1)
        : [];
      return {
        groupCount: groups.length,
        fileCounts: groups.map((g) => g.files.length),
        names: groups.flatMap((g) => g.files.map((f) => f.fileName || ''))
      };
    });

    expect(result.groupCount).toBe(1);
    expect(result.fileCounts).toEqual([2]);
    expect(result.names.every((n) => n.includes('gadget-b'))).toBe(true);
  });

  test('UI: no filter disables Current view and scans entire library', async () => {
    await clearAllFilters(window);
    await window.evaluate(async () => {
      window._dedupScope = null;
      const dialog = document.getElementById('dedup-dialog');
      if (dialog && !dialog.open) dialog.showModal();
      await loadDuplicateFiles(true);
    });

    await expect(window.locator('#dedup-dialog')).toBeVisible();
    await expect(window.locator('#dedup-scope-current')).toBeDisabled();
    await expect(window.locator('#dedup-scope-entire')).toBeChecked();
    await expect(window.locator('#dedup-scope-summary')).toContainText('Apply a library filter');
    await expect(window.locator('.dedup-group-count')).toContainText('2 duplicate groups');
    await window.locator('#close-dedup').click();
  });

  test('UI: current view defaults on and scopes to ScopeAlpha', async () => {
    await clearAllFilters(window);
    await expandSidebarFilters(window);
    await window.locator('#designer-select').selectOption({ label: 'ScopeAlpha' });
    await applyFilters(window);

    await window.evaluate(async () => {
      window._dedupScope = null;
      const dialog = document.getElementById('dedup-dialog');
      if (dialog && !dialog.open) dialog.showModal();
      await loadDuplicateFiles(true);
    });

    await expect(window.locator('#dedup-dialog')).toBeVisible();
    await expect(window.locator('#dedup-scope-current')).toBeChecked();
    await expect(window.locator('#dedup-scope-current')).toBeEnabled();
    await expect(window.locator('#dedup-scope-summary')).toContainText('ScopeAlpha');
    await expect(window.locator('.dedup-group-count')).toContainText('1 duplicate group');

    await window.evaluate(async () => {
      window._dedupScope = 'entire';
      await loadDuplicateFiles(true);
    });
    await expect(window.locator('#dedup-scope-entire')).toBeChecked();
    await expect(window.locator('#dedup-scope-summary')).toContainText('entire library');
    await expect(window.locator('.dedup-group-count')).toContainText('2 duplicate groups');

    await window.locator('#close-dedup').click();
    await clearAllFilters(window);
  });
});
