'use strict';

// SQLite cases need Electron's better-sqlite3 binary:
//   $env:ELECTRON_RUN_AS_NODE='1'; npx electron semantic-search.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const semanticSearch = require('./semantic-search');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.prepare(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE,
      fileName TEXT,
      thumbnail TEXT
    )
  `).run();
  semanticSearch.ensureSchema(db);
  return db;
}

function insertModel(db, name) {
  return db.prepare('INSERT INTO models (filePath, fileName) VALUES (?, ?)').run(name, name).lastInsertRowid;
}

test('cosineSimilarity of identical and orthogonal vectors', () => {
  assert.ok(Math.abs(semanticSearch.cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(semanticSearch.cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  assert.equal(semanticSearch.cosineSimilarity([1], [1, 2]), 0);
});

test('storeEmbedding / getEmbedding / findSimilar with fake vectors', () => {
  const db = createDb();
  const a = insertModel(db, 'a.stl');
  const b = insertModel(db, 'b.stl');
  const c = insertModel(db, 'c.stl');

  semanticSearch.storeEmbedding(db, a, [1, 0, 0], { description: 'benchy', provider: 'fake' });
  semanticSearch.storeEmbedding(db, b, [0.9, 0.1, 0], { provider: 'fake' });
  semanticSearch.storeEmbedding(db, c, [0, 1, 0], { provider: 'fake' });

  const got = semanticSearch.getEmbedding(db, a);
  assert.equal(got.description, 'benchy');
  assert.deepEqual(got.embedding.map((n) => Math.round(n * 1000) / 1000), [1, 0, 0]);

  const similar = semanticSearch.findSimilar(db, a, 5);
  assert.equal(similar.length, 2);
  assert.equal(similar[0].model_id, b);
  assert.ok(similar[0].score > similar[1].score);
  db.close();
});

test('generateEmbedding stub returns null', async () => {
  assert.equal(await semanticSearch.generateEmbedding('hello'), null);
  assert.ok(Array.isArray(semanticSearch.stubEmbeddingFromText('benchy')));
});
