'use strict';

function tableExists(db, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  );
}

function modelTagsSchema(db) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'model_tags'").get();
}

// An older migration renamed models -> models_old while foreign keys were on.
// SQLite rewrote model_tags to REFERENCES "models_old". After models_old was
// dropped, every write fails with "no such table: main.models_old".
function modelTagsForeignKeysBroken(db) {
  const row = modelTagsSchema(db);
  if (!row) return false;
  if (/models_old/i.test(row.sql || '')) return true;

  const foreignKeys = db.pragma('foreign_key_list(model_tags)');
  const parentByColumn = new Map(foreignKeys.map((fk) => [fk.from, fk.table]));
  if (parentByColumn.get('model_id') !== 'models') return true;
  if (parentByColumn.get('tag_id') !== 'tags') return true;

  for (const fk of foreignKeys) {
    if (!tableExists(db, fk.table)) return true;
  }
  return false;
}

function countOrphanModelTags(db) {
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM model_tags mt
    LEFT JOIN models m ON m.id = mt.model_id
    LEFT JOIN tags t ON t.id = mt.tag_id
    WHERE m.id IS NULL OR t.id IS NULL
  `).get().n;
}

function recreateModelTagsIndexes(db) {
  db.prepare('CREATE INDEX IF NOT EXISTS idx_model_tags_tag_id ON model_tags(tag_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_model_tags_model_id ON model_tags(model_id)').run();
}

function rebuildModelTagsTable(db) {
  const before = db.prepare('SELECT COUNT(*) AS n FROM model_tags').get().n;
  db.prepare('DROP TABLE IF EXISTS model_tags_new').run();
  db.prepare(`CREATE TABLE model_tags_new (
    model_id INTEGER,
    tag_id INTEGER,
    FOREIGN KEY(model_id) REFERENCES models(id),
    FOREIGN KEY(tag_id) REFERENCES tags(id),
    PRIMARY KEY(model_id, tag_id)
  )`).run();
  const inserted = db.prepare(`
    INSERT INTO model_tags_new (model_id, tag_id)
    SELECT DISTINCT mt.model_id, mt.tag_id
    FROM model_tags mt
    INNER JOIN models m ON m.id = mt.model_id
    INNER JOIN tags t ON t.id = mt.tag_id
    WHERE mt.model_id IS NOT NULL AND mt.tag_id IS NOT NULL
  `).run();
  db.prepare('DROP TABLE model_tags').run();
  db.prepare('ALTER TABLE model_tags_new RENAME TO model_tags').run();
  recreateModelTagsIndexes(db);
  return { kept: inserted.changes, dropped: before - inserted.changes };
}

function dropLeftoverModelsOld(db) {
  if (!tableExists(db, 'models_old')) return false;
  const stillReferenced = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE name != 'models_old'
      AND sql LIKE '%models_old%'
  `).all();
  if (stillReferenced.length > 0) return false;
  db.prepare('DROP TABLE models_old').run();
  return true;
}

function withForeignKeysOff(db, fn) {
  const previous = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    return fn();
  } finally {
    db.pragma(previous ? 'foreign_keys = ON' : 'foreign_keys = OFF');
  }
}

function repairModelTags(db) {
  if (!tableExists(db, 'model_tags')) return { ok: true, rebuilt: false, orphansRemoved: 0 };
  if (!tableExists(db, 'models') || !tableExists(db, 'tags')) {
    console.error('Skipping model_tags repair because models or tags is missing');
    return { ok: false, rebuilt: false, orphansRemoved: 0 };
  }

  console.log('Checking and repairing model_tags table...');
  const broken = modelTagsForeignKeysBroken(db);

  if (broken) {
    console.log('model_tags foreign keys point at a missing or renamed parent. Rebuilding the table...');
    const result = withForeignKeysOff(db, () => {
      const rebuilt = db.transaction(() => rebuildModelTagsTable(db))();
      const droppedOld = dropLeftoverModelsOld(db);
      return { rebuilt, droppedOld };
    });
    console.log(
      `Rebuilt model_tags. Kept ${result.rebuilt.kept} link(s), removed ${result.rebuilt.dropped} orphan(s).`
    );
    if (result.droppedOld) console.log('Dropped leftover models_old table');
    return { ok: true, rebuilt: true, orphansRemoved: result.rebuilt.dropped };
  }

  const orphans = countOrphanModelTags(db);
  if (orphans > 0) {
    console.log(`Found ${orphans} orphaned model_tags records. Cleaning up...`);
    db.prepare(`
      DELETE FROM model_tags
      WHERE NOT EXISTS (SELECT 1 FROM models m WHERE m.id = model_tags.model_id)
         OR NOT EXISTS (SELECT 1 FROM tags t WHERE t.id = model_tags.tag_id)
    `).run();
    console.log('Orphaned records cleaned up');
    return { ok: true, rebuilt: false, orphansRemoved: orphans };
  }

  console.log('No orphaned model_tags records found');
  return { ok: true, rebuilt: false, orphansRemoved: 0 };
}

module.exports = {
  repairModelTags,
  modelTagsForeignKeysBroken
};
