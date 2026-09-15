/**
 * Archive (ZIP parent) tagging: tags applied on the bundle details panel
 * are saved onto every child model in the archive.
 * Run: npm test -- bundle-tags.spec.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const fflate = require('fflate');
const { test, expect, _electron: electron } = require('@playwright/test');
const {
  getElectronLaunchOptions,
  cleanTestArtifacts,
  dismissOnboarding,
  acceptTerms,
  enableZipArchives,
  runDirectoryScan
} = require('./test-utils');

const CUBE = path.join(__dirname, 'test-fixtures', 'scan-me', 'cube.stl');
const OTHER = path.join(__dirname, 'test-fixtures', 'scan-me', 'test.stl');

let app;
let window;
let scanDir;

function writeArchiveFixture() {
  scanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-bundle-tags-'));
  const zipBuf = Buffer.from(fflate.zipSync({
    'cube.stl': new Uint8Array(fs.readFileSync(CUBE)),
    'test.stl': new Uint8Array(fs.readFileSync(OTHER))
  }));
  fs.writeFileSync(path.join(scanDir, 'kit.zip'), zipBuf);
}

async function getArchiveChildPaths() {
  return await window.evaluate(() => {
    const models = document.querySelector('.file-grid')?.currentModels || [];
    return models
      .map((m) => m && m.filePath)
      .filter((p) => typeof p === 'string' && p.includes('::'));
  });
}

async function getModelTagNames(filePath) {
  return await window.evaluate(async (p) => {
    const model = await window.electron.getModel(p);
    return (model?.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
  }, filePath);
}

test.describe('Archive tagging', () => {
  test.beforeAll(async () => {
    writeArchiveFixture();
    cleanTestArtifacts();
    app = await electron.launch(getElectronLaunchOptions({
      PRINTVENTORY_TEST_SCAN_PATH: scanDir
    }));
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await acceptTerms(window);
    await dismissOnboarding(window);
    await enableZipArchives(window);
    await runDirectoryScan(window, 180000, 2);
  });

  test.afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(scanDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('Bundle details: add and remove a tag on all archive models', async () => {
    const group = window.locator('.file-grid .parent-model-group').first();
    await expect(group).toBeVisible({ timeout: 15000 });
    await group.click();

    const panel = window.locator('#bundle-details');
    await expect(panel).not.toHaveClass(/hidden/);
    await expect(window.locator('#bundle-tag-select')).toBeVisible();

    await window.locator('#bundle-details .add-tag-button').click();
    await expect(window.locator('#new-tag-dialog')).toBeVisible();
    await window.locator('#new-tag-name').fill('archive-tag');
    await window.locator('#add-tag-submit').click();
    await expect(window.locator('#bundle-tags')).toContainText('archive-tag');

    const childPaths = await getArchiveChildPaths();
    expect(childPaths.length).toBeGreaterThanOrEqual(2);
    for (const filePath of childPaths) {
      const tags = await getModelTagNames(filePath);
      expect(tags).toContain('archive-tag');
    }

    await window.locator('#bundle-tags .tag[data-tag-name="archive-tag"] .tag-remove').click();
    await expect(window.locator('#bundle-tags .tag[data-tag-name="archive-tag"]')).toHaveCount(0);

    for (const filePath of childPaths) {
      const tags = await getModelTagNames(filePath);
      expect(tags).not.toContain('archive-tag');
    }
  });

  test('Archive group: clicking the header again collapses it', async () => {
    const group = window.locator('.file-grid .parent-model-group').first();
    await expect(group).toBeVisible({ timeout: 15000 });
    if ((await group.getAttribute('aria-expanded')) !== 'true') {
      await group.click();
    }
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect(window.locator('#bundle-details')).not.toHaveClass(/hidden/);

    await window.locator('.file-grid .parent-model-group').first().click();
    await expect(window.locator('.file-grid .parent-model-group').first()).toHaveAttribute('aria-expanded', 'false');
    await expect(window.locator('#bundle-details')).toHaveClass(/hidden/);
  });
});
