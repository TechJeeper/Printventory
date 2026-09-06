/**
 * Printventory feature tests for Cline / Playwright.
 * See CLINE_TESTING.md for the full manual test checklist and selectors.
 * Run: npm test
 * Flow: terms → welcome → quick start → scan (C:\temp desktop / /test server-docker).
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const { getElectronLaunchOptions, cleanTestArtifacts, dismissOnboarding, acceptTerms } = require('./test-utils');

let app;
let window;

test.describe('Printventory features', () => {
  test.beforeAll(async () => {
    cleanTestArtifacts();
    app = await electron.launch(getElectronLaunchOptions());
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await acceptTerms(window);
    await dismissOnboarding(window);

    const scanButton = window.locator('#scan-directory-button');
    await expect(scanButton).toBeVisible();
    await scanButton.click();
    await expect(scanButton).toBeEnabled({ timeout: 120000 });
    await window.waitForTimeout(500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('Buttons: sidebar action buttons are visible', async () => {
    await expect(window.locator('#scan-directory-button')).toBeVisible();
    await expect(window.locator('#view-library-button')).toBeVisible();
    await expect(window.locator('#dup-button')).toBeVisible();
    await expect(window.locator('#tag-button')).toBeVisible();
    await expect(window.locator('#filament-button')).toBeVisible();
    await expect(window.locator('#roulette-button')).toBeVisible();
  });

  test('Sorting: sort dropdown exists and has options', async () => {
    const sortSelect = window.locator('#sort-select');
    await expect(sortSelect).toBeVisible();
    await expect(sortSelect.locator('option[value="name-asc"]')).toHaveCount(1);
    await expect(sortSelect.locator('option[value="date-desc"]')).toHaveCount(1);
  });

  test('Filtering: pinned search/folders and collapsible extra filters', async () => {
    await expect(window.locator('#search-filter-input')).toBeVisible();
    await expect(window.locator('#folder-select')).toBeVisible();
    await expect(window.locator('#filter-stack-toggle')).toBeVisible();
    await expect(window.locator('#designer-select')).toBeHidden();
    await window.locator('#filter-stack-toggle').click();
    await expect(window.locator('#designer-select')).toBeVisible();
    await expect(window.locator('#printed-select')).toBeVisible();
    await expect(window.locator('#tag-filter')).toBeVisible();
    await expect(window.locator('#filament-filter')).toBeVisible();
    await expect(window.locator('#invert-filter-button')).toBeVisible();
    const invertClipped = await window.evaluate(() => {
      const btn = document.getElementById('invert-filter-button');
      const sidebar = document.querySelector('.sidebar');
      if (!btn || !sidebar) return true;
      btn.scrollIntoView({ block: 'end' });
      const br = btn.getBoundingClientRect();
      const sr = sidebar.getBoundingClientRect();
      return br.bottom > sr.bottom + 1 || br.bottom > window.innerHeight + 1;
    });
    expect(invertClipped).toBe(false);
  });

  test('Folders: popover tree opens from the Folders control', async () => {
    await expect(window.locator('#folder-rail-toggle')).toBeVisible();
    await expect(window.locator('#sidebar-resize-handle')).toBeVisible();
    await window.locator('#folder-tree-button').click();
    await expect(window.locator('#folder-tree-popover')).toBeVisible();
    await expect(window.locator('#folder-tree-resize-handle')).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(window.locator('#folder-tree-popover')).toBeHidden();
  });

  test('View modes: view selector has List, Preview, Detailed', async () => {
    await expect(window.locator('.view-button[data-view="list"]')).toBeVisible();
    await expect(window.locator('.view-button[data-view="preview"]')).toBeVisible();
    await expect(window.locator('.view-button[data-view="detailed"]')).toBeVisible();
  });

  test('Multi-Edit: toggle exists and panel can be shown', async () => {
    await expect(window.locator('#edit-mode-toggle')).toBeAttached();
    await window.keyboard.press('Control+e');
    await window.waitForTimeout(300);
    await expect(window.locator('#multi-edit-panel')).toBeVisible();
    await expect(window.locator('#exit-multi-edit-button')).toBeVisible();
    await window.locator('#exit-multi-edit-button').click();
  });

  test('Dialogs: Help → Keyboard Shortcuts opens dialog', async () => {
    await window.evaluate(() => {
      const dialog = document.getElementById('keyboard-shortcuts-dialog');
      if (dialog) dialog.showModal();
    });
    await expect(window.locator('#keyboard-shortcuts-dialog')).toBeVisible();
    await expect(window.locator('#keyboard-shortcuts-title')).toContainText('Keyboard Shortcuts');
    await window.locator('#keyboard-shortcuts-dialog button:has-text("Close")').click();
  });
});
