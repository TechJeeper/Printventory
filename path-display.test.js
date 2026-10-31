'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pathDisplay = require('./path-display');

test('formatPathForDisplay modes', () => {
  const full = 'C:/Models/Designer/benchy.stl';
  assert.equal(pathDisplay.formatPathForDisplay(full, 'full'), full);
  assert.equal(pathDisplay.formatPathForDisplay(full, 'filename'), 'benchy.stl');
  const parent = pathDisplay.formatPathForDisplay(full, 'parent');
  assert.ok(parent.includes('Designer') || parent.endsWith('Designer'));
});

test('applyAliases replaces path prefixes', () => {
  const aliases = [{ from: 'C:/Models', to: 'Library' }];
  assert.equal(
    pathDisplay.applyAliases('C:/Models/foo/bar.stl', aliases).replace(/\\/g, '/'),
    'Library/foo/bar.stl'
  );
  assert.equal(
    pathDisplay.formatPathForDisplay('C:/Models/foo/bar.stl', 'full', aliases).replace(/\\/g, '/'),
    'Library/foo/bar.stl'
  );
  assert.equal(
    pathDisplay.formatPathForDisplay('C:/Models/foo/bar.stl', 'filename', aliases),
    'bar.stl'
  );
});

test('parsePathAliases and normalizePathDisplayMode', () => {
  assert.deepEqual(pathDisplay.parsePathAliases('[{"from":"a","to":"b"}]'), [{ from: 'a', to: 'b' }]);
  assert.deepEqual(pathDisplay.parsePathAliases('bad'), []);
  assert.equal(pathDisplay.normalizePathDisplayMode('FILENAME'), 'filename');
  assert.equal(pathDisplay.normalizePathDisplayMode('nope'), 'full');
});
