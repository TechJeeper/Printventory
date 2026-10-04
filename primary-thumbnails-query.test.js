'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const {
  PRIMARY_THUMBNAIL_BATCH_LIMIT,
  buildPrimaryThumbnailsQuery,
  normalizePrimaryThumbnail
} = require('./primary-thumbnails-query');

function openLibrary() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY,
      filePath TEXT,
      thumbnail TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO models (filePath, thumbnail) VALUES (?, ?)');
  insert.run('plain.stl', 'data:image/png;base64,AAA');
  insert.run('multi.stl', 'data:image/png;base64,ONE::data:image/png;base64,TWO');
  insert.run('placeholder.stl', '3d.png');
  insert.run('empty.stl', '');
  insert.run('missing.stl', null);
  insert.run('text.stl', 'not-an-image');
  insert.run('huge.stl', 'data:image/png;base64,' + 'X'.repeat(50));
  insert.run('untouched.stl', 'data:image/png;base64,SKIP');
  return db;
}

function load(db, paths, maxChars = 40) {
  const { sql, params } = buildPrimaryThumbnailsQuery(paths, maxChars);
  const rows = db.prepare(sql).all(...params);
  const thumbs = {};
  for (const row of rows) thumbs[row.filePath] = normalizePrimaryThumbnail(row.primaryThumb);
  return thumbs;
}

describe('primary thumbnail batch query', () => {
  test('returns only the first image and skips placeholders', () => {
    const db = openLibrary();
    const thumbs = load(db, ['plain.stl', 'multi.stl', 'placeholder.stl', 'empty.stl', 'missing.stl', 'text.stl'], 1000);
    assert.equal(thumbs['plain.stl'], 'data:image/png;base64,AAA');
    assert.equal(thumbs['multi.stl'], 'data:image/png;base64,ONE');
    assert.equal(thumbs['placeholder.stl'], null);
    assert.equal(thumbs['empty.stl'], null);
    assert.equal(thumbs['missing.stl'], null);
    assert.equal(thumbs['text.stl'], null);
    assert.equal(thumbs['untouched.stl'], undefined);
  });

  test('does not load thumbnails over the size guard', () => {
    const db = openLibrary();
    const thumbs = load(db, ['huge.stl', 'plain.stl'], 40);
    assert.equal(thumbs['huge.stl'], null);
    assert.equal(thumbs['plain.stl'], 'data:image/png;base64,AAA');
  });

  test('caps the path list', () => {
    const paths = Array.from({ length: PRIMARY_THUMBNAIL_BATCH_LIMIT + 25 }, (_, i) => `m${i}.stl`);
    const { paths: kept, params } = buildPrimaryThumbnailsQuery(paths, 1000);
    assert.equal(kept.length, PRIMARY_THUMBNAIL_BATCH_LIMIT);
    assert.equal(params.length, PRIMARY_THUMBNAIL_BATCH_LIMIT + 2);
  });
});
