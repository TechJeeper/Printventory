/**
 * Tests for model metadata (designer, parent, license, source, notes) and tags.
 * Covers adding new values, applying existing values, in both single-edit and multi-edit.
 * Assumes test-fixtures/scan-me has cube.stl and test.stl.
 * Run: npm test -- metadata-tags.spec.js
 * Note: Close any running Printventory instance first (single-instance lock).
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const { getElectronLaunchOptions, cleanTestArtifacts, dismissOnboarding, acceptTerms, runDirectoryScan } = require('./test-utils');

let app;
let window;

async function ensureGridLoaded() {
  await window.evaluate(async () => {
    if (typeof window.performCombinedSearch === 'function') await window.performCombinedSearch();
  });
  await window.waitForFunction(
    (n) => {
      const el = document.getElementById('view-count');
      if (!el) return false;
      const m = el.textContent.match(/(\d+)\s+model/);
      return m ? parseInt(m[1], 10) >= n : false;
    },
    2,
    { timeout: 15000 }
  );
}

/** Click first model in grid and wait for single-edit details panel. */
async function openFirstModelDetails() {
  const firstItem = window.locator('.file-grid .file-item').first();
  await firstItem.click();
  await expect(window.locator('#model-details')).not.toHaveClass(/hidden/);
  await expect(window.locator('#model-name')).toBeVisible({ timeout: 5000 });
  await window.waitForTimeout(300);
}

/** Get file path of the first model in the grid (for IPC verification). */
async function getFirstModelPath() {
  return await window.locator('.file-grid .file-item').first().getAttribute('data-filepath');
}

/** Get file path of the Nth model (1-based). */
async function getNthModelPath(n) {
  return await window.locator('.file-grid .file-item').nth(n - 1).getAttribute('data-filepath');
}

/** Get model data from main process via renderer. */
async function getModelData(filePath) {
  return await window.evaluate(async (path) => {
    return await window.electron.getModel(path);
  }, filePath);
}

test.describe('Metadata and tags', () => {
  test.beforeAll(async () => {
    cleanTestArtifacts();
    app = await electron.launch(getElectronLaunchOptions());
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await acceptTerms(window);
    await dismissOnboarding(window);
    await runDirectoryScan(window, 300000, 2);
    await ensureGridLoaded();
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  // --- Single-edit: add new values ---
  test('Single-edit: add new designer and save', async () => {
    await openFirstModelDetails();
    await window.locator('#add-new-designer-button').click();
    await expect(window.locator('#new-designer-dialog')).toBeVisible();
    await window.locator('#new-designer-name').fill('TestDesigner');
    await window.locator('#add-designer-button').click();
    await window.waitForTimeout(300);
    await expect(window.locator('#model-designer')).toHaveValue('TestDesigner');
    await window.locator('#save-model-button').click();
    await window.waitForTimeout(500);
    const filePath = await getFirstModelPath();
    const model = await getModelData(filePath);
    expect(model).toBeTruthy();
    expect(model.designer).toBe('TestDesigner');
  });

  test('Single-edit: apply existing designer to another model', async () => {
    await window.locator('.file-grid .file-item').nth(1).click();
    await expect(window.locator('#model-details')).not.toHaveClass(/hidden/);
    await window.waitForTimeout(200);
    await window.locator('#model-designer').selectOption({ label: 'TestDesigner' });
    await window.locator('#save-model-button').click();
    await window.waitForTimeout(500);
    const filePath = await getNthModelPath(2);
    const model = await getModelData(filePath);
    expect(model.designer).toBe('TestDesigner');
  });

  test('Single-edit: add new parent model and save', async () => {
    await openFirstModelDetails();
    await window.locator('#add-new-parent-button').click();
    await expect(window.locator('#new-parent-dialog')).toBeVisible();
    await window.locator('#new-parent-name').fill('TestParent');
    await window.locator('#add-parent-button').click();
    await window.waitForTimeout(300);
    await expect(window.locator('#model-parent')).toHaveValue('TestParent');
    await window.locator('#save-model-button').click();
    await window.waitForTimeout(500);
    const filePath = await getFirstModelPath();
    const model = await getModelData(filePath);
    expect(model.parentModel).toBe('TestParent');
  });

  test('Single-edit: apply existing parent model', async () => {
    await window.locator('.file-grid .file-item').nth(1).click();
    await expect(window.locator('#model-details')).not.toHaveClass(/hidden/);
    await window.waitForTimeout(200);
    await window.locator('#model-parent').selectOption({ label: 'TestParent' });
    await window.locator('#save-model-button').click();
    await window.waitForTimeout(500);
    const filePath = await getNthModelPath(2);
    const model = await getModelData(filePath);
    expect(model.parentModel).toBe('TestParent');
  });

  test('Single-edit: add new license and save', async () => {
    await openFirstModelDetails();
    await window.locator('#add-new-license-button').click();
    await expect(window.locator('#new-license-dialog')).toBeVisible();
    await window.locator('#new-license-name').fill('MIT');
    await window.locator('#add-license-button').click();
    await window.waitForTimeout(300);
    await expect(window.locator('#model-license')).toHaveValue('MIT');
    await window.locator('#save-model-button').click();
    await window.waitForTimeout(500);
    const filePath = await getFirstModelPath();
    const model = await getModelData(filePath);
    expect(model.license).toBe('MIT');
  });

  test('Single-edit: apply existing license', async () => {
    await window.locator('.file-grid .file-item').nth(1).click();
    await expect(window.locator('#model-details')).not.toHaveClass(/hidden/);
    await window.waitForTimeout(200);
    await window.locator('#model-license').selectOption({ label: 'MIT' });
    await window.locator('#save-model-button').click();
    await window.waitForTimeout(500);
    const filePath = await getNthModelPath(2);
    const model = await getModelData(filePath);
    expect(model.license).toBe('MIT');
  });

  test('Single-edit: set source and notes and save', async () => {
    await openFirstModelDetails();
    await window.locator('#model-source').fill('https://example.com/model');
    await window.locator('#model-notes').fill('Test notes here');
    await window.locator('#save-model-button').click();
    await window.waitForTimeout(500);
    const filePath = await getFirstModelPath();
    const model = await getModelData(filePath);
    expect(model.source).toBe('https://example.com/model');
    expect(model.notes).toBe('Test notes here');
  });

  test('Single-edit: add new tag via dialog and verify', async () => {
    await openFirstModelDetails();
    await window.locator('#add-tag-button').click();
    await expect(window.locator('#new-tag-dialog')).toBeVisible();
    await window.locator('#new-tag-name').fill('single-tag');
    await window.locator('#add-tag-submit').click();
    await window.waitForTimeout(500);
    await expect(window.locator('#model-tags')).toContainText('single-tag');
    const filePath = await getFirstModelPath();
    const model = await getModelData(filePath);
    const tagNames = (model.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
    expect(tagNames).toContain('single-tag');
  });

  test('Single-edit: apply existing tag from dropdown', async () => {
    await window.locator('.file-grid .file-item').nth(1).click();
    await expect(window.locator('#model-details')).not.toHaveClass(/hidden/);
    await window.waitForTimeout(200);
    await window.locator('#tag-select').selectOption({ label: 'single-tag' });
    await window.waitForTimeout(400);
    await expect(window.locator('#model-tags')).toContainText('single-tag');
    const filePath = await getNthModelPath(2);
    const model = await getModelData(filePath);
    const tagNames = (model.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
    expect(tagNames).toContain('single-tag');
  });

  test('Single-edit: apply existing tag from List dialog', async () => {
    await openFirstModelDetails();
    await window.locator('#add-tag-button').click();
    await expect(window.locator('#new-tag-dialog')).toBeVisible();
    await window.locator('#new-tag-name').fill('list-tag');
    await window.locator('#add-tag-submit').click();
    await window.waitForTimeout(400);
    await window.locator('.file-grid .file-item').nth(1).click();
    await expect(window.locator('#model-details')).not.toHaveClass(/hidden/);
    await window.waitForTimeout(200);
    await window.locator('.list-button[data-field="tag"][data-target="tag-select"]').click();
    await expect(window.locator('#searchable-list-dialog')).toBeVisible();
    await window.locator('#searchable-list-items li', { hasText: /^list-tag$/ }).click();
    await expect(window.locator('#searchable-list-dialog')).toBeHidden();
    await expect(window.locator('#model-tags')).toContainText('list-tag');
    const listFilePath = await getNthModelPath(2);
    const listModel = await getModelData(listFilePath);
    const listTagNames = (listModel.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
    expect(listTagNames).toContain('list-tag');
  });

  // --- Multi-edit: metadata and tags ---
  test('Multi-edit: enter mode and select all', async () => {
    await window.keyboard.press('Control+e');
    await window.waitForTimeout(400);
    await expect(window.locator('#multi-edit-panel')).not.toHaveClass(/hidden/);
    await window.locator('#select-all-button').click();
    await window.waitForTimeout(300);
    await expect(window.locator('.selected-count')).toContainText('2');
  });

  test('Multi-edit: set designer and save applies to all', async () => {
    await window.locator('#multi-designer').selectOption({ label: 'TestDesigner' });
    await window.locator('#multi-save-button').click();
    await window.waitForTimeout(600);
    const path1 = await getNthModelPath(1);
    const path2 = await getNthModelPath(2);
    const m1 = await getModelData(path1);
    const m2 = await getModelData(path2);
    expect(m1.designer).toBe('TestDesigner');
    expect(m2.designer).toBe('TestDesigner');
  });

  test('Multi-edit: set source and save applies to all', async () => {
    await window.keyboard.press('Control+e');
    await window.waitForTimeout(300);
    await window.locator('#select-all-button').click();
    await window.waitForTimeout(200);
    await window.locator('#multi-source').fill('https://multi.example.com');
    await window.locator('#multi-save-button').click();
    await window.waitForTimeout(600);
    const path1 = await getNthModelPath(1);
    const path2 = await getNthModelPath(2);
    const m1 = await getModelData(path1);
    const m2 = await getModelData(path2);
    expect(m1.source).toBe('https://multi.example.com');
    expect(m2.source).toBe('https://multi.example.com');
  });

  test('Multi-edit: add existing tag to selection (auto-save)', async () => {
    await window.keyboard.press('Control+e');
    await window.waitForTimeout(300);
    await window.locator('#select-all-button').click();
    await window.waitForTimeout(200);
    await window.locator('#multi-tag-select').selectOption({ label: 'single-tag' });
    await window.waitForTimeout(600);
    const path1 = await getNthModelPath(1);
    const path2 = await getNthModelPath(2);
    const m1 = await getModelData(path1);
    const m2 = await getModelData(path2);
    const tags1 = (m1.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
    const tags2 = (m2.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
    expect(tags1).toContain('single-tag');
    expect(tags2).toContain('single-tag');
  });

  test('Multi-edit: add new tag via dialog and apply', async () => {
    await window.keyboard.press('Control+e');
    await window.waitForTimeout(300);
    await window.locator('#select-all-button').click();
    await window.waitForTimeout(200);
    await window.locator('#multi-edit-panel').locator('.add-tag-button').click();
    await expect(window.locator('#new-tag-dialog')).toBeVisible();
    await window.locator('#new-tag-name').fill('multi-tag');
    await window.locator('#add-tag-submit').click();
    await window.waitForTimeout(600);
    const path1 = await getNthModelPath(1);
    const m1 = await getModelData(path1);
    const tagNames = (m1.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
    expect(tagNames).toContain('multi-tag');
  });

  test('Multi-edit: set license and parent then save', async () => {
    await window.keyboard.press('Control+e');
    await window.waitForTimeout(300);
    await window.locator('#select-all-button').click();
    await window.waitForTimeout(200);
    await window.locator('#multi-license').selectOption({ label: 'MIT' });
    await window.locator('#multi-parent').selectOption({ label: 'TestParent' });
    await window.locator('#multi-save-button').click();
    await window.waitForTimeout(600);
    const path1 = await getNthModelPath(1);
    const m1 = await getModelData(path1);
    expect(m1.license).toBe('MIT');
    expect(m1.parentModel).toBe('TestParent');
  });

  test('Multi-edit: exit and confirm panel hidden', async () => {
    await window.locator('#exit-multi-edit-button').click();
    await window.waitForTimeout(300);
    await expect(window.locator('#multi-edit-panel')).toHaveClass(/hidden/);
  });
});
