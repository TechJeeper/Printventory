#!/usr/bin/env node
'use strict';

// SQLite cases need Electron's better-sqlite3 binary:
//   $env:ELECTRON_RUN_AS_NODE='1'; npx electron tests/repair-model-tags.test.js

const assert = require('assert');
const Database = require('better-sqlite3');
const { repairModelTags, modelTagsForeignKeysBroken } = require('../db-repair');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

function createBase(db) {
  db.exec(`
    CREATE TABLE models (id INTEGER PRIMARY KEY, fileName TEXT);
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
  `);
}

function createModelTags(db) {
  db.exec(`
    CREATE TABLE model_tags (
      model_id INTEGER,
      tag_id INTEGER,
      FOREIGN KEY(model_id) REFERENCES models(id),
      FOREIGN KEY(tag_id) REFERENCES tags(id),
      PRIMARY KEY(model_id, tag_id)
    );
  `);
}

function links(db) {
  return db.prepare('SELECT model_id, tag_id FROM model_tags ORDER BY model_id, tag_id').all();
}

test('rebuilds model_tags when foreign keys still reference models_old', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  createBase(db);
  createModelTags(db);
  db.exec(`
    INSERT INTO models (id, fileName) VALUES (1, 'lid.3mf'), (2, 'base.stl');
    INSERT INTO tags (id, name) VALUES (1, 'Kitchen'), (2, 'Gone');
    INSERT INTO model_tags (model_id, tag_id) VALUES (1, 1), (99, 1), (1, 50);
  `);
  db.pragma('foreign_keys = ON');
  db.exec('ALTER TABLE models RENAME TO models_old');
  db.exec(`
    CREATE TABLE models (id INTEGER PRIMARY KEY, fileName TEXT);
    INSERT INTO models (id, fileName) SELECT id, fileName FROM models_old;
  `);
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE models_old');
  db.pragma('foreign_keys = ON');

  assert.strictEqual(modelTagsForeignKeysBroken(db), true);
  assert.throws(() => db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(1), /models_old/);

  const result = repairModelTags(db);
  assert.deepStrictEqual(result, { ok: true, rebuilt: true, orphansRemoved: 2 });
  assert.strictEqual(modelTagsForeignKeysBroken(db), false);
  assert.deepStrictEqual(links(db), [{ model_id: 1, tag_id: 1 }]);
  assert.deepStrictEqual(db.pragma('foreign_key_check(model_tags)'), []);

  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'model_tags'").get().sql;
  assert.match(sql, /REFERENCES models\(id\)/);
  assert.doesNotMatch(sql, /models_old/);

  db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(1);
  assert.deepStrictEqual(links(db), []);
  db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(2, 1);
  assert.throws(
    () => db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(3, 1),
    /FOREIGN KEY/
  );
  db.close();
});

test('drops a leftover models_old table after retargeting foreign keys', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  createBase(db);
  createModelTags(db);
  db.exec(`
    INSERT INTO models (id, fileName) VALUES (1, 'lid.3mf');
    INSERT INTO tags (id, name) VALUES (1, 'Kitchen');
    INSERT INTO model_tags (model_id, tag_id) VALUES (1, 1);
  `);
  db.pragma('foreign_keys = ON');
  db.exec('ALTER TABLE models RENAME TO models_old');
  db.exec(`
    CREATE TABLE models (id INTEGER PRIMARY KEY, fileName TEXT);
    INSERT INTO models (id, fileName) SELECT id, fileName FROM models_old;
  `);
  assert.throws(() => db.exec('DROP TABLE models_old'), /FOREIGN KEY/);

  const result = repairModelTags(db);
  assert.strictEqual(result.rebuilt, true);
  assert.strictEqual(result.orphansRemoved, 0);
  assert.strictEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE name = 'models_old'").get(),
    undefined
  );
  assert.deepStrictEqual(links(db), [{ model_id: 1, tag_id: 1 }]);
  db.close();
});

test('removes orphan links without rebuilding a healthy model_tags table', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  createBase(db);
  createModelTags(db);
  db.exec(`
    INSERT INTO models (id, fileName) VALUES (1, 'lid.3mf');
    INSERT INTO tags (id, name) VALUES (1, 'Kitchen');
    INSERT INTO model_tags (model_id, tag_id) VALUES (1, 1), (1, 9);
  `);
  db.pragma('foreign_keys = ON');
  const before = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'model_tags'").get().sql;

  const result = repairModelTags(db);
  assert.deepStrictEqual(result, { ok: true, rebuilt: false, orphansRemoved: 1 });
  assert.strictEqual(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'model_tags'").get().sql, before);
  assert.deepStrictEqual(links(db), [{ model_id: 1, tag_id: 1 }]);
  assert.deepStrictEqual(db.pragma('foreign_key_check(model_tags)'), []);
  db.close();
});

test('leaves a clean model_tags table unchanged', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createBase(db);
  createModelTags(db);
  db.exec(`
    INSERT INTO models (id, fileName) VALUES (1, 'lid.3mf');
    INSERT INTO tags (id, name) VALUES (1, 'Kitchen');
    INSERT INTO model_tags (model_id, tag_id) VALUES (1, 1);
  `);
  const before = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'model_tags'").get().sql;
  const result = repairModelTags(db);
  assert.deepStrictEqual(result, { ok: true, rebuilt: false, orphansRemoved: 0 });
  assert.strictEqual(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'model_tags'").get().sql, before);
  assert.deepStrictEqual(links(db), [{ model_id: 1, tag_id: 1 }]);
  db.close();
});
