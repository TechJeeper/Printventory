'use strict';

// SQLite cases need Electron's better-sqlite3 binary:
//   $env:ELECTRON_RUN_AS_NODE='1'; npx electron collections.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const collections = require('./collections');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.prepare(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE,
      fileName TEXT,
      designer TEXT,
      parentModel TEXT,
      thumbnail TEXT,
      rating INTEGER,
      favorite INTEGER,
      print_status TEXT,
      print_count INTEGER,
      size INTEGER,
      dateAdded DATETIME
    )
  `).run();
  collections.ensureSchema(db);
  return db;
}

function insertModel(db, name) {
  return db.prepare('INSERT INTO models (filePath, fileName) VALUES (?, ?)').run(name, name).lastInsertRowid;
}

test('creates, lists, renames, and deletes collections', () => {
  const db = createDb();
  const a = collections.createCollection(db, 'Favorites');
  assert.equal(a.name, 'Favorites');
  assert.equal(a.model_count, 0);

  const listed = collections.listCollections(db);
  assert.equal(listed.length, 1);

  const renamed = collections.renameCollection(db, a.id, 'Best Prints');
  assert.equal(renamed.name, 'Best Prints');

  const del = collections.deleteCollection(db, a.id);
  assert.equal(del.deleted, true);
  assert.equal(collections.listCollections(db).length, 0);
  db.close();
});

test('add/remove models and query by collection or model', () => {
  const db = createDb();
  const c = collections.createCollection(db, 'Kit');
  const m1 = insertModel(db, 'a.stl');
  const m2 = insertModel(db, 'b.stl');
  const m3 = insertModel(db, 'c.stl');

  const added = collections.addModels(db, c.id, [m1, m2, m2]);
  assert.equal(added.added, 2);

  const inCol = collections.getModelsInCollection(db, c.id);
  assert.equal(inCol.length, 2);
  assert.deepEqual(inCol.map((r) => r.id).sort(), [m1, m2].sort());

  const forModel = collections.getCollectionsForModel(db, m1);
  assert.equal(forModel.length, 1);
  assert.equal(forModel[0].name, 'Kit');

  collections.removeModels(db, c.id, [m1]);
  assert.equal(collections.getModelsInCollection(db, c.id).length, 1);
  assert.equal(collections.getCollectionsForModel(db, m1).length, 0);

  const filter = collections.collectionFilterSql(c.id);
  assert.ok(filter.sql.includes('collection_models'));
  assert.deepEqual(filter.params, [c.id]);
  assert.equal(collections.collectionFilterSql(0), null);

  collections.addModels(db, c.id, [m3]);
  assert.equal(collections.buildCoverCollage(['x.png', 'y.png']), null);
  db.close();
});

test('rejects duplicate collection names', () => {
  const db = createDb();
  collections.createCollection(db, 'Dup');
  assert.throws(() => collections.createCollection(db, 'Dup'));
  db.close();
});
