#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { matchMoves, applyMovePath, applyMatchedMoves } = require('./move-detect');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('matchMoves pairs missing + new by hash and size', () => {
  const pairs = matchMoves(
    [
      { filePath: 'C:/old/a.stl', hash: 'h1', size: 100 },
      { filePath: 'C:/old/b.stl', hash: 'h2', size: 200 }
    ],
    [
      { filePath: 'C:/new/a.stl', hash: 'h1', size: 100, fileName: 'a.stl' },
      { filePath: 'C:/new/other.stl', hash: 'h9', size: 999 }
    ]
  );
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].from.filePath, 'C:/old/a.stl');
  assert.strictEqual(pairs[0].to.filePath, 'C:/new/a.stl');
});

test('matchMoves does not reuse the same missing path twice', () => {
  const pairs = matchMoves(
    [{ filePath: 'C:/old/a.stl', hash: 'h1', size: 10 }],
    [
      { filePath: 'C:/new/a.stl', hash: 'h1', size: 10 },
      { filePath: 'C:/new/a-copy.stl', hash: 'h1', size: 10 }
    ]
  );
  assert.strictEqual(pairs.length, 1);
});

test('applyMovePath updates filePath and preserves id', () => {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE,
      fileName TEXT,
      hash TEXT,
      size INTEGER,
      notes TEXT,
      modifiedDate DATETIME
    )
  `).run();
  db.prepare(
    "INSERT INTO models (filePath, fileName, hash, size, notes) VALUES ('C:/old/a.stl', 'a.stl', 'h1', 100, 'keep-me')"
  ).run();

  const result = applyMovePath(db, 'C:/old/a.stl', 'C:/new/a.stl', {
    fileName: 'a.stl',
    hash: 'h1',
    size: 100
  });
  assert.strictEqual(result.updated, true);
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(result.id);
  assert.strictEqual(row.filePath, 'C:/new/a.stl');
  assert.strictEqual(row.notes, 'keep-me');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM models").get().c, 1);
  db.close();
});

test('applyMatchedMoves consumes matched missing paths', () => {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE,
      fileName TEXT,
      hash TEXT,
      size INTEGER,
      modifiedDate DATETIME
    )
  `).run();
  db.prepare(
    "INSERT INTO models (filePath, fileName, hash, size) VALUES ('C:/old/a.stl', 'a.stl', 'h1', 50)"
  ).run();

  const { applied, consumedMissing, consumedNew } = applyMatchedMoves(
    db,
    [{ filePath: 'C:/old/a.stl', hash: 'h1', size: 50 }],
    [{ filePath: 'C:/new/a.stl', hash: 'h1', size: 50, fileName: 'a.stl' }]
  );
  assert.strictEqual(applied.length, 1);
  assert.ok(consumedMissing.has('C:/old/a.stl'));
  assert.ok(consumedNew.has('C:/new/a.stl'));
  db.close();
});
