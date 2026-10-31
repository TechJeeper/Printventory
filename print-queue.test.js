#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const printEvents = require('./print-events');
const printQueue = require('./print-queue');

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
      fileName TEXT,
      printed INTEGER DEFAULT 0,
      print_status TEXT,
      print_count INTEGER DEFAULT 0,
      last_printed_at DATETIME,
      designer TEXT,
      rating INTEGER,
      favorite INTEGER
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
  printEvents.migratePrintLifecycle(db);
  return db;
}

test('getQueueBoard groups by print_status', () => {
  const db = createDb();
  db.prepare("INSERT INTO models (filePath, fileName, print_status) VALUES ('a.stl','a.stl','want')").run();
  db.prepare("INSERT INTO models (filePath, fileName, print_status) VALUES ('b.stl','b.stl','queued')").run();
  db.prepare("INSERT INTO models (filePath, fileName, print_status) VALUES ('c.stl','c.stl','printing')").run();
  const board = printQueue.getQueueBoard(db);
  assert.strictEqual(board.want.length, 1);
  assert.strictEqual(board.queued.length, 1);
  assert.strictEqual(board.printing.length, 1);
  db.close();
});

test('startPrint sets status to printing', () => {
  const db = createDb();
  const id = db.prepare(
    "INSERT INTO models (filePath, fileName, print_status) VALUES ('d.stl','d.stl','queued')"
  ).run().lastInsertRowid;
  const result = printQueue.startPrint(db, id, { printerId: 1 });
  assert.strictEqual(result.status, 'printing');
  assert.strictEqual(db.prepare('SELECT print_status FROM models WHERE id = ?').get(id).print_status, 'printing');
  db.close();
});

test('filamentTotalsPerColumn returns counts per column', () => {
  const db = createDb();
  db.prepare("INSERT INTO models (filePath, fileName, print_status) VALUES ('e.stl','e.stl','want')").run();
  const totals = printQueue.filamentTotalsPerColumn(db);
  assert.ok('want' in totals);
  assert.ok('printing' in totals);
  db.close();
});
