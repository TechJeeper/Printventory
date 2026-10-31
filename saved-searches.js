'use strict';

/**
 * Named saved / smart collections of filter + query-builder state.
 */

function ensureSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      state_json TEXT NOT NULL,
      smart INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT (datetime('now')),
      updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_saved_searches_pinned ON saved_searches(pinned)').run();
}

function listSavedSearches(db) {
  return db.prepare(`
    SELECT id, name, state_json, smart, pinned, created_at, updated_at
    FROM saved_searches
    ORDER BY pinned DESC, name COLLATE NOCASE
  `).all().map(hydrate);
}

function hydrate(row) {
  if (!row) return null;
  let state = {};
  try { state = JSON.parse(row.state_json || '{}'); } catch (_) { state = {}; }
  return {
    id: row.id,
    name: row.name,
    state,
    smart: !!row.smart,
    pinned: !!row.pinned,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function getSavedSearch(db, id) {
  return hydrate(db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(id));
}

function saveSearch(db, { name, state, smart = true, pinned = false }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Name is required');
  const json = JSON.stringify(state || {});
  const info = db.prepare(`
    INSERT INTO saved_searches (name, state_json, smart, pinned)
    VALUES (?, ?, ?, ?)
  `).run(trimmed, json, smart ? 1 : 0, pinned ? 1 : 0);
  return getSavedSearch(db, info.lastInsertRowid);
}

function updateSavedSearch(db, id, patch = {}) {
  const current = getSavedSearch(db, id);
  if (!current) throw new Error('Saved search not found');
  const name = patch.name != null ? String(patch.name).trim() : current.name;
  if (!name) throw new Error('Name is required');
  const state = patch.state != null ? patch.state : current.state;
  const smart = patch.smart != null ? !!patch.smart : current.smart;
  const pinned = patch.pinned != null ? !!patch.pinned : current.pinned;
  db.prepare(`
    UPDATE saved_searches
    SET name = ?, state_json = ?, smart = ?, pinned = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, JSON.stringify(state || {}), smart ? 1 : 0, pinned ? 1 : 0, id);
  return getSavedSearch(db, id);
}

function deleteSavedSearch(db, id) {
  return db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
}

/**
 * Build SQL fragments for numeric / date operators stored in state.numeric.
 * @returns {{ sql: string, params: any[] }[]}
 */
function buildNumericFilterClauses(numeric = {}) {
  const clauses = [];
  if (!numeric || typeof numeric !== 'object') return clauses;

  if (numeric.sizeGt != null && Number.isFinite(Number(numeric.sizeGt))) {
    clauses.push({ sql: 'COALESCE(models.size, 0) > ?', params: [Number(numeric.sizeGt)] });
  }
  if (numeric.sizeLt != null && Number.isFinite(Number(numeric.sizeLt))) {
    clauses.push({ sql: 'COALESCE(models.size, 0) < ?', params: [Number(numeric.sizeLt)] });
  }
  if (numeric.dateAddedWithinDays != null && Number.isFinite(Number(numeric.dateAddedWithinDays))) {
    const days = Math.max(0, Math.floor(Number(numeric.dateAddedWithinDays)));
    clauses.push({
      sql: `models.dateAdded IS NOT NULL AND julianday('now') - julianday(models.dateAdded) <= ?`,
      params: [days]
    });
  }
  if (numeric.printCountGt != null && Number.isFinite(Number(numeric.printCountGt))) {
    clauses.push({
      sql: 'COALESCE(models.print_count, 0) > ?',
      params: [Number(numeric.printCountGt)]
    });
  }
  if (numeric.lastPrintedBefore) {
    clauses.push({
      sql: 'models.last_printed_at IS NOT NULL AND models.last_printed_at < ?',
      params: [String(numeric.lastPrintedBefore)]
    });
  }
  if (numeric.ratingGte != null && Number.isFinite(Number(numeric.ratingGte))) {
    clauses.push({
      sql: 'COALESCE(models.rating, 0) >= ?',
      params: [Number(numeric.ratingGte)]
    });
  }
  return clauses;
}

function serializeFilterState(state) {
  return JSON.stringify(state || {});
}

function deserializeFilterState(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

module.exports = {
  ensureSchema,
  listSavedSearches,
  getSavedSearch,
  saveSearch,
  updateSavedSearch,
  deleteSavedSearch,
  buildNumericFilterClauses,
  serializeFilterState,
  deserializeFilterState,
  // Aliases matching brainstorm API
  list: listSavedSearches,
  get: getSavedSearch,
  save: saveSearch,
  update: updateSavedSearch,
  delete: deleteSavedSearch
};
