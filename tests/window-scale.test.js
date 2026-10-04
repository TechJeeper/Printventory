#!/usr/bin/env node
'use strict';

const assert = require('assert');
const gridRefresh = require('../grid-refresh');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const LIST_COLUMNS = [140, 75, 110, 150, 120, 120, 140, 180, 100];

function frame(mode, overrides) {
  return gridRefresh.windowScaleFrame(Object.assign({
    mode,
    viewportWidth: 1600,
    clientWidth: 0,
    sidebarWidth: 350,
    folderWidth: 0,
    view: 'detailed',
    previewColumns: 6,
    columnWidths: LIST_COLUMNS
  }, overrides));
}

function assertSameScale(desktop, docker) {
  assert.strictEqual(docker.menuBarOffset, 30);
  assert.strictEqual(desktop.menuBarOffset, 0);
  assert.strictEqual(docker.gridWidth, desktop.gridWidth);
  assert.strictEqual(docker.previewTile, desktop.previewTile);
  assert.strictEqual(docker.detailedColumns, desktop.detailedColumns);
  assert.strictEqual(docker.list.scrolls, desktop.list.scrolls);
  assert.strictEqual(docker.list.natural, desktop.list.natural);
}

test('desktop and docker use the same grid width when the window grows', () => {
  const narrow = { viewportWidth: 1280, clientWidth: 890 };
  const wide = { viewportWidth: 1920, clientWidth: 890 };
  const desktopNarrow = frame('desktop', narrow);
  const dockerNarrow = frame('docker', narrow);
  const desktopWide = frame('desktop', Object.assign({}, wide, { previous: desktopNarrow.layout }));
  const dockerWide = frame('docker', Object.assign({}, wide, { previous: dockerNarrow.layout }));

  assertSameScale(desktopNarrow, dockerNarrow);
  assertSameScale(desktopWide, dockerWide);
  assert.ok(desktopWide.gridWidth > desktopNarrow.gridWidth);
  assert.strictEqual(desktopWide.reposition, true);
  assert.strictEqual(dockerWide.reposition, true);
  assert.ok(desktopWide.detailedColumns >= desktopNarrow.detailedColumns);
});

test('a lagged grid box still scales preview tiles in both modes', () => {
  for (const mode of ['desktop', 'docker']) {
    const before = frame(mode, { view: 'preview', viewportWidth: 1280, clientWidth: 890 });
    const after = frame(mode, {
      view: 'preview',
      viewportWidth: 1920,
      clientWidth: 890,
      previous: before.layout
    });
    assert.ok(after.previewTile > before.previewTile, mode);
    assert.strictEqual(after.previewColumns, 6);
    const used = after.previewColumns * after.previewTile + (after.previewColumns - 1) * 2;
    assert.ok(used <= after.gridWidth, mode);
    assert.ok(after.gridWidth - used < after.previewTile, mode);
    assert.strictEqual(after.reposition, true, mode);
  }
});

test('shrinking the window drops detailed columns and still repositions a short filtered list', () => {
  for (const mode of ['desktop', 'docker']) {
    const wide = frame(mode, { viewportWidth: 2200, clientWidth: 1810 });
    const narrow = frame(mode, {
      viewportWidth: 1100,
      clientWidth: 1810,
      previous: wide.layout
    });
    assert.ok(narrow.detailedColumns < wide.detailedColumns, mode);
    assert.ok(narrow.detailedColumns >= 1, mode);
    assert.strictEqual(narrow.reposition, true, mode);
  }
});

test('a scrollbar-sized difference keeps the measured grid box in both modes', () => {
  for (const mode of ['desktop', 'docker']) {
    const fitted = frame(mode, { viewportWidth: 1600, clientWidth: 1200 });
    assert.strictEqual(fitted.gridWidth, 1200, mode);
    const lagged = frame(mode, { viewportWidth: 1600, clientWidth: 900 });
    assert.strictEqual(lagged.gridWidth, 1210, mode);
  }
});

test('the folder rail narrows desktop and docker by the same amount', () => {
  const open = { folderWidth: 280, viewportWidth: 1600, clientWidth: 0 };
  const desktop = frame('desktop', open);
  const docker = frame('docker', open);
  const desktopClosed = frame('desktop', { viewportWidth: 1600, clientWidth: 0 });
  assertSameScale(desktop, docker);
  assert.strictEqual(desktopClosed.gridWidth - desktop.gridWidth, 280);
});

test('preview S, M, and L keep a fixed column count and fill the row', () => {
  const sizes = { s: 10, m: 6, l: 4 };
  for (const mode of ['desktop', 'docker']) {
    for (const size of Object.keys(sizes)) {
      const cols = sizes[size];
      const shot = frame(mode, {
        view: 'preview',
        previewColumns: cols,
        viewportWidth: 1800,
        clientWidth: 0
      });
      assert.strictEqual(shot.columns, cols, mode + ' ' + size);
      const used = cols * shot.previewTile + (cols - 1) * 2;
      assert.ok(used <= shot.gridWidth, mode + ' ' + size);
      assert.ok(shot.gridWidth - used < shot.previewTile, mode + ' ' + size);
    }
  }
});

test('list view scrolls only when the columns are wider than the pane', () => {
  for (const mode of ['desktop', 'docker']) {
    const cramped = frame(mode, { view: 'list', viewportWidth: 1280, clientWidth: 0 });
    const roomy = frame(mode, { view: 'list', viewportWidth: 2400, clientWidth: 0 });
    assert.strictEqual(cramped.list.scrolls, true, mode);
    assert.strictEqual(roomy.list.scrolls, false, mode);
    assert.strictEqual(cramped.list.natural, roomy.list.natural);
    assert.ok(cramped.list.width > cramped.available, mode);
    assert.strictEqual(roomy.list.width, roomy.available);
  }
});

test('hiding a list column can remove the horizontal scrollbar in both modes', () => {
  const hidden = LIST_COLUMNS.slice(0, 3);
  for (const mode of ['desktop', 'docker']) {
    const all = frame(mode, { view: 'list', viewportWidth: 1600, clientWidth: 0 });
    const few = frame(mode, {
      view: 'list',
      viewportWidth: 1600,
      clientWidth: 0,
      columnWidths: hidden
    });
    assert.strictEqual(all.list.scrolls, true, mode);
    assert.strictEqual(few.list.scrolls, false, mode);
    assert.ok(few.list.natural < all.list.natural);
  }
});

test('an unchanged window does not ask for another reposition', () => {
  for (const mode of ['desktop', 'docker']) {
    const first = frame(mode, { viewportWidth: 1600, clientWidth: 1210 });
    const again = frame(mode, {
      viewportWidth: 1600,
      clientWidth: 1210,
      previous: first.layout
    });
    assert.strictEqual(again.reposition, false, mode);
    assert.strictEqual(again.gridWidth, first.gridWidth);
  }
});

(async () => {
  let failed = 0;
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log('ok ' + entry.name);
    } catch (error) {
      failed += 1;
      console.error('FAIL ' + entry.name);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
})();
