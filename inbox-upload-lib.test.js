#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const lib = require('./inbox-upload-lib');

function test(name, fn) {
  try {
    fn();
    console.log('ok ' + name);
  } catch (err) {
    console.error('FAIL ' + name + ':', err.message);
    process.exitCode = 1;
  }
}

test('normalizeInboxFolderName defaults to Inbox', () => {
  assert.strictEqual(lib.normalizeInboxFolderName(''), 'Inbox');
  assert.strictEqual(lib.normalizeInboxFolderName(null), 'Inbox');
  assert.strictEqual(lib.normalizeInboxFolderName('  Drops  '), 'Drops');
});

test('normalizeInboxFolderName strips path separators', () => {
  assert.strictEqual(lib.normalizeInboxFolderName('../evil'), 'evil');
  assert.strictEqual(lib.normalizeInboxFolderName('a/b\\c'), 'abc');
});

test('resolveInboxPath joins under STL Home', () => {
  const home = path.join('C:', 'Models');
  const resolved = lib.resolveInboxPath(home, 'Inbox');
  assert.ok(resolved.endsWith(path.join('Models', 'Inbox')) || resolved.includes('Inbox'));
});

test('isAllowedUploadName accepts model and zip types', () => {
  assert.strictEqual(lib.isAllowedUploadName('a.stl'), true);
  assert.strictEqual(lib.isAllowedUploadName('pack.ZIP'), true);
  assert.strictEqual(lib.isAllowedUploadName('notes.txt'), false);
  assert.strictEqual(lib.isAllowedUploadName('../x.stl'), true);
});

test('safeUploadBaseName sanitizes', () => {
  assert.strictEqual(lib.safeUploadBaseName('foo/bar?.stl'), 'bar_.stl');
});

console.log(process.exitCode ? 'inbox-upload-lib tests failed' : 'inbox-upload-lib tests passed');
