#!/usr/bin/env node
'use strict';

// SQLite cases need Electron's better-sqlite3 binary:
//   $env:ELECTRON_RUN_AS_NODE='1'; npx electron tests/folder-tags.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { applyFolderTagsToModels, shouldAutoTagNewScanFiles } = require('../folder-tags');

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
  db.prepare(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE,
      fileName TEXT
    )
  `).run();
  db.prepare(`
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE
    )
  `).run();
  db.prepare(`
    CREATE TABLE model_tags (
      model_id INTEGER,
      tag_id INTEGER,
      UNIQUE(model_id, tag_id)
    )
  `).run();
  return db;
}

function tagsFor(db, filePath) {
  return db.prepare(`
    SELECT tags.name FROM tags
    JOIN model_tags ON model_tags.tag_id = tags.id
    JOIN models ON models.id = model_tags.model_id
    WHERE models.filePath = ?
    ORDER BY tags.name COLLATE NOCASE
  `).all(filePath).map((row) => row.name);
}

test('auto tag on scan is off unless the setting is enabled and folder levels are positive', () => {
  assert.strictEqual(shouldAutoTagNewScanFiles('0', 2), false);
  assert.strictEqual(shouldAutoTagNewScanFiles(null, 2), false);
  assert.strictEqual(shouldAutoTagNewScanFiles('1', 0), false);
  assert.strictEqual(shouldAutoTagNewScanFiles('1', 2), true);
});

test('folder tags are added for new files and do not remove existing tags', () => {
  const db = createDb();
  const filePath = 'D:/library/Kitchen/Bagel Slicer/lid.3mf';
  const existingPath = 'D:/library/Kitchen/Already Tagged/old.stl';
  const modelId = db.prepare('INSERT INTO models (filePath, fileName) VALUES (?, ?)').run(filePath, 'lid.3mf').lastInsertRowid;
  const existingId = db.prepare('INSERT INTO models (filePath, fileName) VALUES (?, ?)').run(existingPath, 'old.stl').lastInsertRowid;
  const handmade = db.prepare('INSERT INTO tags (name) VALUES (?)').run('Handmade').lastInsertRowid;
  db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(modelId, handmade);
  db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(existingId, handmade);

  const first = applyFolderTagsToModels(db, [filePath], 2);
  assert.strictEqual(first.updated, 1);
  assert.strictEqual(first.tagsAdded, 2);
  assert.deepStrictEqual(tagsFor(db, filePath), ['Bagel Slicer', 'Handmade', 'Kitchen']);
  assert.deepStrictEqual(tagsFor(db, existingPath), ['Handmade']);

  const again = applyFolderTagsToModels(db, [filePath], 2);
  assert.deepStrictEqual(again, { updated: 0, tagsAdded: 0 });
  assert.deepStrictEqual(tagsFor(db, filePath), ['Bagel Slicer', 'Handmade', 'Kitchen']);
  db.close();
});

test('scan applies folder tags only to paths inserted by that scan', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes('ingestState.newFilePaths.push(file.filePath)'));
  assert.ok(main.includes('applyFolderTagsToNewScanFiles(ingestState.newFilePaths)'));
  assert.ok(!main.includes('applyFolderTagsToNewScanFiles(allFilePaths)'));
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('id="auto-tag-from-folder-on-scan"'));
  assert.ok(html.includes('This does not call AI.'));
  assert.ok(renderer.includes("saveSetting('autoTagFromFolderOnScan'"));
  assert.ok(renderer.includes("getSetting('autoTagFromFolderOnScan')"));
});
