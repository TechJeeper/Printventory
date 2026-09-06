const path = require('path');
const fs = require('fs');

/** Printventory app root (tests live in tests/). */
const APP_ROOT = path.join(__dirname, '..');

/** Primary test corpus on Windows; falls back to bundled fixtures or C:\\temp. */
const TEST_FILES_PATH = 'C:\\TEST_FILES';

/**
 * Shared test helpers for Printventory Playwright tests.
 * Prefers C:\\TEST_FILES when present (full STL/3MF/ZIP corpus), then test-fixtures/scan-me.
 */
function getSmallFixtureScanPath() {
  return path.join(__dirname, 'test-fixtures', 'scan-me');
}

function getTestScanPath() {
  if (process.platform === 'win32' && fs.existsSync(TEST_FILES_PATH)) {
    return TEST_FILES_PATH;
  }
  const fixtureDir = getSmallFixtureScanPath();
  try {
    if (fs.existsSync(fixtureDir)) return fixtureDir;
  } catch (_) {}
  return process.platform === 'win32' ? 'C:\\temp' : '/test';
}

function getTestEnv(overrides = {}) {
  const env = {
    ...process.env,
    PRINTVENTORY_TEST_SCAN_PATH: getTestScanPath(),
    ...overrides
  };
  // Never pass through to Electron GUI launches — causes "bad option: --remote-debugging-port=0".
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ATOM_SHELL_INTERNAL_RUN_AS_NODE;
  return env;
}

/** Isolated user-data dir so single-instance lock doesn't conflict with a running app. */
function getTestLaunchArgs() {
  const userDataDir = path.join(__dirname, 'test-user-data');
  return [APP_ROOT, '--user-data-dir=' + userDataDir];
}

function getElectronLaunchOptions(envOverrides = {}) {
  return {
    args: getTestLaunchArgs(),
    env: getTestEnv(envOverrides),
    cwd: APP_ROOT
  };
}

/** Dev Electron uses repo-root printventory.db (see main.js getDatabasePath). */
function getTestDbPath() {
  return path.join(APP_ROOT, 'printventory.db');
}

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

function cleanTestArtifacts() {
  removeSqliteFiles(getTestDbPath());
}

/**
 * Dismiss onboarding: welcome dialog (Get Started!) and quick start guide (Close).
 */
async function dismissOnboarding(page) {
  const getStarted = page.locator('button:has-text("Get Started!")');
  try {
    await getStarted.waitFor({ state: 'visible', timeout: 15000 });
    await getStarted.click({ force: true });
    await page.waitForTimeout(800);
  } catch {
    // Welcome not shown
  }

  const guideClose = page.locator('#guide-close-button');
  try {
    await guideClose.waitFor({ state: 'visible', timeout: 10000 });
    await guideClose.click();
    await page.waitForTimeout(300);
  } catch {
    // Guide not shown
  }
}

async function scrollSidebarToTop(page) {
  await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.scrollTop = 0;
  });
}

async function expandSidebarFilters(page) {
  await page.evaluate(() => {
    if (typeof window.SidebarLayout?.setExpanded === 'function') {
      window.SidebarLayout.setExpanded(true);
      return;
    }
    document.querySelector('.sidebar')?.classList.add('filters-expanded');
  });
}

async function waitForSidebarReady(page, timeoutMs = 30000) {
  await page.waitForFunction(
    () => {
      const dialog = document.getElementById('terms-of-service-dialog');
      if (dialog?.open) return false;
      const sidebar = document.querySelector('.sidebar');
      const scanBtn = document.getElementById('scan-directory-button');
      if (!sidebar || !scanBtn) return false;
      const style = window.getComputedStyle(scanBtn);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    },
    { timeout: timeoutMs }
  );
}

async function acceptTerms(page) {
  const termsDialog = page.locator('#terms-of-service-dialog');
  const isTermsOpen = await page.evaluate(
    () => document.getElementById('terms-of-service-dialog')?.open === true
  );

  if (!isTermsOpen) {
    await waitForSidebarReady(page);
    return;
  }

  const acceptButton = page.locator('#accept-terms');
  await acceptButton.waitFor({ state: 'visible', timeout: 30000 });
  await acceptButton.click();
  await page.waitForFunction(
    () => document.getElementById('terms-of-service-dialog')?.open !== true,
    { timeout: 10000 }
  );
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  await waitForSidebarReady(page);
}

async function enableZipArchives(page) {
  await page.evaluate(async () => {
    await window.electron.saveSetting('enableZipArchives', '1');
  });
}

async function runDirectoryScan(page, timeoutMs = 300000, minModels = 5) {
  const scanButton = page.locator('#scan-directory-button');
  await scanButton.waitFor({ state: 'visible', timeout: 30000 });
  await scanButton.click();

  // Wait until models appear in the library (scan + indexing complete enough to test)
  await page.waitForFunction(
    (min) => {
      const totalEl = document.getElementById('total-count');
      const gridItems = document.querySelectorAll('.file-grid .file-item');
      const totalMatch = totalEl?.textContent?.match(/(\d+)\s+model/);
      const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
      return total >= min && gridItems.length >= min;
    },
    minModels,
    { timeout: timeoutMs }
  );

  // Allow thumbnail generation to settle; scan button may stay disabled during background work
  await page.waitForTimeout(2000);
  await applyFilters(page);
}

async function applyFilters(page) {
  await page.evaluate(async () => {
    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    }
  });
  await page.waitForTimeout(600);
}

async function getViewCount(page) {
  const text = await page.locator('#view-count').textContent();
  const m = text.match(/(\d+)\s+model/);
  return m ? parseInt(m[1], 10) : 0;
}

async function getTotalCount(page) {
  const text = await page.locator('#total-count').textContent();
  const m = text.match(/(\d+)\s+model/);
  return m ? parseInt(m[1], 10) : 0;
}

async function expectViewCount(page, expectedCount, timeoutMs = 15000) {
  await page.waitForFunction(
    (n) => {
      const el = document.getElementById('view-count');
      if (!el) return false;
      const m = el.textContent.match(/(\d+)\s+model/);
      return m ? parseInt(m[1], 10) === n : false;
    },
    expectedCount,
    { timeout: timeoutMs }
  );
}

async function expectMinTotalCount(page, minCount, timeoutMs = 60000) {
  await page.waitForFunction(
    (n) => {
      const el = document.getElementById('total-count');
      if (!el) return false;
      const m = el.textContent.match(/(\d+)\s+model/);
      return m ? parseInt(m[1], 10) >= n : false;
    },
    minCount,
    { timeout: timeoutMs }
  );
}

async function clearAllFilters(page) {
  const clearAll = page.locator('#clear-all-filters-button, .clear-filter-button').first();
  if (await clearAll.isVisible().catch(() => false)) {
    await clearAll.click({ force: true });
    await page.waitForTimeout(600);
    await applyFilters(page);
    return;
  }

  await page.locator('#search-filter-input').fill('');
  const clearSearch = page.locator('#clear-filter-search-button');
  if (await clearSearch.isVisible().catch(() => false)) {
    await clearSearch.click();
  }
  await page.locator('#filetype-select').selectOption('').catch(() => {});
  await page.locator('#printed-select').selectOption('all').catch(() => {});
  await page.locator('#designer-select').selectOption({ index: 0 }).catch(() => {});
  await page.locator('#parent-select').selectOption({ index: 0 }).catch(() => {});
  await page.locator('#license-select').selectOption({ index: 0 }).catch(() => {});
  await page.locator('#tag-filter').selectOption({ index: 0 }).catch(() => {});
  await applyFilters(page);
}

async function openDialog(page, dialogId) {
  await page.evaluate((id) => {
    const d = document.getElementById(id);
    if (d) d.showModal();
  }, dialogId);
}

async function closeDialog(page, dialogId, closeSelector = 'button:has-text("Cancel"), button:has-text("Close")') {
  const closeBtn = page.locator(`#${dialogId}`).locator(closeSelector).first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.evaluate((id) => document.getElementById(id)?.close(), dialogId);
  }
  await page.waitForTimeout(200);
}

async function getAllFilePaths(page) {
  return page.evaluate(async () => {
    const models = await window.electron.getAllModels('name-asc', 50000);
    return (models || []).map((m) => m.filePath).filter(Boolean);
  });
}

async function findFilePath(page, matcher) {
  const paths = await getAllFilePaths(page);
  return paths.find(matcher) || null;
}

/** Narrow grid by filename and return the matching visible row for context-menu tests. */
async function getFileItemByPath(page, filePath) {
  const fileName = filePath.split(/[/\\]/).pop();
  await page.locator('#search-filter-input').fill(fileName);
  await page.locator('#filter-search-button').click();
  await page.waitForTimeout(800);

  await page.waitForFunction(
    (fp) => [...document.querySelectorAll('.file-item[data-filepath]')].some((el) => el.getAttribute('data-filepath') === fp),
    filePath,
    { timeout: 15000 }
  );

  const indexAfterWait = await page.evaluate((fp) => {
    const items = [...document.querySelectorAll('.file-item[data-filepath]')];
    return items.findIndex((el) => el.getAttribute('data-filepath') === fp);
  }, filePath);

  if (indexAfterWait < 0) {
    throw new Error(`Model row not rendered in grid: ${filePath}`);
  }
  return page.locator('.file-grid .file-item').nth(indexAfterWait);
}

async function saveCurrentModel(page) {
  await page.evaluate(async () => {
    const filePath = typeof getCurrentModelFilePath === 'function' ? getCurrentModelFilePath() : null;
    if (!filePath) throw new Error('No model selected');
    const tagElements = document.getElementById('model-tags').querySelectorAll('.tag');
    const tags = Array.from(tagElements).map((tag) => tag.getAttribute('data-tag-name'));
    await window.electron.saveModel({
      filePath,
      fileName: document.getElementById('model-name').value,
      designer: document.getElementById('model-designer').value || 'Unknown',
      source: document.getElementById('model-source').value || '',
      notes: document.getElementById('model-notes').value || '',
      printStatus: document.getElementById('model-print-status')?.value || undefined,
      parentModel: document.getElementById('model-parent').value || '',
      license: document.getElementById('model-license').value || '',
      tags
    });
  });
  await page.waitForTimeout(500);
}

async function openModelDetails(page, fileItemIndex = 0) {
  await exitMultiEditMode(page);
  await clearAllFilters(page);
  const paths = await getAllFilePaths(page);
  const filePath = paths[fileItemIndex];
  if (!filePath) throw new Error('No models available to open');
  const item = await getFileItemByPath(page, filePath);
  await item.click();
  await page.locator('#model-details').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);
  return filePath;
}

async function getModelData(page, filePath) {
  return page.evaluate(async (fp) => window.electron.getModel(fp), filePath);
}

async function enterMultiEditMode(page) {
  const panel = page.locator('#multi-edit-panel');
  const isHidden = await panel.evaluate((el) => el.classList.contains('hidden'));
  if (isHidden) {
    await page.evaluate(() => {
      document.getElementById('edit-mode-toggle')?.click();
    });
    await page.waitForTimeout(600);
  }
  await panel.waitFor({ state: 'visible', timeout: 10000 });
}

async function saveMultiSelection(page) {
  await page.evaluate(() => {
    document.getElementById('multi-save-button')?.click();
  });
  await page.waitForTimeout(800);
}

async function exitMultiEditMode(page) {
  const exitBtn = page.locator('#exit-multi-edit-button');
  if (await exitBtn.isVisible().catch(() => false)) {
    await exitBtn.click();
    await page.waitForTimeout(300);
  }
}

async function openContextMenuForPath(page, filePath) {
  await page.evaluate(async (fp) => {
    const result = await window.electron.showContextMenu(fp);
    if (result && result.type === 'html-menu' && typeof showHtmlContextMenu === 'function') {
      showHtmlContextMenu(result, 240, 240);
    }
  }, filePath);
  const menu = page.locator('#html-context-menu');
  await menu.waitFor({ state: 'visible', timeout: 8000 });
  return menu;
}

async function openContextMenu(page, fileItemLocator) {
  await fileItemLocator.click({ button: 'right', position: { x: 20, y: 20 } });
  const menu = page.locator('#html-context-menu');
  await menu.waitFor({ state: 'visible', timeout: 8000 });
  return menu;
}

async function getContextMenuLabels(page) {
  const menu = page.locator('#html-context-menu');
  const texts = await menu.locator(':scope > div').allTextContents();
  return texts
    .map((t) => t.replace(/\s*▶\s*$/, '').trim())
    .filter((t) => t && t !== 'x');
}

async function clickContextMenuItem(page, label) {
  const item = page.locator('#html-context-menu').getByText(label, { exact: true });
  await item.click();
  await page.waitForTimeout(400);
}

async function dismissContextMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

const SORT_OPTIONS = [
  'name-asc', 'name-desc',
  'size-asc', 'size-desc',
  'date-asc', 'date-desc',
  'dateadded-asc', 'dateadded-desc',
  'directory-asc', 'directory-desc',
  'designer-asc', 'designer-desc',
  'parentmodel-asc', 'parentmodel-desc',
  'printed-asc', 'printed-desc'
];

const SINGLE_CONTEXT_MENU_LABELS = [
  'Preview',
  'Open File',
  'Open Directory',
  'Add Image',
  'Manage Thumbnails',
  'Move',
  'Remove from Library',
  'Delete from Disk'
];

const MULTI_CONTEXT_MENU_LABELS = [
  'Add Image',
  'Manage Thumbnails',
  'Move',
  'Remove from Library',
  'Delete from Disk'
];

const ZIP_CONTEXT_MENU_EXTRA = [
  'Extract Model',
  'Extract Zip Archive'
];

module.exports = {
  APP_ROOT,
  TEST_FILES_PATH,
  getSmallFixtureScanPath,
  getTestScanPath,
  getTestEnv,
  getTestLaunchArgs,
  getElectronLaunchOptions,
  getTestDbPath,
  cleanTestArtifacts,
  removeSqliteFiles,
  dismissOnboarding,
  acceptTerms,
  waitForSidebarReady,
  scrollSidebarToTop,
  expandSidebarFilters,
  enableZipArchives,
  runDirectoryScan,
  applyFilters,
  getViewCount,
  getTotalCount,
  expectViewCount,
  expectMinTotalCount,
  clearAllFilters,
  openDialog,
  closeDialog,
  getAllFilePaths,
  findFilePath,
  getFileItemByPath,
  openModelDetails,
  saveCurrentModel,
  saveMultiSelection,
  getModelData,
  enterMultiEditMode,
  exitMultiEditMode,
  openContextMenuForPath,
  openContextMenu,
  getContextMenuLabels,
  clickContextMenuItem,
  dismissContextMenu,
  SORT_OPTIONS,
  SINGLE_CONTEXT_MENU_LABELS,
  MULTI_CONTEXT_MENU_LABELS,
  ZIP_CONTEXT_MENU_EXTRA
};
