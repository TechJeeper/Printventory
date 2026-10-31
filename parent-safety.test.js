'use strict';

// SQLite cases need Electron's better-sqlite3 binary:
//   $env:ELECTRON_RUN_AS_NODE='1'; npx electron parent-safety.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const parentSafety = require('./parent-safety');

function createDb() {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fileName TEXT,
      parentModel TEXT
    )
  `).run();
  return db;
}

function insert(db, fileName, parentModel) {
  return db.prepare('INSERT INTO models (fileName, parentModel) VALUES (?, ?)').run(fileName, parentModel || null).lastInsertRowid;
}

test('detects self and transitive cycles', () => {
  const db = createDb();
  const childId = insert(db, 'child.stl', null);
  insert(db, 'parent.stl', 'child.stl');
  assert.equal(parentSafety.wouldCreateCycle(db, childId, 'child.stl'), true);
  assert.equal(parentSafety.wouldCreateCycle(db, childId, 'parent.stl'), true);
  assert.equal(parentSafety.wouldCreateCycle(db, childId, 'unrelated'), false);
  db.close();
});

test('hasChildren and flattenGroup', () => {
  const db = createDb();
  insert(db, 'kit.stl', null);
  insert(db, 'a.stl', 'kit.stl');
  insert(db, 'b.stl', 'kit.stl');
  assert.equal(parentSafety.hasChildren(db, 'kit.stl'), true);
  assert.equal(parentSafety.hasChildren(db, 'missing'), false);
  const flat = parentSafety.flattenGroup(db, 'kit.stl');
  assert.equal(flat.cleared, 2);
  assert.equal(parentSafety.hasChildren(db, 'kit.stl'), false);
  db.close();
});

test('validateParentAssignment errors on cycle and warns when model has children', () => {
  const db = createDb();
  const parentId = insert(db, 'group.stl', null);
  const childId = insert(db, 'part.stl', 'group.stl');

  const cycle = parentSafety.validateParentAssignment(db, parentId, 'part.stl');
  assert.equal(cycle.ok, false);
  assert.ok(cycle.error);

  const warn = parentSafety.validateParentAssignment(db, parentId, 'Other');
  assert.equal(warn.ok, false);
  assert.ok(warn.warn);
  assert.equal(warn.forceRequired, true);

  const forced = parentSafety.validateParentAssignment(db, parentId, 'Other', { force: true });
  assert.equal(forced.ok, true);

  const clear = parentSafety.validateParentAssignment(db, childId, '');
  assert.equal(clear.ok, true);
  db.close();
});
