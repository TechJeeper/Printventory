'use strict';

/**
 * Soft-delete library rows (deleted_at) with restore + 30-day purge.
 * Also keeps a removed_models snapshot for recently-removed UI.
 */

function ensureSchema(db) {
  try {
    const cols = db.prepare('PRAGMA table_info(models)').all();
    if (cols.length && !cols.some((c) => c.name === 'deleted_at')) {
      db.prepare('ALTER TABLE models ADD COLUMN deleted_at DATETIME').run();
    }
    if (cols.length) {
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_deleted_at ON models(deleted_at)').run();
    }
  } catch (_) { /* models may be absent in some unit tests */ }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS removed_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER,
      filePath TEXT,
      fileName TEXT,
      snapshot_json TEXT NOT NULL,
      removed_at DATETIME NOT NULL
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_removed_models_removed_at ON removed_models(removed_at)').run();
}

function softRemoveFromLibrary(db, modelId) {
  ensureSchema(db);
  const id = Number(modelId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid model id');
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(id);
  if (!row) throw new Error('Model not found');
  if (row.deleted_at) {
    return { removed: true, already: true, id, filePath: row.filePath, fileName: row.fileName };
  }

  const now = new Date().toISOString();
  const { thumbnail, ...rest } = row;
  db.prepare(`
    INSERT INTO removed_models (model_id, filePath, fileName, snapshot_json, removed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, row.filePath || null, row.fileName || null, JSON.stringify(rest), now);
  db.prepare('UPDATE models SET deleted_at = ? WHERE id = ?').run(now, id);
  return { removed: true, id, removedAt: now, filePath: row.filePath, fileName: row.fileName };
}

function restore(db, removedOrModelId) {
  ensureSchema(db);
  const id = Number(removedOrModelId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid id');

  // Prefer snapshot by model_id (library undo), then by removed_models.id, then models.id.
  let snapRow = db.prepare(
    'SELECT * FROM removed_models WHERE model_id = ? ORDER BY id DESC LIMIT 1'
  ).get(id);
  if (!snapRow) {
    snapRow = db.prepare('SELECT * FROM removed_models WHERE id = ?').get(id);
  }
  if (snapRow) {
    const modelId = snapRow.model_id;
    const stillThere = modelId
      ? db.prepare('SELECT id FROM models WHERE id = ?').get(modelId)
      : null;
    if (stillThere) {
      db.prepare('UPDATE models SET deleted_at = NULL WHERE id = ?').run(modelId);
      db.prepare('DELETE FROM removed_models WHERE id = ?').run(id);
      return db.prepare('SELECT * FROM models WHERE id = ?').get(modelId);
    }
    // Row was hard-deleted — re-insert from snapshot
    let snap;
    try { snap = JSON.parse(snapRow.snapshot_json); } catch (_) { throw new Error('Corrupt snapshot'); }
    const filePath = snap.filePath || snapRow.filePath;
    if (!filePath) throw new Error('Snapshot missing filePath');
    if (db.prepare('SELECT id FROM models WHERE filePath = ?').get(filePath)) {
      throw new Error('A model with that path already exists');
    }
    const cols = db.prepare('PRAGMA table_info(models)').all().map((c) => c.name);
    const skip = new Set(['id', 'deleted_at', 'thumbnail']);
    const insertCols = cols.filter((c) => !skip.has(c) && Object.prototype.hasOwnProperty.call(snap, c));
    const result = db.prepare(
      `INSERT INTO models (${insertCols.join(',')}) VALUES (${insertCols.map(() => '?').join(',')})`
    ).run(...insertCols.map((c) => snap[c]));
    db.prepare('DELETE FROM removed_models WHERE id = ?').run(id);
    return db.prepare('SELECT * FROM models WHERE id = ?').get(result.lastInsertRowid);
  }

  const result = db.prepare('UPDATE models SET deleted_at = NULL WHERE id = ?').run(id);
  db.prepare('DELETE FROM removed_models WHERE model_id = ?').run(id);
  if (!result.changes) throw new Error('Removed model not found');
  return db.prepare('SELECT * FROM models WHERE id = ?').get(id);
}

function listRecentlyRemoved(db, limit = 100) {
  ensureSchema(db);
  const n = Math.max(1, Math.min(Number(limit) || 100, 500));
  // Prefer snapshot table; also include soft-deleted models not yet purged.
  const fromSnap = db.prepare(`
    SELECT id, model_id, filePath, fileName, removed_at
    FROM removed_models
    ORDER BY removed_at DESC, id DESC
    LIMIT ?
  `).all(n);
  if (fromSnap.length) return fromSnap;
  try {
    return db.prepare(`
      SELECT id AS model_id, id, filePath, fileName, deleted_at AS removed_at
      FROM models
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT ?
    `).all(n);
  } catch (_) {
    return [];
  }
}

function purgeOlderThan(db, days = 30) {
  ensureSchema(db);
  const d = Math.max(1, Math.floor(Number(days) || 30));
  const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

  const snapResult = db.prepare('DELETE FROM removed_models WHERE removed_at < ?').run(cutoff);

  let modelPurged = 0;
  try {
    const rows = db.prepare(`
      SELECT id FROM models
      WHERE deleted_at IS NOT NULL AND deleted_at < ?
    `).all(cutoff);
    const del = db.prepare('DELETE FROM models WHERE id = ?');
    for (const row of rows) {
      try {
        const printEvents = require('./print-events');
        if (printEvents.deletePrintRowsForModel) printEvents.deletePrintRowsForModel(db, row.id);
      } catch (_) {}
      try { db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(row.id); } catch (_) {}
      try { db.prepare('DELETE FROM model_filaments WHERE model_id = ?').run(row.id); } catch (_) {}
      del.run(row.id);
      modelPurged += 1;
    }
  } catch (_) {}

  return { purged: snapResult.changes + modelPurged, cutoff, days: d };
}

function notDeletedSql(alias = 'models') {
  return `(${alias}.deleted_at IS NULL)`;
}

module.exports = {
  ensureSchema,
  softRemoveFromLibrary,
  restore,
  restoreModel: restore,
  listRecentlyRemoved,
  purgeOlderThan,
  notDeletedSql
};
