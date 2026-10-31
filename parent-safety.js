'use strict';

/**
 * Safe parent-model assignment: cycle detection, children checks, flatten.
 * parentModel is a free-text group label; cycles follow fileName → parentModel chains.
 */

function resolveModel(db, fileNameOrId) {
  if (fileNameOrId == null || fileNameOrId === '') return null;
  if (typeof fileNameOrId === 'number' || (/^\d+$/.test(String(fileNameOrId).trim()) && Number(fileNameOrId) > 0)) {
    const id = Number(fileNameOrId);
    const byId = db.prepare('SELECT id, fileName, parentModel FROM models WHERE id = ?').get(id);
    if (byId) return byId;
  }
  const name = String(fileNameOrId).trim();
  if (!name) return null;
  return db.prepare('SELECT id, fileName, parentModel FROM models WHERE fileName = ? COLLATE NOCASE').get(name) || null;
}

function wouldCreateCycle(db, childFileNameOrId, parentName) {
  const parent = String(parentName || '').trim();
  if (!parent) return false;
  const child = resolveModel(db, childFileNameOrId);
  const childName = child ? String(child.fileName || '').trim() : String(childFileNameOrId || '').trim();
  if (!childName) return false;
  if (childName.toLowerCase() === parent.toLowerCase()) return true;

  const visited = new Set();
  let current = parent;
  const maxHops = 1000;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const key = current.toLowerCase();
    if (visited.has(key)) return true;
    visited.add(key);
    if (key === childName.toLowerCase()) return true;
    const row = db.prepare(
      "SELECT parentModel FROM models WHERE fileName = ? COLLATE NOCASE AND parentModel IS NOT NULL AND TRIM(parentModel) != ''"
    ).get(current);
    if (!row || !row.parentModel || !String(row.parentModel).trim()) return false;
    current = String(row.parentModel).trim();
  }
  return true;
}

function hasChildren(db, parentModelName) {
  const name = String(parentModelName || '').trim();
  if (!name) return false;
  const row = db.prepare(
    "SELECT 1 AS ok FROM models WHERE parentModel = ? COLLATE NOCASE LIMIT 1"
  ).get(name);
  return Boolean(row);
}

function flattenGroup(db, parentModelName) {
  const name = String(parentModelName || '').trim();
  if (!name) return { cleared: 0 };
  const result = db.prepare(
    "UPDATE models SET parentModel = NULL WHERE parentModel = ? COLLATE NOCASE"
  ).run(name);
  return { cleared: result.changes, parentModel: name };
}

/**
 * Validate assigning newParent to modelId.
 * Returns { ok, warn, error, forceRequired }.
 * Cycle → error. Model that has children → warn (allow with force).
 */
function validateParentAssignment(db, modelId, newParent, options) {
  const force = !!(options && options.force);
  const parent = newParent == null || newParent === '' ? null : String(newParent).trim();
  const result = { ok: true, warn: null, error: null, forceRequired: false };

  if (!parent) return result;

  const model = resolveModel(db, modelId);
  if (!model) {
    result.ok = false;
    result.error = 'Model not found';
    return result;
  }

  if (wouldCreateCycle(db, model.id, parent)) {
    result.ok = false;
    result.error = `Assigning parent "${parent}" would create a cycle`;
    return result;
  }

  if (hasChildren(db, model.fileName) && !force) {
    result.ok = false;
    result.warn = `Model "${model.fileName}" has children; assigning a parent creates a nested group. Pass force: true to allow.`;
    result.forceRequired = true;
    return result;
  }

  return result;
}

module.exports = {
  wouldCreateCycle,
  hasChildren,
  flattenGroup,
  validateParentAssignment,
  resolveModel
};
