'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const filamentCost = require('./filament-cost');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('costForPrint', () => {
  assert.equal(filamentCost.costForPrint(1000, 25), 25);
  assert.equal(filamentCost.costForPrint(500, 20), 10);
  assert.equal(filamentCost.costForPrint(0, 20), 0);
});

test('schema + deduct + low stock', () => {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE filaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      vendor TEXT,
      material TEXT,
      color_hex TEXT,
      diameter REAL,
      spoolman_id INTEGER UNIQUE,
      source TEXT NOT NULL DEFAULT 'manual'
    )
  `).run();
  filamentCost.ensureSchema(db);
  const id = db.prepare(
    'INSERT INTO filaments (name, remaining_weight_g, low_stock_g, price_per_kg) VALUES (?,?,?,?)'
  ).run('PLA', 200, 50, 20).lastInsertRowid;
  const deducted = filamentCost.deductGrams(db, id, 160);
  assert.equal(deducted.ok, true);
  assert.equal(deducted.remaining_weight_g, 40);
  const low = filamentCost.lowStockFilaments(db);
  assert.equal(low.length, 1);
  db.close();
});

console.log('filament-cost tests done');
