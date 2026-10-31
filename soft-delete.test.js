#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const softDelete = require('./soft-delete');
const { trashLibraryFile, unlinkLibraryFile } = require('./delete-model-file');

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => console.log(`ok ${name}`),
        (err) => {
          console.error(`FAIL ${name}:`, err.message);
          process.exitCode = 1;
        }
      );
    }
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
      fileName TEXT,
      notes TEXT,
      printed INTEGER DEFAULT 0
    )
  `).run();
  softDelete.ensureSchema(db);
  return db;
}

(async () => {
  await test('softRemoveFromLibrary sets deleted_at and snapshots', () => {
    const db = createDb();
    const id = db.prepare(
      "INSERT INTO models (filePath, fileName, notes) VALUES ('C:/a.stl', 'a.stl', 'hello')"
    ).run().lastInsertRowid;
    const result = softDelete.softRemoveFromLibrary(db, id);
    assert.strictEqual(result.removed, true);
    const row = db.prepare('SELECT deleted_at FROM models WHERE id = ?').get(id);
    assert.ok(row.deleted_at);
    const recent = softDelete.listRecentlyRemoved(db);
    assert.strictEqual(recent.length, 1);
    assert.strictEqual(recent[0].fileName, 'a.stl');
    db.close();
  });

  await test('restore clears deleted_at', () => {
    const db = createDb();
    const id = db.prepare(
      "INSERT INTO models (filePath, fileName, notes) VALUES ('C:/b.stl', 'b.stl', 'note')"
    ).run().lastInsertRowid;
    softDelete.softRemoveFromLibrary(db, id);
    const removedId = softDelete.listRecentlyRemoved(db)[0].id;
    const restored = softDelete.restore(db, removedId);
    assert.strictEqual(restored.filePath, 'C:/b.stl');
    assert.strictEqual(restored.deleted_at, null);
    db.close();
  });

  await test('purgeOlderThan removes stale snapshots', () => {
    const db = createDb();
    const id = db.prepare(
      "INSERT INTO models (filePath, fileName) VALUES ('C:/c.stl', 'c.stl')"
    ).run().lastInsertRowid;
    softDelete.softRemoveFromLibrary(db, id);
    db.prepare("UPDATE removed_models SET removed_at = '2000-01-01T00:00:00.000Z'").run();
    db.prepare("UPDATE models SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(id);
    const purged = softDelete.purgeOlderThan(db, 30);
    assert.ok(purged.purged >= 1);
    db.close();
  });

  await test('trashLibraryFile prefers injected trashFn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-trash-'));
    const file = path.join(dir, 'x.stl');
    fs.writeFileSync(file, 'stl');
    let called = false;
    const result = await trashLibraryFile(file, {
      trashFn: async () => { called = true; }
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.trashed, true);
    assert.strictEqual(called, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('trashLibraryFile falls back to unlink when trash unavailable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-trash2-'));
    const file = path.join(dir, 'y.stl');
    fs.writeFileSync(file, 'stl');
    const result = await trashLibraryFile(file, {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.trashed, false);
    assert.strictEqual(fs.existsSync(file), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('unlinkLibraryFile still force-deletes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-unlink-'));
    const file = path.join(dir, 'z.stl');
    fs.writeFileSync(file, 'stl');
    const result = await unlinkLibraryFile(file);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.existsSync(file), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
})();
