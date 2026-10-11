#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const gridRefresh = require('../grid-refresh');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function normalize(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

test('off-screen thumbnail patches the loaded model object', () => {
  const model = { filePath: 'C:/lib/a.stl', thumbnail: null };
  const models = [model];
  const patched = gridRefresh.patchLoadedModel(
    models,
    normalize('C:/lib/a.stl'),
    { filePath: 'C:/lib/a.stl', thumbnail: 'data:image/png;base64,abc' },
    normalize
  );
  assert.strictEqual(patched, true);
  assert.strictEqual(models[0], model);
  assert.strictEqual(model.thumbnail, 'data:image/png;base64,abc');
});

test('thumbnail patch misses a model that is not loaded', () => {
  const patched = gridRefresh.patchLoadedModel(
    [{ filePath: 'C:/lib/b.stl' }],
    normalize('C:/lib/missing.stl'),
    { thumbnail: 'x' },
    normalize
  );
  assert.strictEqual(patched, false);
});

test('detailed and preview keep a selection in view', () => {
  assert.strictEqual(gridRefresh.shouldFocusSelectionOnViewSwitch('detailed', 'preview', true), true);
  assert.strictEqual(gridRefresh.shouldFocusSelectionOnViewSwitch('preview', 'detailed', true), true);
  assert.strictEqual(gridRefresh.shouldFocusSelectionOnViewSwitch('detailed', 'list', true), false);
  assert.strictEqual(gridRefresh.shouldFocusSelectionOnViewSwitch('preview', 'detailed', false), false);

  const layout = {
    totalHeight: 4000,
    rows: [
      { type: 'models', top: 10, height: 200, records: [{ type: 'model', model: { filePath: 'a.stl' } }] },
      {
        type: 'models',
        top: 1800,
        height: 200,
        records: [
          { type: 'group', children: [{ filePath: 'grouped.stl' }] },
          { type: 'model', model: { filePath: 'b.stl' } }
        ]
      }
    ]
  };
  const selected = (filePath) => filePath === 'b.stl';
  assert.strictEqual(gridRefresh.scrollTopForSelectedLayout(layout, 600, selected), 1600);
  assert.strictEqual(
    gridRefresh.scrollTopForSelectedLayout(layout, 600, (filePath) => filePath === 'grouped.stl'),
    1600
  );
  assert.strictEqual(gridRefresh.scrollTopForSelectedLayout(layout, 600, () => false), null);
});

test('preview width follows the window when the grid box lags', () => {
  assert.strictEqual(gridRefresh.libraryGridWidth(900, 1400, 350, 0), 1010);
  assert.strictEqual(gridRefresh.libraryGridWidth(1010, 1400, 350, 0), 1010);
  assert.strictEqual(gridRefresh.libraryGridWidth(1000, 1400, 350, 0), 1000);
  assert.strictEqual(gridRefresh.libraryGridWidth(0, 1400, 350, 0), 1010);
});

test('removing one filtered model still repositions the cards around the hole', () => {
  const models = [{ filePath: 'a.stl' }, { filePath: 'b.stl' }, { filePath: 'c.stl' }];
  const cache = {
    width: 1200,
    columns: 3,
    view: 'detailed',
    rowHeight: 490,
    verticalGap: 20,
    modelsRef: models,
    modelsLen: 3,
    expandGen: 1
  };
  const same = {
    width: 1200,
    columns: 3,
    view: 'detailed',
    rowHeight: 490,
    verticalGap: 20,
    modelsRef: models,
    modelsLen: 3,
    expandGen: 1
  };
  assert.strictEqual(gridRefresh.mountedCardsStayPut(cache, same), true);
  models.splice(1, 1);
  assert.strictEqual(
    gridRefresh.mountedCardsStayPut(cache, Object.assign({}, same, { modelsLen: models.length })),
    false
  );
  assert.strictEqual(
    gridRefresh.mountedCardsStayPut(cache, Object.assign({}, same, { modelsRef: models.slice() })),
    false
  );
  assert.strictEqual(
    gridRefresh.mountedCardsStayPut(cache, Object.assign({}, same, { width: 900, columns: 2 })),
    false
  );
});

test('a resize still repositions a fully mounted filtered grid', () => {
  const same = {
    width: 1200,
    columns: 3,
    view: 'detailed',
    rowHeight: 490,
    verticalGap: 20
  };
  assert.strictEqual(gridRefresh.virtualGridGeometryChanged(same, same), false);
  assert.strictEqual(gridRefresh.virtualGridGeometryChanged(null, same), true);
  assert.strictEqual(
    gridRefresh.virtualGridGeometryChanged(same, Object.assign({}, same, { width: 900, columns: 2 })),
    true
  );
  assert.strictEqual(
    gridRefresh.virtualGridGeometryChanged(same, Object.assign({}, same, { width: 1280 })),
    true
  );
});

test('progressive render holds a short page only while preserving scroll', () => {
  assert.strictEqual(gridRefresh.shouldHoldProgressiveRender(true, 500, 2000, false), true);
  assert.strictEqual(gridRefresh.shouldHoldProgressiveRender(true, 2000, 2000, false), false);
  assert.strictEqual(gridRefresh.shouldHoldProgressiveRender(true, 100, 2000, true), false);
  assert.strictEqual(gridRefresh.shouldHoldProgressiveRender(false, 500, 2000, false), false);
});

test('thumbnail reloads coalesce to one call per window', async () => {
  let calls = 0;
  const schedule = gridRefresh.createCoalescedRefresh(40, async () => {
    calls += 1;
  });
  schedule();
  schedule();
  schedule();
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.strictEqual(calls, 1);
  schedule();
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.strictEqual(calls, 2);
});

function loadSearch() {
  const elements = new Map();
  const grid = {
    scrollTop: 840,
    currentModels: new Array(2000).fill(null).map((_, i) => ({ filePath: `m${i}.stl` })),
    classList: { add() {}, remove() {} }
  };
  const document = {
    getElementById() { return null; },
    querySelector(selector) {
      return selector === '.file-grid' ? grid : null;
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const renders = [];
  const window = {
    document,
    console,
    gridRefresh,
    dateAddedFilter: null,
    renderFiles: async (models) => {
      grid.scrollTop = 0;
      renders.push(models.length);
    }
  };
  window.window = window;
  const pages = {
    '500:0': 500,
    '1200:500': 1200,
    '1200:1700': 300
  };
  window.electron = {
    getModelsFiltered: async (filters) => {
      const limit = filters.limit;
      const offset = filters.offset || 0;
      const count = pages[`${limit}:${offset}`];
      if (count == null) return [];
      return new Array(count).fill(null).map((_, i) => ({ filePath: `p${offset + i}.stl` }));
    }
  };
  const context = vm.createContext({
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    requestIdleCallback: (fn) => setTimeout(fn, 0)
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'search.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'search.js' });
  return { window, grid, renders };
}

async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('background search restores scroll and skips the short first page', async () => {
  const { window, grid, renders } = loadSearch();
  await window.performCombinedSearch({ preserveScroll: true });
  await waitFor(() => window._progressiveLibraryLoadActive === false && renders.length > 0);
  assert.deepStrictEqual(renders, [2000]);
  assert.strictEqual(grid.scrollTop, 840);
});

test('user search still renders the first page immediately', async () => {
  const { window, renders } = loadSearch();
  await window.performCombinedSearch();
  assert.strictEqual(renders[0], 500);
  await waitFor(() => window._progressiveLibraryLoadActive === false);
  assert.ok(renders.includes(500));
});

test('tag refresh rebuilds only groups that contain a changed model', () => {
  const records = [
    {
      type: 'group',
      groupKey: 'parent:benchy',
      children: [{ filePath: 'C:/lib/a.stl' }, { filePath: 'C:/lib/b.stl' }]
    },
    {
      type: 'group',
      groupKey: 'parent:other',
      children: [{ filePath: 'C:/lib/c.stl' }]
    },
    { type: 'model', model: { filePath: 'C:/lib/d.stl' } }
  ];
  assert.deepStrictEqual(
    gridRefresh.groupKeysForTagRefresh(['C:\\lib\\b.stl'], records, normalize),
    ['parent:benchy']
  );
  assert.deepStrictEqual(gridRefresh.groupKeysForTagRefresh([], records, normalize), []);
});

test('renderer wires off-screen patches to a coalesced scroll-preserving refresh', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.ok(renderer.includes('window.gridRefresh.patchLoadedModel'));
  assert.ok(renderer.includes('window.gridRefresh.createCoalescedRefresh'));
  assert.ok(renderer.includes('performCombinedSearch({ preserveScroll: true })'));
  assert.ok(renderer.includes('shouldFocusSelectionOnViewSwitch'));
  assert.ok(renderer.includes('scrollTopForSelectedLayout'));
  assert.ok(renderer.includes('refreshVisibleGridAfterBulkTagChange(modelsToUpdate)'));
  assert.ok(renderer.includes('window.gridRefresh?.groupKeysForTagRefresh'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const gridAt = html.indexOf('src="grid-refresh.js"');
  const searchAt = html.indexOf('src="search.js"');
  assert.ok(gridAt !== -1 && searchAt !== -1 && gridAt < searchAt);
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok ${name}`);
    } catch (err) {
      console.error(`FAIL ${name}:`, err && err.stack ? err.stack : err);
      process.exitCode = 1;
    }
  }
})();
