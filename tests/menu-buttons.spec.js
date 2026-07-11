/**
 * Test scan then open every menu dialog and check every button.
 * Flow: terms → welcome → quick start → scan (C:\temp / /test) → then each menu item.
 * Run: npm test
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const { getElectronLaunchOptions, cleanTestArtifacts, dismissOnboarding, acceptTerms, scrollSidebarToTop } = require('./test-utils');

let app;
let window;

async function openDialog(dialogId) {
  await window.evaluate((id) => {
    const d = document.getElementById(id);
    if (d) d.showModal();
  }, dialogId);
}

async function closeDialog(dialogId, closeSelector = 'button:has-text("Cancel"), button:has-text("Close")') {
  const closeBtn = window.locator(`#${dialogId}`).locator(closeSelector).first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
  } else {
    await window.evaluate((id) => document.getElementById(id)?.close(), dialogId);
  }
  await window.waitForTimeout(200);
}

test.describe('Scan then menu and button checks', () => {
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

  test('Sidebar: every main button visible', async () => {
    await scrollSidebarToTop(window);
    await expect(window.locator('#scan-directory-button')).toBeVisible();
    await expect(window.locator('#view-library-button')).toBeVisible();
    await expect(window.locator('#dup-button')).toBeVisible();
    await expect(window.locator('#tag-button')).toBeVisible();
    await expect(window.locator('#roulette-button')).toBeVisible();
    await expect(window.locator('#edit-mode-toggle')).toBeAttached();
    await expect(window.locator('#filter-search-button')).toBeVisible();
    await expect(window.locator('#clear-filter-search-button')).toBeAttached();
    await expect(window.locator('#invert-filter-button')).toBeAttached();
  });

  test('Sidebar: sort and filter controls', async () => {
    await expect(window.locator('#sort-select')).toBeVisible();
    await expect(window.locator('#designer-select')).toBeVisible();
    await expect(window.locator('#parent-select')).toBeVisible();
    await expect(window.locator('#license-select')).toBeVisible();
    await expect(window.locator('#printed-select')).toBeVisible();
    await expect(window.locator('#filetype-select')).toBeVisible();
    await expect(window.locator('#tag-filter')).toBeVisible();
  });

  test('Settings > Theme: dialog and buttons', async () => {
    await openDialog('settings-dialog');
    await expect(window.locator('#settings-dialog')).toBeVisible();
    await expect(window.locator('#save-settings')).toBeVisible();
    await expect(window.locator('#cancel-settings')).toBeVisible();
    await expect(window.locator('#ui-theme')).toBeVisible();
    await expect(window.locator('#model-background-color')).toBeVisible();
    await closeDialog('settings-dialog', 'button#cancel-settings');
  });

  test('Settings > File Type: dialog and buttons', async () => {
    await openDialog('file-type-settings-dialog');
    await expect(window.locator('#file-type-settings-dialog')).toBeVisible();
    await expect(window.locator('#save-file-type-settings')).toBeVisible();
    await expect(window.locator('#cancel-file-type-settings')).toBeVisible();
    await expect(window.locator('#enable-zip-archives')).toBeVisible();
    await closeDialog('file-type-settings-dialog', 'button#cancel-file-type-settings');
  });

  test('Settings > Performance: dialog and buttons', async () => {
    await openDialog('performance-settings-dialog');
    await expect(window.locator('#performance-settings-dialog')).toBeVisible();
    await expect(window.locator('#save-performance-settings')).toBeVisible();
    await expect(window.locator('#cancel-performance-settings')).toBeVisible();
    await expect(window.locator('#max-file-size')).toBeVisible();
    await closeDialog('performance-settings-dialog', 'button#cancel-performance-settings');
  });

  test('Settings > Slicer Path: dialog and buttons', async () => {
    await openDialog('slicer-dialog');
    await expect(window.locator('#slicer-dialog')).toBeVisible();
    await expect(window.locator('#save-slicer-settings')).toBeVisible();
    await expect(window.locator('#cancel-slicer-settings')).toBeVisible();
    await expect(window.locator('#add-slicer-button')).toBeVisible();
    await closeDialog('slicer-dialog', 'button#cancel-slicer-settings');
  });

  test('Settings > STL Home: dialog and buttons', async () => {
    await openDialog('stl-home-dialog');
    await expect(window.locator('#stl-home-dialog')).toBeVisible();
    await expect(window.locator('#save-stl-home-button')).toBeVisible();
    await expect(window.locator('#cancel-stl-home-button')).toBeVisible();
    await expect(window.locator('#choose-stl-home-button')).toBeVisible();
    await expect(window.locator('#clear-stl-home-button')).toBeVisible();
    await closeDialog('stl-home-dialog', 'button#cancel-stl-home-button');
  });

  test('Settings > Browser Extension: dialog and buttons', async () => {
    await openDialog('browser-extension-settings-dialog');
    await expect(window.locator('#browser-extension-settings-dialog')).toBeVisible();
    await expect(window.locator('#save-browser-extension-settings')).toBeVisible();
    await expect(window.locator('#cancel-browser-extension-settings')).toBeVisible();
    await expect(window.locator('#enable-browser-extension')).toBeVisible();
    await closeDialog('browser-extension-settings-dialog', 'button#cancel-browser-extension-settings');
  });

  test('Settings > AI Config: dialog and buttons', async () => {
    await openDialog('ai-config-dialog');
    await expect(window.locator('#ai-config-dialog')).toBeVisible();
    await expect(window.locator('#save-ai-config')).toBeVisible();
    await expect(window.locator('#cancel-ai-config')).toBeVisible();
    await expect(window.locator('#test-ai-config')).toBeVisible();
    await expect(window.locator('#ai-api-key')).toBeVisible();
    await expect(window.locator('#ai-model')).toBeVisible();
    await closeDialog('ai-config-dialog', 'button#cancel-ai-config');
  });

  test('Tools > De-Dup: dialog and buttons', async () => {
    await openDialog('dedup-dialog');
    await expect(window.locator('#dedup-dialog')).toBeVisible();
    await expect(window.locator('#dedup-easy-button')).toBeVisible();
    await expect(window.locator('#dedup-clear-button')).toBeVisible();
    await expect(window.locator('#delete-selected')).toBeVisible();
    await expect(window.locator('#close-dedup')).toBeVisible();
    await closeDialog('dedup-dialog', 'button#close-dedup');
  });

  test('Tools > Tag Manager: dialog and buttons', async () => {
    await openDialog('tag-manager-dialog');
    await expect(window.locator('#tag-manager-dialog')).toBeVisible();
    await expect(window.locator('#add-tag-manager-button')).toBeVisible();
    await expect(window.locator('#tag-manager-search')).toBeVisible();
    await expect(window.locator('#clear-tag-search')).toBeVisible();
    await expect(window.locator('#tag-manager-fullscreen-toggle')).toBeVisible();
    await closeDialog('tag-manager-dialog', 'button:has-text("Close")');
  });

  test('Tools > Metadata Editor: dialog and buttons', async () => {
    await openDialog('metadata-editor-dialog');
    await expect(window.locator('#metadata-editor-dialog')).toBeVisible();
    await expect(window.locator('.metadata-tab[data-type="designer"]')).toBeVisible();
    await expect(window.locator('.metadata-tab[data-type="parentModel"]')).toBeVisible();
    await expect(window.locator('.metadata-tab[data-type="license"]')).toBeVisible();
    await expect(window.locator('#metadata-editor-search')).toBeVisible();
    await expect(window.locator('#clear-metadata-search')).toBeVisible();
    await closeDialog('metadata-editor-dialog', 'button:has-text("Close")');
  });

  test('Tools > Backup/Restore: dialog and buttons', async () => {
    await openDialog('backup-restore-dialog');
    await expect(window.locator('#backup-restore-dialog')).toBeVisible();
    await expect(window.locator('#backup-button')).toBeVisible();
    await expect(window.locator('#restore-button')).toBeVisible();
    await expect(window.locator('#export-library-button')).toBeVisible();
    await expect(window.locator('#import-library-button')).toBeVisible();
    await expect(window.locator('#save-backup-restore')).toBeVisible();
    await closeDialog('backup-restore-dialog', 'button#save-backup-restore');
  });

  test('Tools > Purge Models: dialog and buttons', async () => {
    await openDialog('purge-models-dialog');
    await expect(window.locator('#purge-models-dialog')).toBeVisible();
    await expect(window.locator('#confirm-purge-button')).toBeVisible();
    await closeDialog('purge-models-dialog', 'button:has-text("Cancel")');
  });

  test('Help > Keyboard Shortcuts: dialog and buttons', async () => {
    await openDialog('keyboard-shortcuts-dialog');
    await expect(window.locator('#keyboard-shortcuts-dialog')).toBeVisible();
    await expect(window.locator('#keyboard-shortcuts-title')).toContainText('Keyboard Shortcuts');
    await closeDialog('keyboard-shortcuts-dialog', 'button:has-text("Close")');
  });

  test('Help > About: dialog and buttons', async () => {
    await openDialog('about-dialog');
    await expect(window.locator('#about-dialog')).toBeVisible();
    await expect(window.locator('#about-version')).toBeVisible();
    await expect(window.locator('.about-close-x')).toBeVisible();
    await closeDialog('about-dialog', 'button.about-close-x');
  });

  test('Help > Library Stats: dialog and buttons', async () => {
    await openDialog('stats-dialog');
    await expect(window.locator('#stats-dialog')).toBeVisible();
    await expect(window.locator('#stats-total-models')).toBeVisible();
    await closeDialog('stats-dialog', 'button:has-text("Close")');
  });

  test('Help > System Report: dialog and buttons', async () => {
    await openDialog('system-report-dialog');
    await expect(window.locator('#system-report-dialog')).toBeVisible();
    await closeDialog('system-report-dialog', 'button:has-text("Close")');
  });

  test('Help > Guide (static): dialog and Close button', async () => {
    await openDialog('guide-dialog');
    await expect(window.locator('#guide-dialog')).toBeVisible();
    await expect(window.locator('#guide-dialog h2')).toContainText('Printventory Guide');
    await closeDialog('guide-dialog', 'button:has-text("Close")');
  });

  test('View mode buttons', async () => {
    await expect(window.locator('.view-button[data-view="detailed"]')).toBeVisible();
    await expect(window.locator('.view-button[data-view="preview"]')).toBeVisible();
    await expect(window.locator('.view-button[data-view="list"]')).toBeVisible();
  });

  test('Multi-edit panel buttons', async () => {
    await window.keyboard.press('Control+e');
    await window.waitForTimeout(300);
    await expect(window.locator('#multi-edit-panel')).toBeVisible();
    await expect(window.locator('#exit-multi-edit-button')).toBeVisible();
    await expect(window.locator('#select-all-button')).toBeVisible();
    await expect(window.locator('#clear-selection-button')).toBeVisible();
    await expect(window.locator('#multi-save-button')).toBeAttached();
    await window.locator('#exit-multi-edit-button').click();
  });

  test('Context menu: right-click model shows menu with all expected items', async () => {
    const firstModel = window.locator('.file-item').first();
    await expect(firstModel).toBeVisible({ timeout: 10000 });
    await firstModel.click({ button: 'right', position: { x: 10, y: 10 } });
    const menu = window.locator('#html-context-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    const expectedLabels = [
      'Preview',
      'Open File',
      'Open Directory',
      'Add Image',
      'Manage Thumbnails',
      'Move',
      'Remove from Library',
      'Delete from Disk'
    ];
    for (const label of expectedLabels) {
      await expect(menu).toContainText(label);
    }
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
  });
});
