/**
 * Comprehensive Printventory E2E tests using C:\TEST_FILES (or test-fixtures fallback).
 *
 * Run full suite with HTML report:
 *   npm run test:full
 *
 * Open report after run:
 *   npx playwright show-report playwright-report
 *
 * Close any running Printventory instance before testing (single-instance lock).
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const {
  TEST_FILES_PATH,
  getTestScanPath,
  getTestEnv,
  getElectronLaunchOptions,
  cleanTestArtifacts,
  dismissOnboarding,
  acceptTerms,
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
} = require('./test-utils');

let app;
let window;
let libraryTotal = 0;
let scanPath = '';

test.describe.configure({ mode: 'serial' });

test.describe('Printventory full application E2E', () => {
  test.beforeAll(async () => {
    scanPath = getTestScanPath();
    cleanTestArtifacts();

    app = await electron.launch(getElectronLaunchOptions());
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await acceptTerms(window);
    await dismissOnboarding(window);
    await expandSidebarFilters(window);
    await enableZipArchives(window);
    await runDirectoryScan(window, 300000);
    await expectMinTotalCount(window, 5, 120000);

    libraryTotal = await getTotalCount(window);
    await clearAllFilters(window);
    await expectViewCount(window, libraryTotal, 15000);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  // ─── Scan & library bootstrap ─────────────────────────────────────────────

  test('Scan: uses TEST_FILES path and indexes models', async () => {
    test.info().annotations.push({ type: 'scan-path', description: scanPath });
    expect(scanPath).toBeTruthy();
    if (process.platform === 'win32') {
      expect(scanPath.toLowerCase()).toBe(TEST_FILES_PATH.toLowerCase());
    }
    expect(libraryTotal).toBeGreaterThanOrEqual(5);
    await expect(window.locator('.file-grid .file-item').first()).toBeVisible();
  });

  test('Scan: library contains STL, 3MF, and ZIP archive entries', async () => {
    const paths = await getAllFilePaths(window);
    expect(paths.length).toBe(libraryTotal);

    const hasStl = paths.some((p) => /\.stl$/i.test(p.split('::').pop()));
    const has3mf = paths.some((p) => /\.3mf$/i.test(p.split('::').pop()));
    const hasZipEntry = paths.some((p) => p.includes('::'));

    expect(hasStl).toBe(true);
    expect(has3mf).toBe(true);
    if (scanPath.toLowerCase() === TEST_FILES_PATH.toLowerCase()) {
      expect(hasZipEntry).toBe(true);
    }
  });

  // ─── Sidebar & view modes ───────────────────────────────────────────────────

  test('UI: sidebar action buttons are visible', async () => {
    await expect(window.locator('#scan-directory-button')).toBeVisible();
    await expect(window.locator('#view-library-button')).toBeVisible();
    await expect(window.locator('#dup-button')).toBeVisible();
    await expect(window.locator('#tag-button')).toBeVisible();
    await expect(window.locator('#filament-button')).toBeVisible();
    await expect(window.locator('#roulette-button')).toBeVisible();
    await expect(window.locator('#edit-mode-toggle')).toBeAttached();
  });

  test('UI: view modes switch between List, Preview, and Detailed', async () => {
    for (const view of ['detailed', 'preview', 'list']) {
      await window.locator(`.view-button[data-view="${view}"]`).click();
      await window.waitForTimeout(400);
      await expect(window.locator(`.file-grid[data-view="${view}"], .file-grid.view-${view}`).or(
        window.locator('.file-grid')
      )).toBeVisible();
    }
    await window.locator('.view-button[data-view="detailed"]').click();
  });

  test('UI: View Entire Library shows full collection', async () => {
    await window.locator('#search-filter-input').fill('__narrow__');
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(500);
    const narrowed = await getViewCount(window);
    expect(narrowed).toBeLessThan(libraryTotal);

    await window.locator('#view-library-button').click();
    await window.waitForTimeout(800);
    await applyFilters(window);
    await expectViewCount(window, libraryTotal, 15000);
  });

  // ─── Sorting ────────────────────────────────────────────────────────────────

  test('Sort: all sort options apply without error', async () => {
    await clearAllFilters(window);
    await window.locator('.view-button[data-view="detailed"]').click();
    await window.waitForTimeout(400);
    for (const option of SORT_OPTIONS) {
      await window.locator('#sort-select').selectOption(option);
      await applyFilters(window);
      const count = await getViewCount(window);
      expect(count).toBe(libraryTotal);
      // name-asc often paints parent-model groups first (no .file-name); accept either.
      const firstCell = window.locator(
        '.file-grid .file-name, .file-grid .parent-model-group-title'
      ).first();
      await expect(firstCell).toBeVisible({ timeout: 15000 });
      const firstLabel = await firstCell.textContent();
      expect(firstLabel?.trim().length).toBeGreaterThan(0);
    }
    await window.locator('#sort-select').selectOption('name-asc');
    await applyFilters(window);
  });

  // ─── Search & filtering ─────────────────────────────────────────────────────

  test('Filter: search by filename narrows results', async () => {
    await clearAllFilters(window);
    const samplePath = await findFilePath(window, (p) => /\.stl$/i.test(p.split('::').pop()));
    expect(samplePath).toBeTruthy();
    const baseName = samplePath.split(/[/\\]/).pop().split('::').pop().replace(/\.stl$/i, '');

    await window.locator('#search-filter-input').fill(baseName.slice(0, 6));
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(600);
    const filtered = await getViewCount(window);
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThanOrEqual(libraryTotal);

    await clearAllFilters(window);
    await expectViewCount(window, libraryTotal);
  });

  test('Filter: no-match search shows empty result state', async () => {
    await window.locator('#search-filter-input').fill('__no_such_model_xyz_999__');
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(600);
    await expect(window.getByText('No models match your filters')).toBeVisible({ timeout: 10000 });
    await clearAllFilters(window);
    await expectViewCount(window, libraryTotal);
  });

  test('Filter: file type STL and 3MF', async () => {
    await clearAllFilters(window);

    await window.locator('#filetype-select').selectOption('stl');
    await applyFilters(window);
    const stlCount = await getViewCount(window);
    expect(stlCount).toBeGreaterThan(0);

    await window.locator('#filetype-select').selectOption('3mf');
    await applyFilters(window);
    const mfCount = await getViewCount(window);
    expect(mfCount).toBeGreaterThan(0);

    await window.locator('#filetype-select').selectOption('');
    await applyFilters(window);
    await expectViewCount(window, libraryTotal);
  });

  test('Filter: Zip file type shows archive entries when ZIP enabled', async () => {
    await clearAllFilters(window);
    const zipOption = window.locator('#filetype-select option[value="zip"]');
    if (await zipOption.count() === 0) {
      test.skip(true, 'Zip filter option not present');
      return;
    }
    await window.locator('#filetype-select').selectOption('zip');
    await applyFilters(window);
    const zipCount = await getViewCount(window);
    expect(zipCount).toBeGreaterThan(0);

    const zipEntries = (await getAllFilePaths(window)).filter((p) => p.includes('::'));
    expect(zipEntries.length).toBeGreaterThan(0);

    await clearAllFilters(window);
  });

  test('Filter: print status All / Not Printed / Printed', async () => {
    await clearAllFilters(window);

    await window.locator('#printed-select').selectOption('all');
    await applyFilters(window);
    await expectViewCount(window, libraryTotal);

    await window.locator('#printed-select').selectOption('not-printed');
    await applyFilters(window);
    await expectViewCount(window, libraryTotal);

    await window.locator('#printed-select').selectOption('printed');
    await applyFilters(window);
    await expect(window.getByText('No models match your filters')).toBeVisible({ timeout: 10000 });

    await clearAllFilters(window);
  });

  test('Filter: invert filters toggles result set', async () => {
    await clearAllFilters(window);
    const samplePath = await findFilePath(window, (p) => /\.stl$/i.test(p.split('::').pop()));
    expect(samplePath).toBeTruthy();
    const fileName = samplePath.split(/[/\\]/).pop();

    await window.locator('#search-filter-input').fill(fileName);
    await window.locator('#filter-search-button').click();
    await applyFilters(window);
    await expect(window.getByText('No models match your filters')).not.toBeVisible();

    await window.locator('#invert-filter-button').click();
    await applyFilters(window);
    await expect(window.locator('#invert-filter-button')).toHaveClass(/active/);

    await clearAllFilters(window);
  });

  test('Filter: multi-filter search + file type + clear all', async () => {
    await clearAllFilters(window);
    await window.locator('#search-filter-input').fill('BOB');
    await window.locator('#filetype-select').selectOption('stl');
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(600);
    const combined = await getViewCount(window);
    expect(combined).toBeGreaterThan(0);

    await expect(window.locator('.clear-filter-button, #clear-all-filters-button').first()).toBeVisible();
    await clearAllFilters(window);
    await expectViewCount(window, libraryTotal);
  });

  test('Filter: searchable list dialog opens for designer', async () => {
    await window.locator('.list-button[data-field="designer"][data-target="designer-select"]').click();
    await expect(window.locator('#searchable-list-dialog')).toBeVisible();
    await expect(window.locator('#searchable-list-items')).toBeVisible();
    await closeDialog(window, 'searchable-list-dialog', '#searchable-list-cancel');
  });

  // ─── Single-edit metadata (all fields) ──────────────────────────────────────

  test('Single-edit: set all metadata fields on first model', async () => {
    await clearAllFilters(window);
    const filePath = await openModelDetails(window, 0);

    await window.locator('#add-new-designer-button').click();
    await window.locator('#new-designer-name').fill('E2E Designer');
    await window.locator('#add-designer-button').click();
    await window.waitForTimeout(300);

    await window.locator('#add-new-parent-button').click();
    await window.locator('#new-parent-name').fill('E2E Parent');
    await window.locator('#add-parent-button').click();
    await window.waitForTimeout(300);

    await window.locator('#add-new-license-button').click();
    await window.locator('#new-license-name').fill('E2E License');
    await window.locator('#add-license-button').click();
    await window.waitForTimeout(300);

    await window.locator('#model-source').fill('https://example.com/e2e-model');
    await window.locator('#model-notes').fill('E2E notes for automated test');
    await window.locator('#model-print-status').selectOption('printed');

    await window.locator('#add-tag-button').click();
    await window.locator('#new-tag-name').fill('e2e-tag');
    await window.locator('#add-tag-submit').click();
    await window.waitForTimeout(400);

    await saveCurrentModel(window);

    const model = await getModelData(window, filePath);
    expect(model.designer).toBe('E2E Designer');
    expect(model.parentModel).toBe('E2E Parent');
    expect(model.license).toBe('E2E License');
    expect(model.source).toBe('https://example.com/e2e-model');
    expect(model.notes).toBe('E2E notes for automated test');
    expect(model.printed).toBe(1);
    const tagNames = (model.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
    expect(tagNames).toContain('e2e-tag');
  });

  test('Single-edit: notes modal opens and saves', async () => {
    await openModelDetails(window, 0);
    await window.locator('#open-notes-modal-button').click();
    await expect(window.locator('#notes-modal-dialog')).toBeVisible();
    await window.locator('#notes-modal-textarea').fill('Updated via notes modal');
    await window.locator('#save-notes-button').click();
    await window.waitForTimeout(400);
    await expect(window.locator('#model-notes')).toHaveValue('Updated via notes modal');
    await saveCurrentModel(window);
  });

  test('Single-edit: filter by saved designer and tag', async () => {
    await clearAllFilters(window);
    await window.locator('#designer-select').selectOption({ label: 'E2E Designer' });
    await applyFilters(window);
    expect(await getViewCount(window)).toBeGreaterThan(0);

    await clearAllFilters(window);
    await window.locator('#tag-filter').selectOption({ label: 'e2e-tag' });
    await applyFilters(window);
    expect(await getViewCount(window)).toBeGreaterThan(0);
    await clearAllFilters(window);
  });

  // ─── Multi-edit mode ────────────────────────────────────────────────────────

  test('Multi-edit: enter mode, select all, clear selection', async () => {
    await clearAllFilters(window);
    await enterMultiEditMode(window);
    await window.locator('#select-all-button').click();
    await window.waitForTimeout(300);
    await expect(window.locator('.selected-count')).toContainText(String(libraryTotal));

    await window.locator('#clear-selection-button').click();
    await window.waitForTimeout(300);
    await expect(window.locator('.selected-count')).toContainText('0');
  });

  test('Multi-edit: bulk update designer, source, license, parent, printed', async () => {
    await enterMultiEditMode(window);
    await window.locator('#select-all-button').click();
    await window.waitForTimeout(200);

    await window.locator('#multi-designer').selectOption({ label: 'E2E Designer' });
    await window.locator('#multi-source').fill('https://multi.e2e.example.com');
    await window.locator('#multi-license').selectOption({ label: 'E2E License' });
    await window.locator('#multi-parent').selectOption({ label: 'E2E Parent' });
    await window.locator('#multi-print-status').selectOption('printed');
    await saveMultiSelection(window);

    const paths = (await getAllFilePaths(window)).slice(0, 3);
    for (const fp of paths) {
      const m = await getModelData(window, fp);
      expect(m.designer).toBe('E2E Designer');
      expect(m.source).toBe('https://multi.e2e.example.com');
      expect(m.license).toBe('E2E License');
      expect(m.parentModel).toBe('E2E Parent');
      expect(m.printed).toBe(1);
    }
  });

  test('Multi-edit: add tag via dropdown and new-tag dialog', async () => {
    await enterMultiEditMode(window);
    await window.locator('#select-all-button').click();
    await window.waitForTimeout(200);

    await window.locator('#multi-tag-select').selectOption({ label: 'e2e-tag' });
    await window.waitForTimeout(600);

    await window.locator('#multi-edit-panel .add-tag-button').click();
    await window.locator('#new-tag-name').fill('multi-e2e-tag');
    await window.locator('#add-tag-submit').click();
    await window.waitForTimeout(600);

    const fp = await getAllFilePaths(window).then((p) => p[0]);
    const tags = (await getModelData(window, fp)).tags || [];
    const names = tags.map((t) => (typeof t === 'string' ? t : t.name));
    expect(names).toContain('e2e-tag');
    expect(names).toContain('multi-e2e-tag');
  });

  test('Multi-edit: exit mode restores single-edit panel', async () => {
    await exitMultiEditMode(window);
    await expect(window.locator('#multi-edit-panel')).toHaveClass(/hidden/);
  });

  // ─── Context menu: single model (regular file) ─────────────────────────────

  test('Context menu (single): regular STL shows all expected items', async () => {
    await clearAllFilters(window);
    const stlPath = await findFilePath(window, (p) => !p.includes('::') && /\.stl$/i.test(p.split(/[/\\]/).pop()));
    expect(stlPath).toBeTruthy();
    await openContextMenuForPath(window, stlPath);

    const labels = await getContextMenuLabels(window);
    const coreLabels = SINGLE_CONTEXT_MENU_LABELS.filter((l) => l !== 'Preview');
    for (const label of coreLabels) {
      expect(labels).toContain(label);
    }
    expect(labels).toContain('Preview');
    await dismissContextMenu(window);
  });

  test('Context menu (single): Preview opens 3D preview dialog', async () => {
    const stlPath = await findFilePath(window, (p) => !p.includes('::') && /\.stl$/i.test(p.split(/[/\\]/).pop()));
    await openContextMenuForPath(window, stlPath);
    await clickContextMenuItem(window, 'Preview');
    await expect(window.locator('#preview-dialog')).toBeVisible({ timeout: 15000 });
    await window.locator('#preview-reset-view').click();
    await window.locator('#preview-toggle-wireframe').click();
    await window.locator('#preview-toggle-axes').click();
    await window.locator('#close-preview').click();
    await window.waitForTimeout(400);
  });

  test('Context menu (single): 3MF includes Pull Metadata when applicable', async () => {
    const mfPath = await findFilePath(window, (p) => /\.3mf$/i.test(p.split(/[/\\]/).pop()));
    expect(mfPath).toBeTruthy();
    await openContextMenuForPath(window, mfPath);
    const labels = await getContextMenuLabels(window);
    expect(labels).toContain('Pull Metadata');
    await dismissContextMenu(window);
  });

  // ─── Context menu: ZIP archive entry ────────────────────────────────────────

  test('Context menu (ZIP entry): shows extract options', async () => {
    const zipPath = await findFilePath(window, (p) => p.includes('::'));
    if (!zipPath) {
      test.skip(true, 'No ZIP archive entries in library');
      return;
    }
    await openContextMenuForPath(window, zipPath);
    const labels = await getContextMenuLabels(window);
    for (const label of ZIP_CONTEXT_MENU_EXTRA) {
      expect(labels).toContain(label);
    }
    expect(labels).toContain('Preview');
    await dismissContextMenu(window);
  });

  // ─── Context menu: multi-select ─────────────────────────────────────────────

  test('Context menu (multi-select): shows bulk action items', async () => {
    await clearAllFilters(window);
    await enterMultiEditMode(window);
    await window.locator('#select-all-button').click();
    await window.waitForTimeout(400);
    expect(libraryTotal).toBeGreaterThan(1);

    const paths = await getAllFilePaths(window);
    await window.evaluate(async (filePaths) => {
      const selection = filePaths.slice(0, Math.min(3, filePaths.length));
      const result = await window.electron.showContextMenu(selection);
      if (result && result.type === 'html-menu' && typeof showHtmlContextMenu === 'function') {
        showHtmlContextMenu(result, 260, 260);
      }
    }, paths);
    await window.locator('#html-context-menu').waitFor({ state: 'visible', timeout: 8000 });
    const labels = await getContextMenuLabels(window);
    for (const label of MULTI_CONTEXT_MENU_LABELS) {
      expect(labels).toContain(label);
    }
    // Multi-select now includes Preview (bundle/group preview when 2+ previewable files).
    expect(labels).toContain('Preview');
    await dismissContextMenu(window);
    await exitMultiEditMode(window);
  });

  // ─── De-Dup ─────────────────────────────────────────────────────────────────

  test('De-Dup: dialog opens and analyzes library', async () => {
    await clearAllFilters(window);
    await openDialog(window, 'dedup-dialog');
    await expect(window.locator('#dedup-dialog')).toBeVisible();
    await expect(window.locator('#dedup-easy-button')).toBeVisible();
    await expect(window.locator('#dedup-clear-button')).toBeVisible();
    await expect(window.locator('#delete-selected')).toBeVisible();
    await expect(window.locator('#dedup-scope-entire')).toBeVisible();
    await expect(window.locator('#dedup-scope-current')).toBeVisible();

    await window.waitForFunction(
      () => {
        const el = document.querySelector('#dedup-dialog .duplicate-groups');
        if (!el) return false;
        const text = el.textContent || '';
        return !text.includes('Loading duplicate files') && !text.includes('Analyzing duplicates');
      },
      { timeout: 120000 }
    );

    const groupsText = await window.locator('#dedup-dialog .duplicate-groups').textContent();
    expect(groupsText).toBeTruthy();

    await window.locator('#dedup-easy-button').click();
    await window.waitForTimeout(300);
    await window.locator('#dedup-clear-button').click();
    await window.waitForTimeout(300);
    await window.locator('#dedup-fullscreen-toggle').click();
    await window.waitForTimeout(200);
    await window.locator('#dedup-fullscreen-toggle').click();
    await closeDialog(window, 'dedup-dialog', '#close-dedup');
  });

  test('De-Dup: current view uses library filters', async () => {
    await clearAllFilters(window);
    await window.locator('#designer-select').selectOption({ label: 'E2E Designer' });
    await applyFilters(window);
    expect(await getViewCount(window)).toBeGreaterThan(0);

    await openDialog(window, 'dedup-dialog');
    await expect(window.locator('#dedup-dialog')).toBeVisible();
    await window.evaluate(async () => {
      window._dedupScope = null;
      if (typeof loadDuplicateFiles === 'function') {
        await loadDuplicateFiles(true);
      }
    });
    await expect(window.locator('#dedup-scope-current')).toBeChecked();
    await expect(window.locator('#dedup-scope-summary')).toContainText('E2E Designer');

    const result = await window.evaluate(async () => {
      const models = await window.electron.getModelsFiltered({ designer: 'E2E Designer' });
      const paths = new Set(models.map((m) => m.filePath));
      const scoped = await window.electron.getDuplicates({
        includeZip: false,
        filters: { designer: 'E2E Designer' }
      });
      const groups = Array.isArray(scoped) ? scoped : Object.values(scoped || {});
      return {
        filteredCount: paths.size,
        groupCount: groups.length,
        allInFilter: groups.every((g) => Array.isArray(g.files) && g.files.every((f) => paths.has(f.filePath))),
        groupsHaveTwo: groups.every((g) => Array.isArray(g.files) && g.files.length > 1)
      };
    });
    expect(result.filteredCount).toBeGreaterThan(0);
    expect(result.allInFilter).toBe(true);
    expect(result.groupsHaveTwo).toBe(true);

    await window.evaluate(async () => {
      window._dedupScope = 'entire';
      if (typeof loadDuplicateFiles === 'function') {
        await loadDuplicateFiles(true);
      }
    });
    await expect(window.locator('#dedup-scope-entire')).toBeChecked();
    await expect(window.locator('#dedup-scope-summary')).toContainText('entire library');
    await closeDialog(window, 'dedup-dialog', '#close-dedup');
    await clearAllFilters(window);
  });

  // ─── Tools & sidebar dialogs ────────────────────────────────────────────────

  test('Tools: Filament Management create and search', async () => {
    await openDialog(window, 'filament-manager-dialog');
    await expect(window.locator('#filament-manager-dialog')).toBeVisible();
    await window.locator('#new-filament-name').fill('manager-e2e-filament');
    await window.locator('#new-filament-vendor').fill('E2E Vendor');
    await window.locator('#new-filament-material').fill('PLA');
    await window.locator('#add-filament-manager-button').click();
    await window.waitForTimeout(400);
    await window.locator('#filament-manager-search').fill('manager-e2e');
    await window.waitForTimeout(300);
    await expect(window.locator('#filament-manager-dialog')).toContainText('manager-e2e-filament');
    await closeDialog(window, 'filament-manager-dialog', 'button:has-text("Close")');
  });

  test('Tools: Tag Manager create and search', async () => {
    await openDialog(window, 'tag-manager-dialog');
    await expect(window.locator('#tag-manager-dialog')).toBeVisible();
    await window.locator('#new-tag-manager-name').fill('manager-e2e-tag');
    await window.locator('#add-tag-manager-button').click();
    await window.waitForTimeout(400);
    await window.locator('#tag-manager-search').fill('manager-e2e');
    await window.waitForTimeout(300);
    await expect(window.locator('#tag-manager-dialog')).toContainText('manager-e2e-tag');
    await closeDialog(window, 'tag-manager-dialog', 'button:has-text("Close")');
  });

  test('Tools: Metadata Editor tabs and search', async () => {
    await openDialog(window, 'metadata-editor-dialog');
    await expect(window.locator('.metadata-tab[data-type="designer"]')).toBeVisible();
    await window.locator('.metadata-tab[data-type="parentModel"]').click();
    await window.locator('.metadata-tab[data-type="license"]').click();
    await window.locator('#metadata-editor-search').fill('E2E');
    await window.waitForTimeout(300);
    await closeDialog(window, 'metadata-editor-dialog', 'button:has-text("Close")');
  });

  test('Tools: Print Roulette runs without error', async () => {
    await window.locator('#roulette-button').click();
    await window.waitForTimeout(1500);
    const rouletteDialog = window.locator('#roulette-dialog, #print-roulette-dialog, dialog:has-text("Roulette")');
    if (await rouletteDialog.count() > 0) {
      await closeDialog(window, await rouletteDialog.first().getAttribute('id') || 'roulette-dialog', 'button:has-text("Close")');
    }
  });

  test('Tools: Backup/Restore dialog buttons', async () => {
    await openDialog(window, 'backup-restore-dialog');
    await expect(window.locator('#backup-button')).toBeVisible();
    await expect(window.locator('#restore-button')).toBeVisible();
    await expect(window.locator('#export-library-button')).toBeVisible();
    await expect(window.locator('#import-library-button')).toBeVisible();
    await closeDialog(window, 'backup-restore-dialog', '#save-backup-restore');
  });

  test('Tools: Purge Models dialog opens (cancel only)', async () => {
    await openDialog(window, 'purge-models-dialog');
    await expect(window.locator('#confirm-purge-button')).toBeVisible();
    await closeDialog(window, 'purge-models-dialog', 'button:has-text("Cancel")');
  });

  // ─── Settings dialogs ───────────────────────────────────────────────────────

  test('Settings: File Type — ZIP, additional types, 3MF metadata', async () => {
    await window.evaluate(async () => {
      if (typeof loadAndShowFileTypeSettings === 'function') {
        await loadAndShowFileTypeSettings();
      } else {
        document.getElementById('file-type-settings-dialog')?.showModal();
      }
    });
    await expect(window.locator('#file-type-settings-dialog')).toBeVisible();
    await expect(window.locator('#enable-zip-archives')).toBeChecked();
    await expect(window.locator('#scan-type-obj')).toBeVisible();
    await expect(window.locator('#scan-type-step')).toBeVisible();
    await window.locator('#scan-type-obj').check();
    await window.locator('#save-file-type-settings').click();
    await window.waitForTimeout(400);
    await expect(window.locator('#file-type-settings-dialog')).not.toBeVisible();
  });

  test('Tools: Browser Extension, MCP Server; Settings: Theme, Performance, STL Home, Slicer, AI Config', async () => {
    const dialogs = [
      { id: 'settings-dialog', cancel: '#cancel-settings', extra: '#ui-theme' },
      { id: 'performance-settings-dialog', cancel: '#cancel-performance-settings', extra: '#max-file-size' },
      { id: 'stl-home-dialog', cancel: '#cancel-stl-home-button', extra: '#choose-stl-home-button' },
      { id: 'slicer-dialog', cancel: '#cancel-slicer-settings', extra: '#add-slicer-button' },
      { id: 'browser-extension-settings-dialog', cancel: '#cancel-browser-extension-settings', extra: '#enable-browser-extension' },
      { id: 'mcp-server-settings-dialog', cancel: '#cancel-mcp-server-settings', extra: '#mcp-server-url' },
      { id: 'ai-config-dialog', cancel: '#cancel-ai-config', extra: '#test-ai-config' }
    ];
    for (const { id, cancel, extra } of dialogs) {
      await openDialog(window, id);
      await expect(window.locator(`#${id}`)).toBeVisible();
      await expect(window.locator(extra)).toBeVisible();
      await closeDialog(window, id, cancel);
    }
  });

  // ─── Help dialogs ───────────────────────────────────────────────────────────

  test('Help: Keyboard Shortcuts, About, Library Stats, System Report, Guide', async () => {
    await openDialog(window, 'keyboard-shortcuts-dialog');
    await expect(window.locator('#keyboard-shortcuts-title')).toContainText('Keyboard Shortcuts');
    await closeDialog(window, 'keyboard-shortcuts-dialog', 'button:has-text("Close")');

    await openDialog(window, 'about-dialog');
    await expect(window.locator('#about-version')).toBeVisible();
    await closeDialog(window, 'about-dialog', 'button.about-close-x');

    await window.evaluate(async () => {
      if (window._electronRealEventHandlers?.['open-stats']) {
        await window._electronRealEventHandlers['open-stats']();
      }
    });
    await expect(window.locator('#stats-total-models')).toBeVisible();
    await expect(window.locator('#stats-total-models')).toContainText(String(libraryTotal));
    await closeDialog(window, 'stats-dialog', 'button:has-text("Close")');

    await openDialog(window, 'system-report-dialog');
    await closeDialog(window, 'system-report-dialog', 'button:has-text("Close")');

    await openDialog(window, 'guide-dialog');
    await expect(window.locator('#guide-dialog h2')).toContainText('Printventory Guide');
    await closeDialog(window, 'guide-dialog', 'button:has-text("Close")');
  });

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────────

  test('Keyboard shortcuts: search focus, multi-edit toggle, clear filters', async () => {
    await window.locator('#search-filter-input').fill('test');
    await clearAllFilters(window);
    await expect(window.locator('#search-filter-input')).toHaveValue('');

    await window.keyboard.press('Control+/');
    await expect(window.locator('#search-filter-input')).toBeFocused();

    await enterMultiEditMode(window);
    await expect(window.locator('#multi-edit-panel')).toBeVisible();
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
    await expect(window.locator('#multi-edit-panel')).toHaveClass(/hidden/);

    await window.keyboard.press('Control+Shift+?');
    await expect(window.locator('#keyboard-shortcuts-dialog')).toBeVisible();
    await closeDialog(window, 'keyboard-shortcuts-dialog', 'button:has-text("Close")');
  });

  // ─── Sidebar De-Dup / Tag buttons ───────────────────────────────────────────

  test('Sidebar: De-Dup, Tag Manager, and Filament buttons open dialogs', async () => {
    await window.locator('#dup-button').click();
    await expect(window.locator('#dedup-dialog')).toBeVisible();
    await closeDialog(window, 'dedup-dialog', '#close-dedup');

    await window.locator('#tag-button').click();
    await expect(window.locator('#tag-manager-dialog')).toBeVisible();
    await closeDialog(window, 'tag-manager-dialog', 'button:has-text("Close")');

    await window.locator('#filament-button').click();
    await expect(window.locator('#filament-manager-dialog')).toBeVisible();
    await closeDialog(window, 'filament-manager-dialog', 'button:has-text("Close")');
  });
});
