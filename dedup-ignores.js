'use strict';

/**
 * Mark exact-hash duplicate groups as intentional so De-Dup stops surfacing them.
 */

function ensureSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS dedup_ignores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      reason TEXT,
      created_at DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_dedup_ignores_hash ON dedup_ignores(hash)').run();
}

function markIgnore(db, hash, reason = 'intentional') {
  const h = String(hash || '').trim();
  if (!h) throw new Error('Hash is required');
  db.prepare(`
    INSERT INTO dedup_ignores (hash, reason, created_at) VALUES (?, ?, ?)
    ON CONFLICT(hash) DO UPDATE SET reason = COALESCE(excluded.reason, dedup_ignores.reason)
  `).run(h, reason != null ? String(reason) : 'intentional', new Date().toISOString());
  return db.prepare('SELECT * FROM dedup_ignores WHERE hash = ?').get(h);
}

function unmark(db, hash) {
  const h = String(hash || '').trim();
  if (!h) return false;
  return db.prepare('DELETE FROM dedup_ignores WHERE hash = ?').run(h).changes > 0;
}

function isIgnored(db, hash) {
  const h = String(hash || '').trim();
  if (!h) return false;
  return Boolean(db.prepare('SELECT 1 AS ok FROM dedup_ignores WHERE hash = ?').get(h));
}

function listIgnored(db) {
  ensureSchema(db);
  return db.prepare(
    'SELECT id, hash, reason, created_at FROM dedup_ignores ORDER BY created_at DESC, id DESC'
  ).all();
}

/** Accepts either an array of groups or a { hash: files[] } map. */
function filterIgnoredGroups(db, groups) {
  ensureSchema(db);
  if (Array.isArray(groups)) {
    return groups.filter((g) => {
      const hash = g.hash || g.contentHash || (g.models && g.models[0] && g.models[0].hash);
      return !hash || !isIgnored(db, hash);
    });
  }
  if (!groups || typeof groups !== 'object') return {};
  const result = {};
  for (const [hash, files] of Object.entries(groups)) {
    if (isIgnored(db, hash)) continue;
    result[hash] = files;
  }
  return result;
}

module.exports = {
  ensureSchema,
  markIgnore,
  unmark,
  unmarkIgnore: unmark,
  isIgnored,
  listIgnored,
  filterIgnoredGroups
};
