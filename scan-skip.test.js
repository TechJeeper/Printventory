#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  shouldSkipDirectoryName,
  shouldSkipFileName,
  shouldSkipEntryPath,
  normalizeExcludeNames
} = require('./scan-skip');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('skips dot folders, AppleDouble files, and __MACOSX', () => {
  assert.strictEqual(shouldSkipDirectoryName('.manyfold'), true);
  assert.strictEqual(shouldSkipDirectoryName('.git'), true);
  assert.strictEqual(shouldSkipDirectoryName('Kitchen'), false);
  assert.strictEqual(shouldSkipFileName('._model.stl'), true);
  assert.strictEqual(shouldSkipFileName('model.stl'), false);
  assert.strictEqual(
    shouldSkipEntryPath('library/EInk Dashboard/.manyfold/derivatives/frame-leg.stl/render.stl'),
    true
  );
  assert.strictEqual(shouldSkipEntryPath('library/Kitchen/Bagel Slicer/lid.3mf'), false);
  assert.strictEqual(shouldSkipEntryPath('__MACOSX/model.stl'), true);
});

test('extra folder names from settings are skipped', () => {
  const extra = normalizeExcludeNames('cache\nderivatives, library/temp');
  assert.strictEqual(shouldSkipDirectoryName('derivatives', extra), true);
  assert.strictEqual(shouldSkipDirectoryName('temp', extra), true);
  assert.strictEqual(shouldSkipDirectoryName('models', extra), false);
  assert.strictEqual(shouldSkipEntryPath('prints/cache/part.stl', extra), true);
});
