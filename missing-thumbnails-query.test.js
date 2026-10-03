'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { buildMissingThumbnailQuery } = require('./missing-thumbnails-query');

function openLibrary() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY,
      filePath TEXT,
      fileName TEXT,
      designer TEXT,
      size INTEGER,
      thumbnail TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO models (id, filePath, fileName, designer, size, thumbnail) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run(1, 'a.stl', 'a.stl', 'Ada', 10, null);
  insert.run(2, 'b.stl', 'b.stl', 'Ada', 11, '');
  insert.run(3, 'c.stl', 'c.stl', 'Ada', 12, 'data:image/png;base64,abc');
  insert.run(4, 'd.stl', 'd.stl', 'Ada', 13, '3d.png');
  insert.run(5, 'e.stl', 'e.stl', 'Ada', 14, null);
  return db;
}

function ids(db, options) {
  const { sql, params } = buildMissingThumbnailQuery(options);
  return db.prepare(sql).all(...params).map((row) => row.id);
}

describe('missing thumbnail query', () => {
  test('excludeIds drops known failures so the next page is reachable', () => {
    const db = openLibrary();
    assert.deepEqual(ids(db, { limit: 2 }), [1, 2]);
    assert.deepEqual(ids(db, { limit: 2, excludeIds: [1, 2] }), [4, 5]);
    assert.deepEqual(ids(db, { limit: 10, excludeIds: [1, 1, '2', 0, 'nope'] }), [4, 5]);
    db.close();
  });

  test('offset pages through models that still need thumbnails', () => {
    const db = openLibrary();
    assert.deepEqual(ids(db, { limit: 2, offset: 2 }), [4, 5]);
    assert.deepEqual(ids(db, { limit: 1, offset: 1, excludeIds: [1] }), [4]);
    db.close();
  });

  test('a numeric limit still works', () => {
    const db = openLibrary();
    assert.deepEqual(ids(db, 1), [1]);
    db.close();
  });
});
