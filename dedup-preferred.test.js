#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  fileIsUnderPreferredDirectory,
  pickDedupKeeperPath
} = require('./dedup-preferred');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('matches a file nested any number of folders under the preferred directory', () => {
  assert.strictEqual(
    fileIsUnderPreferredDirectory('C:\\Library\\Keep\\sub\\deep\\part.stl', 'C:\\Library\\Keep'),
    true
  );
  assert.strictEqual(
    fileIsUnderPreferredDirectory('/data/library/keep/a/b/part.stl', '/data/library/keep'),
    true
  );
});

test('does not match a sibling directory that only shares a prefix', () => {
  assert.strictEqual(
    fileIsUnderPreferredDirectory('C:\\Library\\KeepExtra\\part.stl', 'C:\\Library\\Keep'),
    false
  );
  assert.strictEqual(
    fileIsUnderPreferredDirectory('/data/library/keep-extra/part.stl', '/data/library/keep'),
    false
  );
});

test('Windows paths match regardless of slash style or letter case', () => {
  assert.strictEqual(
    fileIsUnderPreferredDirectory('c:/library/keep/Sub/Part.stl', 'C:\\Library\\Keep\\'),
    true
  );
});

test('Linux paths stay case-sensitive', () => {
  assert.strictEqual(
    fileIsUnderPreferredDirectory('/data/Library/part.stl', '/data/library'),
    false
  );
});

test('a ZIP archive under the directory counts; the inner entry path does not', () => {
  assert.strictEqual(
    fileIsUnderPreferredDirectory('C:\\Library\\Keep\\pack.zip::models/part.stl', 'C:\\Library\\Keep'),
    true
  );
  assert.strictEqual(
    fileIsUnderPreferredDirectory('D:\\Other\\pack.zip::Library/Keep/part.stl', 'C:\\Library\\Keep'),
    false
  );
});

test('Easy keeps the copy under the preferred directory and falls back to ZIP then first', () => {
  const preferred = 'C:\\Library\\Keep';
  const files = [
    { filePath: 'D:\\Loose\\part.stl' },
    { filePath: 'C:\\Library\\Keep\\nested\\part.stl' },
    { filePath: 'D:\\Archives\\pack.zip::part.stl' }
  ];
  assert.strictEqual(pickDedupKeeperPath(files, preferred), 'C:\\Library\\Keep\\nested\\part.stl');
  assert.strictEqual(
    pickDedupKeeperPath(
      [{ filePath: 'D:\\Loose\\part.stl' }, { filePath: 'D:\\Archives\\pack.zip::part.stl' }],
      preferred
    ),
    'D:\\Archives\\pack.zip::part.stl'
  );
  assert.strictEqual(
    pickDedupKeeperPath(
      [{ filePath: 'D:\\Loose\\a.stl' }, { filePath: 'D:\\Loose\\b.stl' }],
      ''
    ),
    'D:\\Loose\\a.stl'
  );
});

test('when several copies are under the preferred directory, the shortest real path is kept', () => {
  const keeper = pickDedupKeeperPath([
    { filePath: 'C:\\Library\\Keep\\deep\\nested\\part.stl' },
    { filePath: 'C:\\Library\\Keep\\part.stl' },
    { filePath: 'D:\\Loose\\part.stl' }
  ], 'C:\\Library\\Keep');
  assert.strictEqual(keeper, 'C:\\Library\\Keep\\part.stl');
});

test('when several copies are under the preferred directory, a real file is kept', () => {
  const keeper = pickDedupKeeperPath([
    { filePath: 'C:\\Library\\Keep\\pack.zip::part.stl' },
    { filePath: 'D:\\Loose\\part.stl' },
    { filePath: 'C:\\Library\\Keep\\deep\\part.stl' }
  ], 'C:\\Library\\Keep');
  assert.strictEqual(keeper, 'C:\\Library\\Keep\\deep\\part.stl');
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
