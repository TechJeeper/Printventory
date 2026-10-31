'use strict';

// SQLite cases need Electron's better-sqlite3 binary:
//   $env:ELECTRON_RUN_AS_NODE='1'; npx electron saved-searches.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const savedSearches = require('./saved-searches');
const {
  sizeGt,
  dateAddedWithinDays,
  printCountGt,
  lastPrintedBefore,
  ratingGte,
  applyNumericFilters,
  serializeFilterState,
  deserializeFilterState
} = require('./query-builder-filters');

function createDb() {
  const db = new Database(':memory:');
  savedSearches.ensureSchema(db);
  return db;
}

test('CRUD saved searches with filter state JSON', () => {
  const db = createDb();
  const state = {
    searchBoolTokens: [{ t: 'text', value: 'benchy' }],
    designer: 'Maker',
    numeric: { sizeGt: 1000, ratingGte: 4 }
  };
  const created = savedSearches.save(db, { name: 'Big rated', state, smart: true, pinned: true });
  assert.equal(created.name, 'Big rated');
  assert.equal(created.smart, true);
  assert.equal(created.pinned, true);
  assert.equal(created.state.designer, 'Maker');

  const listed = savedSearches.list(db);
  assert.equal(listed.length, 1);

  const updated = savedSearches.update(db, created.id, { name: 'Updated', pinned: false });
  assert.equal(updated.name, 'Updated');
  assert.equal(updated.pinned, false);

  assert.equal(savedSearches.get(db, created.id).name, 'Updated');
  savedSearches.delete(db, created.id);
  assert.equal(savedSearches.list(db).length, 0);
  db.close();
});

test('numeric filter helpers build SQL fragments', () => {
  assert.deepEqual(sizeGt(500), { op: 'sizeGt', value: 500 });
  assert.deepEqual(dateAddedWithinDays(7), { op: 'dateAddedWithinDays', value: 7 });
  assert.deepEqual(printCountGt(2), { op: 'printCountGt', value: 2 });
  assert.equal(lastPrintedBefore('not-a-date'), null);
  assert.equal(ratingGte(3).op, 'ratingGte');

  const { sqlFragments, params } = applyNumericFilters({
    sizeGt: 100,
    printCountGt: 1,
    ratingGte: 4,
    dateAddedWithinDays: 14,
    lastPrintedBefore: '2024-01-01T00:00:00.000Z'
  });
  assert.equal(sqlFragments.length, 5);
  assert.ok(params.length >= 5);

  const fromSaved = savedSearches.buildNumericFilterClauses({
    sizeGt: 100,
    ratingGte: 3
  });
  assert.equal(fromSaved.length, 2);

  const roundTrip = deserializeFilterState(serializeFilterState({ a: 1 }));
  assert.deepEqual(roundTrip, { a: 1 });
});
