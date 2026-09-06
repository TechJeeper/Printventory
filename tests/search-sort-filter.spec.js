/**
 * Tests for search, sort, and filters (single and combined).
 * Assumes test-fixtures/scan-me has cube.stl and test.stl (2 STL models, no 3MF).
 * Run: npm test
 * Note: Close any running Printventory instance first (single-instance lock).
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const {
  getElectronLaunchOptions,
  cleanTestArtifacts,
  dismissOnboarding,
  acceptTerms,
  runDirectoryScan,
  getSmallFixtureScanPath,
  expandSidebarFilters
} = require('./test-utils');

let app;
let window;

/** Run combined search and wait for view count to settle. */
async function applyFilters() {
  await window.evaluate(async () => {
    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    }
  });
  await window.waitForTimeout(800);
}

/** Get current "X models in view" number from #view-count. */
async function getViewCount() {
  const text = await window.locator('#view-count').textContent();
  const m = text.match(/(\d+)\s+model/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Expect view count to be N (with retries). */
async function expectViewCount(expectedCount, timeoutMs = 5000) {
  await window.waitForFunction(
    (n) => {
      const el = document.getElementById('view-count');
      if (!el) return false;
      const m = el.textContent.match(/(\d+)\s+model/);
      return m ? parseInt(m[1], 10) === n : false;
    },
    expectedCount,
    { timeout: timeoutMs }
  );
  const count = await getViewCount();
  expect(count).toBe(expectedCount);
}

test.describe('Search, sort and filter', () => {
  test.beforeAll(async () => {
    cleanTestArtifacts();
    app = await electron.launch(getElectronLaunchOptions({
      PRINTVENTORY_TEST_SCAN_PATH: getSmallFixtureScanPath()
    }));
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await acceptTerms(window);
    await dismissOnboarding(window);
    await expandSidebarFilters(window);
    await runDirectoryScan(window, 300000, 2);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('Search: term filters models and clear restores all', async () => {
    await expectViewCount(2, 15000);

    await window.locator('#search-filter-input').fill('cube');
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(1, 10000);
    await expect(window.locator('.file-grid .file-name').first()).toContainText('cube');

    await window.locator('#clear-filter-search-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(2, 10000);
  });

  test('Search: no match shows 0 in view', async () => {
    await window.locator('#search-filter-input').fill('nonexistentxyz');
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(0, 10000);
    await expect(window.locator('#view-count')).toContainText('0 model');

    await window.locator('#clear-filter-search-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(2, 10000);
  });

  test('Sort: name-asc orders by name (first item cube)', async () => {
    await window.locator('#sort-select').selectOption('name-asc');
    await applyFilters();
    await expect(window.locator('.file-grid .file-name').first()).toContainText('cube');
  });

  test('Sort: name-desc orders by name (first item test)', async () => {
    await window.locator('#sort-select').selectOption('name-desc');
    await applyFilters();
    await expect(window.locator('.file-grid .file-name').first()).toContainText('test');
  });

  test('Filter: File type STL shows all scanned models', async () => {
    await window.locator('#filetype-select').selectOption('stl');
    await applyFilters();
    await expectViewCount(2, 10000);
  });

  test('Filter: File type 3MF shows none (fixtures are STL only)', async () => {
    await window.locator('#filetype-select').selectOption('3mf');
    await applyFilters();
    await expectViewCount(0, 10000);
  });

  test('Filter: Print status All shows all', async () => {
    await window.locator('#filetype-select').selectOption('');
    await window.locator('#printed-select').selectOption('all');
    await applyFilters();
    await expectViewCount(2, 10000);
  });

  test('Filter: Print status Not Printed shows all (none marked printed)', async () => {
    await window.locator('#printed-select').selectOption('not-printed');
    await applyFilters();
    await expectViewCount(2, 10000);
  });

  test('Filter: Print status Printed shows none', async () => {
    await window.locator('#printed-select').selectOption('printed');
    await applyFilters();
    await expectViewCount(0, 10000);
  });

  test('Filter: Designer All keeps all models', async () => {
    await window.locator('#printed-select').selectOption('all');
    await window.locator('#designer-select').selectOption({ index: 0 });
    await applyFilters();
    await expectViewCount(2, 10000);
  });

  test('Filter: Tag All keeps all models', async () => {
    await window.locator('#tag-filter').selectOption({ index: 0 });
    await applyFilters();
    await expectViewCount(2, 10000);
  });

  test('Filter: License All keeps all models', async () => {
    await window.locator('#license-select').selectOption({ index: 0 });
    await applyFilters();
    await expectViewCount(2, 10000);
  });

  test('Filter: Parent model All keeps all models', async () => {
    await window.locator('#parent-select').selectOption({ index: 0 });
    await applyFilters();
    await expectViewCount(2, 10000);
  });

  test('Multi-filter: search + file type STL narrows to matching model', async () => {
    await window.locator('#search-filter-input').fill('cube');
    await window.locator('#filetype-select').selectOption('stl');
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(1, 10000);
    await expect(window.locator('.file-grid .file-name').first()).toContainText('cube');
    await window.locator('.clear-filter-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(2, 10000);
  });

  test('Multi-filter: search + file type 3MF shows zero', async () => {
    await window.locator('#search-filter-input').fill('cube');
    await window.locator('#filetype-select').selectOption('3mf');
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(0, 10000);
    await window.locator('.clear-filter-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(2, 10000);
  });

  test('Multi-filter: search test + not-printed shows one', async () => {
    // Use a string that matches test.stl only (both fixtures live under paths containing "test")
    await window.locator('#search-filter-input').fill('test.stl');
    await window.locator('#printed-select').selectOption('not-printed');
    await window.locator('#filetype-select').selectOption('');
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(1, 10000);
    await expect(window.locator('.file-grid .file-name').first()).toContainText('test');
    await window.locator('.clear-filter-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(2, 10000);
  });

  test('Clear All Filters restores full list', async () => {
    await window.locator('#printed-select').selectOption('all');
    await window.locator('#search-filter-input').fill('__no_match_clear_test__');
    await window.locator('#filetype-select').selectOption('stl');
    await window.locator('#filter-search-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(0, 10000);

    await expect(window.locator('.clear-filter-button')).toBeVisible({ timeout: 3000 });
    await window.locator('.clear-filter-button').click();
    await window.waitForTimeout(600);
    await expectViewCount(2, 10000);
  });

  test('Rating: set stars via engagement bar and persist', async () => {
    await window.locator('button[data-view="detailed"]').click();
    await window.waitForTimeout(400);
    const firstCard = window.locator('.file-item-detailed').first();
    await firstCard.locator('.model-star[data-star="3"]').click();
    await window.waitForTimeout(600);
    await expect(firstCard.locator('.model-star.is-filled')).toHaveCount(3);

    const rating = await window.evaluate(async () => {
      const card = document.querySelector('.file-item-detailed');
      const filePath = card?.dataset?.filepath;
      if (!filePath) return null;
      const model = await window.electron.getModel(filePath);
      return model?.rating;
    });
    expect(rating).toBe(3);
  });

  test('Favorite: toggle heart via engagement bar', async () => {
    await window.locator('button[data-view="detailed"]').click();
    await window.waitForTimeout(400);
    const firstCard = window.locator('.file-item-detailed').first();
    await firstCard.locator('.model-favorite-btn').click();
    await window.waitForTimeout(600);
    await expect(firstCard.locator('.model-favorite-btn.is-favorited')).toBeVisible();

    const favorite = await window.evaluate(async () => {
      const card = document.querySelector('.file-item-detailed');
      const filePath = card?.dataset?.filepath;
      if (!filePath) return null;
      const model = await window.electron.getModel(filePath);
      return model?.favorite;
    });
    expect(favorite).toBeTruthy();
  });

  test('Filter: Favorites shows only favorited models', async () => {
    await window.evaluate(async () => {
      const models = await window.electron.getAllModels('name-asc', 0);
      const cube = models.find((m) => (m.fileName || '').toLowerCase().includes('cube'));
      if (cube) {
        cube.favorite = true;
        await window.electron.saveModel(cube);
      }
    });
    await window.locator('#favorite-select').selectOption('favorited');
    await applyFilters();
    await expectViewCount(1, 10000);
    await window.locator('#favorite-select').selectOption('all');
    await applyFilters();
  });

  test('Filter: exact rating and min rating combine', async () => {
    await window.evaluate(async () => {
      const models = await window.electron.getAllModels('name-asc', 0);
      for (const m of models) {
        if ((m.fileName || '').toLowerCase().includes('cube')) {
          m.rating = 3;
          await window.electron.saveModel(m);
        } else {
          m.rating = 5;
          await window.electron.saveModel(m);
        }
      }
    });
    await window.locator('#rating-select').selectOption('3');
    await window.locator('#rating-min-select').selectOption('2');
    await applyFilters();
    await expectViewCount(1, 10000);

    await window.locator('#rating-select').selectOption('all');
    await window.locator('#rating-min-select').selectOption('5');
    await applyFilters();
    await expectViewCount(1, 10000);

    await window.locator('#rating-select').selectOption('all');
    await window.locator('#rating-min-select').selectOption('all');
    await applyFilters();
  });

  test('Filter: unrated shows models with zero rating', async () => {
    await window.evaluate(async () => {
      const models = await window.electron.getAllModels('name-asc', 0);
      for (const m of models) {
        m.rating = 0;
        m.favorite = false;
        await window.electron.saveModel(m);
      }
    });
    await window.locator('#rating-select').selectOption('unrated');
    await applyFilters();
    await expectViewCount(2, 10000);
    await window.locator('#rating-select').selectOption('all');
    await applyFilters();
  });
});
