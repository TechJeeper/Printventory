#!/usr/bin/env node
'use strict';

// SQLite cases need Electron's better-sqlite3 binary:
//   $env:ELECTRON_RUN_AS_NODE='1'; npx electron print-events.test.js
const assert = require('assert');
const Database = require('better-sqlite3');
const printEvents = require('./print-events');

function insertModel(db, values) {
  const filePath = values.filePath;
  const fileName = values.fileName || filePath;
  const printed = values.printed != null ? values.printed : 0;
  const printStatus = values.print_status || 'unprinted';
  const printCount = values.print_count != null ? values.print_count : 0;
  return db.prepare(
    'INSERT INTO models (filePath, fileName, printed, print_status, print_count) VALUES (?, ?, ?, ?, ?)'
  ).run(filePath, fileName, printed, printStatus, printCount).lastInsertRowid;
}

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
  db.pragma('foreign_keys = ON');
  db.prepare(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE,
      fileName TEXT,
      printed INTEGER,
      print_status TEXT,
      print_count INTEGER,
      last_printed_at DATETIME
    )
  `).run();
  db.prepare(`
    CREATE TABLE filaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      vendor TEXT,
      material TEXT,
      color_hex TEXT,
      diameter REAL,
      spoolman_id INTEGER,
      source TEXT
    )
  `).run();
  db.prepare(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `).run();
  printEvents.migratePrintLifecycle(db);
  return db;
}

test('migration sets printed=1 rows to printed status without inventing history', () => {
  const db = createDb();
  db.prepare("INSERT INTO models (filePath, fileName, printed) VALUES ('a.stl', 'a.stl', 1)").run();
  db.prepare("INSERT INTO models (filePath, fileName, printed) VALUES ('b.stl', 'b.stl', 0)").run();
  printEvents.migratePrintLifecycle(db);
  const printed = db.prepare("SELECT * FROM models WHERE filePath = 'a.stl'").get();
  const unprinted = db.prepare("SELECT * FROM models WHERE filePath = 'b.stl'").get();
  assert.strictEqual(printed.print_status, 'printed');
  assert.strictEqual(printed.print_count, 0);
  assert.strictEqual(printed.last_printed_at, null);
  assert.strictEqual(unprinted.print_status, 'unprinted');
  db.close();
});

test('logging a successful print sets Printed, count, and last_printed_at', () => {
  const db = createDb();
  const id = insertModel(db, { filePath: 'c.stl', printed: 0, print_status: 'want', print_count: 0 });
  const result = printEvents.logPrintEvent(db, {
    modelId: id,
    outcome: 'printed',
    quantity: 2,
    notes: '0.2mm, cracked at hinge',
    printedAt: '2026-09-01T12:00:00.000Z'
  });
  assert.strictEqual(result.model.print_status, 'printed');
  assert.strictEqual(result.model.print_count, 2);
  assert.strictEqual(result.model.printed, 1);
  assert.ok(String(result.model.last_printed_at).includes('2026-09-01'));
  const events = printEvents.getPrintEvents(db, id);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].quantity, 2);
  assert.strictEqual(events[0].notes, '0.2mm, cracked at hinge');
  db.close();
});

test('failed and cancelled outcomes write history without faking a successful count', () => {
  const db = createDb();
  const id = insertModel(db, { filePath: 'd.stl', printed: 0, print_status: 'printing', print_count: 0 });
  printEvents.logPrintEvent(db, { modelId: id, outcome: 'failed' });
  let model = db.prepare('SELECT * FROM models WHERE id = ?').get(id);
  assert.strictEqual(model.print_status, 'failed');
  assert.strictEqual(model.print_count, 0);
  assert.strictEqual(model.printed, 0);

  printEvents.setPrintStatus(db, { modelId: id, printStatus: 'printing' });
  printEvents.logPrintEvent(db, { modelId: id, outcome: 'cancelled' });
  model = db.prepare('SELECT * FROM models WHERE id = ?').get(id);
  assert.strictEqual(model.print_status, 'queued');
  assert.strictEqual(model.print_count, 0);
  db.close();
});

test('deleting the last successful print falls back to unprinted', () => {
  const db = createDb();
  const id = insertModel(db, { filePath: 'e.stl', printed: 0, print_status: 'unprinted', print_count: 0 });
  const logged = printEvents.logPrintEvent(db, { modelId: id, outcome: 'printed' });
  printEvents.deletePrintEvent(db, logged.eventId);
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(id);
  assert.strictEqual(model.print_count, 0);
  assert.strictEqual(model.print_status, 'unprinted');
  assert.strictEqual(model.printed, 0);
  db.close();
});

test('status-only change does not create a history row', () => {
  const db = createDb();
  const id = insertModel(db, { filePath: 'f.stl', printed: 0, print_status: 'unprinted', print_count: 0 });
  printEvents.setPrintStatus(db, { modelId: id, printStatus: 'want' });
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(id);
  assert.strictEqual(model.print_status, 'want');
  assert.strictEqual(model.printed, 0);
  assert.strictEqual(printEvents.getPrintEvents(db, id).length, 0);
  db.close();
});

test('derived printed stays true after a later failed reprint', () => {
  const db = createDb();
  const id = insertModel(db, { filePath: 'g.stl', printed: 0, print_status: 'unprinted', print_count: 0 });
  printEvents.logPrintEvent(db, { modelId: id, outcome: 'printed' });
  printEvents.logPrintEvent(db, { modelId: id, outcome: 'failed' });
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(id);
  assert.strictEqual(model.print_status, 'failed');
  assert.strictEqual(model.print_count, 1);
  assert.strictEqual(model.printed, 1);
  db.close();
});

test('event filaments attach without changing model assignments', () => {
  const db = createDb();
  const modelId = insertModel(db, { filePath: 'h.stl', printed: 0, print_status: 'unprinted', print_count: 0 });
  const filamentId = db.prepare("INSERT INTO filaments (name, vendor, material, source) VALUES ('PolyTerra', 'Polymaker', 'PLA', 'manual')").run().lastInsertRowid;
  printEvents.logPrintEvent(db, { modelId, outcome: 'printed', filamentIds: [filamentId] });
  const events = printEvents.getPrintEvents(db, modelId);
  assert.strictEqual(events[0].filaments.length, 1);
  assert.strictEqual(events[0].filaments[0].name, 'PolyTerra');
  db.close();
});

test('filters distinguish status, ever-printed, and legacy not-printed', () => {
  const printedNoLog = { printed: 1, print_status: 'printed', print_count: 0 };
  const want = { printed: 0, print_status: 'want', print_count: 0 };
  const reprint = { printed: 1, print_status: 'failed', print_count: 2 };
  assert.strictEqual(printEvents.modelMatchesPrintFilter(printedNoLog, 'printed'), true);
  assert.strictEqual(printEvents.modelMatchesPrintFilter(printedNoLog, 'ever-printed'), false);
  assert.strictEqual(printEvents.modelMatchesPrintFilter(want, 'want'), true);
  assert.strictEqual(printEvents.modelMatchesPrintFilter(want, 'not-printed'), true);
  assert.strictEqual(printEvents.modelMatchesPrintFilter(reprint, 'failed'), true);
  assert.strictEqual(printEvents.modelMatchesPrintFilter(reprint, 'ever-printed'), true);
  assert.strictEqual(printEvents.modelMatchesPrintFilter(reprint, 'printed'), false);
});

test('badge text uses reprint count and bundle summary mixed/printed', () => {
  assert.strictEqual(printEvents.badgeText({ print_status: 'printed', print_count: 3 }), 'Printed ×3');
  assert.strictEqual(printEvents.badgeText({ print_status: 'want', print_count: 0 }), 'Want');
  const mixed = printEvents.bundlePrintSummary([
    { printed: 1, print_status: 'printed', print_count: 2 },
    { printed: 0, print_status: 'unprinted', print_count: 0 }
  ]);
  assert.strictEqual(mixed.mixed, true);
  assert.ok(mixed.label.startsWith('Mixed'));
  const all = printEvents.bundlePrintSummary([
    { printed: 1, print_status: 'printed', print_count: 1 },
    { printed: 1, print_status: 'printed', print_count: 1 }
  ]);
  assert.strictEqual(all.mixed, false);
  assert.strictEqual(all.label, 'Printed ×2');
});

test('save helper maps legacy printed checkbox without wiping counts', () => {
  const existing = { printed: 1, print_status: 'printed', print_count: 4, last_printed_at: '2026-01-01' };
  const cleared = printEvents.resolvePrintFieldsOnSave(existing, { printed: false });
  assert.strictEqual(cleared.print_status, 'unprinted');
  assert.strictEqual(cleared.print_count, 4);
  assert.strictEqual(cleared.printed, 1);
  const stamped = printEvents.resolvePrintFieldsOnSave(existing, { printStatus: 'queued' });
  assert.strictEqual(stamped.print_status, 'queued');
  assert.strictEqual(stamped.printed, 1);
  const preserved = printEvents.resolvePrintFieldsOnSave(
    { printed: 0, print_status: 'want', print_count: 0, last_printed_at: null },
    { printed: 0 }
  );
  assert.strictEqual(preserved.print_status, 'want');
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
