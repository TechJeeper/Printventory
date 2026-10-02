'use strict';

const { clampFolderLevels, folderTagsFromPath } = require('./library-context');

function shouldAutoTagNewScanFiles(settingValue, levels) {
  if (String(settingValue) !== '1') return false;
  return clampFolderLevels(levels, 0) > 0;
}

// Adds folder-name tags. Existing tag links are left in place (INSERT OR IGNORE).
function applyFolderTagsToModels(db, filePaths, levels) {
  const namesForPath = folderTagsFromPath;
  let updated = 0;
  let tagsAdded = 0;
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
  const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
  const linkTag = db.prepare('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)');
  const findModel = db.prepare('SELECT id FROM models WHERE filePath = ?');

  db.transaction(() => {
    for (const filePath of filePaths) {
      const model = findModel.get(filePath);
      if (!model) continue;
      let addedForModel = 0;
      for (const name of namesForPath(filePath, levels)) {
        let tag = findTag.get(name);
        if (!tag) {
          const info = insertTag.run(name);
          tag = { id: info.lastInsertRowid };
        }
        const rel = linkTag.run(model.id, tag.id);
        if (rel.changes) addedForModel += 1;
      }
      if (addedForModel) {
        updated += 1;
        tagsAdded += addedForModel;
      }
    }
  })();

  return { updated, tagsAdded };
}

module.exports = {
  shouldAutoTagNewScanFiles,
  applyFolderTagsToModels
};
