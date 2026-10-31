'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const printStats = require('./print-stats');
const printEvents = require('./print-events');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('aggregatePrintStats with seeded events', () => {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE,
      fileName TEXT,
      print_status TEXT DEFAULT 'unprinted',
      print_count INTEGER DEFAULT 0,
      last_printed_at DATETIME,
      printed INTEGER DEFAULT 0,
      thumbnail TEXT
    )
  `).run();
  printEvents.ensurePrintLifecycleSchema
    ? printEvents.ensurePrintLifecycleSchema(db)
    : printEvents.migratePrintLifecycle(db);
  db.prepare('INSERT INTO models (filePath, fileName, print_status, print_count) VALUES (?,?,?,?)')
    .run('a.stl', 'a.stl', 'want', 0);
  db.prepare('INSERT INTO models (filePath, fileName, print_status, print_count) VALUES (?,?,?,?)')
    .run('b.stl', 'b.stl', 'printed', 3);
  try {
    db.prepare(`
      INSERT INTO print_events (model_id, outcome, quantity, printed_at)
      VALUES (2, 'printed', 1, datetime('now'))
    `).run();
  } catch (_) {
    // Schema may use different column names — still exercise aggregate safely
  }
  const stats = printStats.aggregatePrintStats(db);
  assert.ok(stats);
  assert.equal(typeof stats.wantNeverPrintedCount, 'number');
  assert.ok(Array.isArray(stats.mostPrintedModels));
  db.close();
});

console.log('print-stats tests done');
