'use strict';

/**
 * User-named collections / projects. A model can belong to many collections.
 */

function ensureSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      cover_path TEXT,
      created_at DATETIME NOT NULL DEFAULT (datetime('now')),
      updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS collection_models (
      collection_id INTEGER NOT NULL,
      model_id INTEGER NOT NULL,
      added_at DATETIME NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (collection_id, model_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_collection_models_model ON collection_models(model_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name)').run();
}

function listCollections(db) {
  return db.prepare(`
    SELECT c.id, c.name, c.cover_path, c.created_at, c.updated_at,
           COUNT(cm.model_id) AS model_count
    FROM collections c
    LEFT JOIN collection_models cm ON cm.collection_id = c.id
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all();
}

function createCollection(db, name, coverPath = null) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Collection name is required');
  const existing = db.prepare(
    'SELECT id FROM collections WHERE name = ? COLLATE NOCASE'
  ).get(trimmed);
  if (existing) {
    throw new Error(`A collection named “${trimmed}” already exists`);
  }
  try {
    const info = db.prepare(
      'INSERT INTO collections (name, cover_path) VALUES (?, ?)'
    ).run(trimmed, coverPath || null);
    return getCollection(db, info.lastInsertRowid);
  } catch (err) {
    if (err && String(err.code || '').includes('CONSTRAINT')) {
      throw new Error(`A collection named “${trimmed}” already exists`);
    }
    throw err;
  }
}

function getCollection(db, id) {
  return db.prepare(`
    SELECT c.id, c.name, c.cover_path, c.created_at, c.updated_at,
           COUNT(cm.model_id) AS model_count
    FROM collections c
    LEFT JOIN collection_models cm ON cm.collection_id = c.id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id) || null;
}

function renameCollection(db, id, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Collection name is required');
  const clash = db.prepare(
    'SELECT id FROM collections WHERE name = ? COLLATE NOCASE AND id != ?'
  ).get(trimmed, id);
  if (clash) {
    throw new Error(`A collection named “${trimmed}” already exists`);
  }
  try {
    db.prepare(
      `UPDATE collections SET name = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(trimmed, id);
  } catch (err) {
    if (err && String(err.code || '').includes('CONSTRAINT')) {
      throw new Error(`A collection named “${trimmed}” already exists`);
    }
    throw err;
  }
  return getCollection(db, id);
}

function deleteCollection(db, id) {
  const existing = getCollection(db, id);
  if (!existing) throw new Error('Collection not found');
  db.prepare('DELETE FROM collection_models WHERE collection_id = ?').run(id);
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  return { deleted: true, id: Number(id), name: existing.name };
}

/** Optional collage stub — returns null until image compositing is implemented. */
function buildCoverCollage(paths) {
  if (!Array.isArray(paths) || !paths.length) return null;
  return null;
}

function addModels(db, collectionId, modelIds) {
  const ids = (Array.isArray(modelIds) ? modelIds : [modelIds])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO collection_models (collection_id, model_id) VALUES (?, ?)'
  );
  const touch = db.prepare(
    `UPDATE collections SET updated_at = datetime('now') WHERE id = ?`
  );
  let added = 0;
  const run = db.transaction(() => {
    for (const mid of ids) {
      const r = insert.run(collectionId, mid);
      added += r.changes;
    }
    touch.run(collectionId);
  });
  run();
  return { added, collection: getCollection(db, collectionId) };
}

function removeModels(db, collectionId, modelIds) {
  const ids = (Array.isArray(modelIds) ? modelIds : [modelIds])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
  const del = db.prepare(
    'DELETE FROM collection_models WHERE collection_id = ? AND model_id = ?'
  );
  let removed = 0;
  const run = db.transaction(() => {
    for (const mid of ids) {
      removed += del.run(collectionId, mid).changes;
    }
    db.prepare(`UPDATE collections SET updated_at = datetime('now') WHERE id = ?`).run(collectionId);
  });
  run();
  return { removed, collection: getCollection(db, collectionId) };
}

function getModelsInCollection(db, collectionId, { limit = 5000, offset = 0 } = {}) {
  return db.prepare(`
    SELECT m.id, m.filePath, m.fileName, m.designer, m.thumbnail, m.rating, m.favorite,
           m.print_status, m.print_count, m.parentModel, m.size, m.dateAdded
    FROM collection_models cm
    JOIN models m ON m.id = cm.model_id
    WHERE cm.collection_id = ?
    ORDER BY m.fileName COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(collectionId, limit, offset);
}

function getCollectionsForModel(db, modelId) {
  return db.prepare(`
    SELECT c.id, c.name, c.cover_path
    FROM collections c
    JOIN collection_models cm ON cm.collection_id = c.id
    WHERE cm.model_id = ?
    ORDER BY c.name COLLATE NOCASE
  `).all(modelId);
}

function collectionFilterSql(collectionId) {
  const id = Number(collectionId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    sql: 'EXISTS (SELECT 1 FROM collection_models cm WHERE cm.model_id = models.id AND cm.collection_id = ?)',
    params: [id]
  };
}

/** Pick up to 4 thumbnail paths for a collage cover. */
function pickCoverPaths(db, collectionId, max = 4) {
  return db.prepare(`
    SELECT m.thumbnail, m.filePath
    FROM collection_models cm
    JOIN models m ON m.id = cm.model_id
    WHERE cm.collection_id = ?
      AND m.thumbnail IS NOT NULL AND m.thumbnail != ''
    ORDER BY cm.added_at DESC
    LIMIT ?
  `).all(collectionId, max);
}

module.exports = {
  ensureSchema,
  listCollections,
  createCollection,
  getCollection,
  renameCollection,
  deleteCollection,
  addModels,
  removeModels,
  getModelsInCollection,
  getCollectionsForModel,
  collectionFilterSql,
  pickCoverPaths,
  buildCoverCollage
};
