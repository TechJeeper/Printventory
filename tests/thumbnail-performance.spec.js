/**
 * Thumbnail size / load-time performance benchmarks.
 *
 * Compares library load and visible thumbnail decode time for:
 *   1. No thumbnails (3d.png placeholder)
 *   2. One ~10MB JPEG thumbnail per model
 *   3. Three ~10MB JPEG thumbnails per model
 *
 * Run:
 *   npx playwright test thumbnail-performance.spec.js
 *
 * Close any running Printventory instance first (single-instance lock).
 */
const { test, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  getTestEnv,
  getElectronLaunchOptions,
  cleanTestArtifacts,
  dismissOnboarding,
  acceptTerms,
  enableZipArchives,
  runDirectoryScan,
  clearAllFilters,
  getTotalCount
} = require('./test-utils');
const {
  DEFAULT_LARGE_IMAGE_PATH,
  loadImageAsDataUrl,
  clearAllThumbnails,
  setSingleThumbnailPerModel,
  setTripleThumbnailPerModel,
  getDbFileSize,
  formatMs,
  formatBytes
} = require('./thumbnail-perf-utils');

const RESULTS_PATH = path.join(__dirname, 'test-results', 'thumbnail-performance.json');
const RUNS_PER_SCENARIO = 1;

/** Wait until progressive library load finishes (view count matches total). */
async function waitForFullLibraryLoad(page, timeoutMs = 300000) {
  await page.waitForFunction(
    () => {
      const viewEl = document.getElementById('view-count');
      const totalEl = document.getElementById('total-count');
      if (!viewEl || !totalEl) return false;
      const viewMatch = viewEl.textContent.match(/(\d+)\s+model/);
      const totalMatch = totalEl.textContent.match(/(\d+)\s+model/);
      if (!viewMatch || !totalMatch) return false;
      const view = parseInt(viewMatch[1], 10);
      const total = parseInt(totalMatch[1], 10);
      return total > 0 && view === total;
    },
    { timeout: timeoutMs }
  );
}

/** Ensure detailed grid view so thumbnail IPC fetches run. */
async function ensureDetailedView(page) {
  await page.evaluate(async () => {
    const detailedBtn = document.querySelector('.view-mode-button[data-view="detailed"]');
    if (detailedBtn && !detailedBtn.classList.contains('active')) {
      detailedBtn.click();
      await new Promise((r) => setTimeout(r, 400));
    }
  });
}

/** Measure one library refresh cycle. */
async function measureLibraryRefresh(page, label) {
  await clearAllFilters(page);

  const metrics = await page.evaluate(async (runLabel) => {
    const grid = document.querySelector('.file-grid');
    if (grid) {
      grid.innerHTML = '';
      grid.currentModels = null;
      grid.isRendering = false;
      grid.pendingModels = null;
    }

    const memBefore = performance.memory
      ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize }
      : null;

    const t0 = performance.now();
    if (typeof window.performCombinedSearch !== 'function') {
      throw new Error('performCombinedSearch is not available');
    }
    await window.performCombinedSearch();
    const searchReturnedMs = performance.now() - t0;

    return { runLabel, searchReturnedMs, memBefore, startedAt: t0 };
  }, label);

  const fullLoadStart = Date.now();
  await waitForFullLibraryLoad(page);
  metrics.fullLibraryLoadMs = Date.now() - fullLoadStart + metrics.searchReturnedMs;

  const visibleItems = await page.locator('.file-grid .file-item').count();
  metrics.visibleGridItems = visibleItems;

  const thumbMetrics = await page.evaluate(async () => {
    const grid = document.querySelector('.file-grid');
    const items = grid ? [...grid.querySelectorAll('.file-item')] : [];
    const viewportBottom = window.innerHeight;
    const visibleItemsWithImg = items.filter((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < viewportBottom;
    });

    const t0 = performance.now();
    const imgs = visibleItemsWithImg
      .map((item) => item.querySelector('img'))
      .filter(Boolean);

    await Promise.all(
      imgs.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve({ loaded: true, isPlaceholder: img.src.includes('3d.png') });
              return;
            }
            const done = () =>
              resolve({
                loaded: img.complete && img.naturalWidth > 0,
                isPlaceholder: img.src.includes('3d.png')
              });
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            setTimeout(done, 120000);
          })
      )
    );

    const loadedDataUrls = imgs.filter(
      (img) => img.src.startsWith('data:image') && img.complete && img.naturalWidth > 0
    ).length;
    const placeholders = imgs.filter((img) => img.src.includes('3d.png')).length;

    const memAfter = performance.memory
      ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize }
      : null;

    return {
      visibleItemCount: visibleItemsWithImg.length,
      visibleImageCount: imgs.length,
      visibleThumbDecodeMs: performance.now() - t0,
      loadedDataUrlThumbnails: loadedDataUrls,
      placeholderThumbnails: placeholders,
      memAfter
    };
  });

  Object.assign(metrics, thumbMetrics);

  if (metrics.memBefore && metrics.memAfter) {
    metrics.jsHeapDeltaBytes = metrics.memAfter.usedJSHeapSize - metrics.memBefore.usedJSHeapSize;
  }

  return metrics;
}

async function measureViewLibraryButton(page) {
  const t0 = Date.now();
  await page.locator('#view-library-button').click();
  await waitForFullLibraryLoad(page);
  return Date.now() - t0;
}

function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function summarizeRuns(runs) {
  return {
    runs,
    median: {
      searchReturnedMs: median(runs.map((r) => r.searchReturnedMs)),
      fullLibraryLoadMs: median(runs.map((r) => r.fullLibraryLoadMs)),
      visibleThumbDecodeMs: median(runs.map((r) => r.visibleThumbDecodeMs)),
      jsHeapDeltaBytes: median(runs.map((r) => r.jsHeapDeltaBytes)),
      loadedDataUrlThumbnails: median(runs.map((r) => r.loadedDataUrlThumbnails)),
      placeholderThumbnails: median(runs.map((r) => r.placeholderThumbnails))
    }
  };
}

async function launchApp() {
  const app = await electron.launch(getElectronLaunchOptions());
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

async function prepareFreshLibrary(window) {
  const accept = window.locator('button:has-text("I Accept")');
  if (await accept.isVisible({ timeout: 5000 }).catch(() => false)) {
    await acceptTerms(window);
    await dismissOnboarding(window);
    await enableZipArchives(window);
    await runDirectoryScan(window, 300000);
  } else {
    await dismissOnboarding(window);
  }

  await ensureDetailedView(window);
  await clearAllFilters(window);
  await waitForFullLibraryLoad(window);
}

test.describe.configure({ mode: 'serial', timeout: 900000 });

test.describe('Thumbnail load performance', () => {
  let largeImageDataUrl;
  let modelCount = 0;
  const allResults = {
    generatedAt: new Date().toISOString(),
    imagePath: DEFAULT_LARGE_IMAGE_PATH,
    imageBytes: null,
    dataUrlChars: null,
    modelCount: 0,
    scenarios: {}
  };

  test.beforeAll(async () => {
    if (!fs.existsSync(DEFAULT_LARGE_IMAGE_PATH)) {
      throw new Error(`Missing test image: ${DEFAULT_LARGE_IMAGE_PATH}`);
    }
    allResults.imageBytes = fs.statSync(DEFAULT_LARGE_IMAGE_PATH).size;
    largeImageDataUrl = loadImageAsDataUrl();
    allResults.dataUrlChars = largeImageDataUrl.length;

    cleanTestArtifacts();

    const { app, window } = await launchApp();
    try {
      await prepareFreshLibrary(window);
      modelCount = await getTotalCount(window);
      allResults.modelCount = modelCount;
    } finally {
      await app.close();
    }

    if (modelCount < 2) {
      throw new Error(`Need at least 2 indexed models for benchmarking, found ${modelCount}`);
    }
  });

  async function runScenario(key, label, setupDb) {
    const dbSetup = setupDb();
    const dbSizeBytes = dbSetup?.dbSizeBytes ?? getDbFileSize();
    const dbModelCount = dbSetup?.modelCount ?? modelCount;

    const { app, window } = await launchApp();
    const scenario = {
      label,
      dbSizeBytes,
      dbModelCount,
      runs: [],
      viewLibraryButtonMs: null
    };

    try {
      await prepareFreshLibrary(window);
      await ensureDetailedView(window);

      for (let i = 0; i < RUNS_PER_SCENARIO; i += 1) {
        scenario.runs.push(await measureLibraryRefresh(window, `${label} run ${i + 1}`));
      }

      scenario.viewLibraryButtonMs = await measureViewLibraryButton(window);
      scenario.summary = summarizeRuns(scenario.runs);
    } finally {
      await app.close();
    }

    allResults.scenarios[key] = scenario;
  }

  test('baseline: no thumbnails', async () => {
    await runScenario('noThumbnails', 'No thumbnails (3d.png)', () => clearAllThumbnails());
  });

  test('single 10MB thumbnail per model (compressed on add)', async () => {
    await runScenario('single10Mb', 'One 10MB thumbnail per model (compressed)', () =>
      setSingleThumbnailPerModel()
    );
  });

  test('three 10MB thumbnails per model (compressed on add)', async () => {
    await runScenario('triple10Mb', 'Three 10MB thumbnails per model (compressed)', () =>
      setTripleThumbnailPerModel()
    );
  });

  test.afterAll(async () => {
    fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));

    const lines = [
      '',
      '══════════════════════════════════════════════════════════════',
      '  Thumbnail performance results',
      '══════════════════════════════════════════════════════════════',
      `  Models: ${allResults.modelCount}`,
      `  Image: ${allResults.imagePath} (${formatBytes(allResults.imageBytes)})`,
      `  Data URL size: ${formatBytes(allResults.dataUrlChars)} per image`,
      ''
    ];

    for (const [key, scenario] of Object.entries(allResults.scenarios)) {
      const m = scenario.summary?.median;
      lines.push(`  ${scenario.label}`);
      lines.push(`    DB size: ${formatBytes(scenario.dbSizeBytes)}`);
      lines.push(`    performCombinedSearch return: ${formatMs(m?.searchReturnedMs)}`);
      lines.push(`    Full library load (progressive): ${formatMs(m?.fullLibraryLoadMs)}`);
      lines.push(`    Visible thumbnail decode: ${formatMs(m?.visibleThumbDecodeMs)}`);
      lines.push(`    View Library button: ${formatMs(scenario.viewLibraryButtonMs)}`);
      lines.push(
        `    Visible cells — data URLs: ${m?.loadedDataUrlThumbnails ?? 'n/a'}, placeholders: ${m?.placeholderThumbnails ?? 'n/a'}`
      );
      if (m?.jsHeapDeltaBytes != null) {
        lines.push(`    JS heap delta after load: ${formatBytes(m.jsHeapDeltaBytes)}`);
      }
      lines.push('');
    }

    lines.push(`  Full JSON: ${RESULTS_PATH}`);
    lines.push('══════════════════════════════════════════════════════════════');
    console.log(lines.join('\n'));
  });
});
