#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { deriveBundleFromFilePath } = require('./bundle-keys');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('folder bundle from sibling STLs', () => {
  const stem = deriveBundleFromFilePath('/Downloads/flower-model/stem.stl');
  const petal = deriveBundleFromFilePath('/Downloads/flower-model/petal.stl');
  assert.strictEqual(stem.bundleKind, 'folder');
  assert.strictEqual(stem.bundleLabel, 'flower-model');
  assert.strictEqual(stem.bundleKey, petal.bundleKey);
});

test('zip bundle from archive entry', () => {
  const entry = deriveBundleFromFilePath('C:\\Models\\flower.zip::parts/flower.stl');
  assert.strictEqual(entry.bundleKind, 'zip');
  assert.strictEqual(entry.bundleLabel, 'flower.zip');
  assert.ok(entry.bundleKey.startsWith('zip:'));
});

test('url models have no bundle', () => {
  const url = deriveBundleFromFilePath('url::https://example.com/model.stl');
  assert.strictEqual(url.bundleKey, '');
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
