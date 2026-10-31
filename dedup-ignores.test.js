#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const dedupIgnores = require('./dedup-ignores');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

function createDb() {
  const db = new Database(':memory:');
  dedupIgnores.ensureSchema(db);
  return db;
}

test('markIgnore / isIgnored / listIgnored / unmark', () => {
  const db = createDb();
  assert.strictEqual(dedupIgnores.isIgnored(db, 'abc'), false);
  const row = dedupIgnores.markIgnore(db, 'abc', 'intentional');
  assert.strictEqual(row.hash, 'abc');
  assert.strictEqual(dedupIgnores.isIgnored(db, 'abc'), true);
  assert.strictEqual(dedupIgnores.listIgnored(db).length, 1);
  assert.strictEqual(dedupIgnores.unmark(db, 'abc'), true);
  assert.strictEqual(dedupIgnores.isIgnored(db, 'abc'), false);
  db.close();
});

test('filterIgnoredGroups hides intentional hashes', () => {
  const db = createDb();
  dedupIgnores.markIgnore(db, 'keep-hidden');
  const filtered = dedupIgnores.filterIgnoredGroups(db, {
    'keep-hidden': [{ filePath: 'a.stl' }, { filePath: 'b.stl' }],
    'still-shown': [{ filePath: 'c.stl' }, { filePath: 'd.stl' }]
  });
  assert.deepStrictEqual(Object.keys(filtered), ['still-shown']);
  db.close();
});

test('rejects empty hash', () => {
  const db = createDb();
  assert.throws(() => dedupIgnores.markIgnore(db, ''), /Hash/);
  db.close();
});
