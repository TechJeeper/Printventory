'use strict';

// SQLite cases need Electron's better-sqlite3 binary:
//   $env:ELECTRON_RUN_AS_NODE='1'; npx electron geometry-fingerprint.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const geometryFingerprint = require('./geometry-fingerprint');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.prepare(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE,
      fileName TEXT
    )
  `).run();
  geometryFingerprint.ensureSchema(db);
  return db;
}

function insertModel(db, name) {
  return db.prepare('INSERT INTO models (filePath, fileName) VALUES (?, ?)').run(name, name).lastInsertRowid;
}

test('computeFingerprint normalizes bbox order', () => {
  const fp = geometryFingerprint.computeFingerprint({
    triangleCount: 100,
    bbox: [30, 10, 20],
    volume: 5,
    surfaceArea: 12,
    vertexHistogram: [1, 2, 3]
  });
  assert.deepEqual(fp.bbox, [10, 20, 30]);
  assert.equal(fp.triangleCount, 100);
});

test('fingerprintDistance is high for near-identical meshes', () => {
  const a = geometryFingerprint.computeFingerprint({
    triangleCount: 1000,
    bbox: [10, 20, 30],
    volume: 100,
    surfaceArea: 50
  });
  const b = geometryFingerprint.computeFingerprint({
    triangleCount: 1005,
    bbox: [10.1, 20, 30],
    volume: 101,
    surfaceArea: 50.5
  });
  const c = geometryFingerprint.computeFingerprint({
    triangleCount: 50,
    bbox: [1, 2, 3],
    volume: 1,
    surfaceArea: 1
  });
  assert.ok(geometryFingerprint.fingerprintDistance(a, b) > 0.9);
  assert.ok(geometryFingerprint.fingerprintDistance(a, c) < 0.5);
  assert.ok(geometryFingerprint.fingerprintDistance(a, a) > 0.99);
});

test('findNearDuplicates groups similar stored geometry', () => {
  const db = createDb();
  const m1 = insertModel(db, 'a.stl');
  const m2 = insertModel(db, 'b.stl');
  const m3 = insertModel(db, 'c.stl');
  geometryFingerprint.storeGeometry(db, m1, {
    triangleCount: 1000,
    bbox: [10, 20, 30],
    volume: 100,
    surfaceArea: 50
  });
  geometryFingerprint.storeGeometry(db, m2, {
    triangleCount: 1002,
    bbox: [10, 20, 30],
    volume: 100.5,
    surfaceArea: 50.2
  });
  geometryFingerprint.storeGeometry(db, m3, {
    triangleCount: 10,
    bbox: [1, 1, 1],
    volume: 0.1,
    surfaceArea: 0.5
  });

  const groups = geometryFingerprint.findNearDuplicates(db, 0.9);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].size, 2);
  assert.ok(groups[0].modelIds.includes(m1));
  assert.ok(groups[0].modelIds.includes(m2));
  assert.ok(!groups[0].modelIds.includes(m3));
  db.close();
});
