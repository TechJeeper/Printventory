'use strict';

/**
 * Match missing library paths to newly seen files by hash + size (move detection).
 */

function moveKey(hash, size) {
  const h = hash != null ? String(hash).trim() : '';
  const s = size != null ? Number(size) : NaN;
  if (!h || !Number.isFinite(s)) return null;
  return `${h}::${s}`;
}

/**
 * @returns {Array<{from:object,to:object,fromPath:string,toPath:string,hash:string,size:number,modelId?:number}>}
 */
function matchMoves(missingPaths, newFiles) {
  const missing = Array.isArray(missingPaths) ? missingPaths : [];
  const newer = Array.isArray(newFiles) ? newFiles : [];
  const byKey = new Map();

  for (const m of missing) {
    if (!m || !m.filePath) continue;
    const key = moveKey(m.hash, m.size);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  }

  const pairs = [];
  const usedMissing = new Set();
  const usedNew = new Set();

  for (const n of newer) {
    if (!n || !n.filePath || usedNew.has(n.filePath)) continue;
    const key = moveKey(n.hash, n.size);
    if (!key) continue;
    const candidates = byKey.get(key) || [];
    const old = candidates.find((c) => !usedMissing.has(c.filePath) && c.filePath !== n.filePath);
    if (!old) continue;
    usedMissing.add(old.filePath);
    usedNew.add(n.filePath);
    pairs.push({
      from: old,
      to: n,
      fromPath: old.filePath,
      toPath: n.filePath,
      hash: String(n.hash || old.hash || '').trim(),
      size: Number(n.size != null ? n.size : old.size),
      modelId: old.id || old.modelId || null
    });
  }
  return pairs;
}

function applyMovePath(db, fromPath, toPath, extras = {}) {
  if (!fromPath || !toPath || fromPath === toPath) return { updated: false };
  const existing = db.prepare('SELECT id FROM models WHERE filePath = ?').get(fromPath);
  if (!existing) return { updated: false };
  const collision = db.prepare('SELECT id FROM models WHERE filePath = ?').get(toPath);
  if (collision) return { updated: false };

  const fileName = extras.fileName != null
    ? String(extras.fileName)
    : String(toPath).split(/[/\\]/).pop();
  const size = extras.size != null && Number.isFinite(Number(extras.size)) ? Number(extras.size) : null;
  const hash = extras.hash != null ? String(extras.hash) : null;
  const modifiedDate = extras.modifiedDate || null;

  db.prepare(`
    UPDATE models
    SET filePath = ?,
        fileName = COALESCE(?, fileName),
        size = COALESCE(?, size),
        hash = COALESCE(NULLIF(?, ''), hash),
        modifiedDate = COALESCE(?, modifiedDate)
    WHERE id = ?
  `).run(toPath, fileName || null, size, hash, modifiedDate, existing.id);

  return { updated: true, id: existing.id };
}

function applyMoves(db, pairs) {
  const skippedInsertPaths = new Set();
  let moved = 0;
  for (const p of pairs || []) {
    const result = applyMovePath(db, p.fromPath || p.from?.filePath, p.toPath || p.to?.filePath, {
      fileName: p.to?.fileName,
      hash: p.hash,
      size: p.size,
      modifiedDate: p.to?.modifiedDate || p.to?.mtime || null
    });
    if (result.updated) {
      moved += 1;
      skippedInsertPaths.add(p.toPath || p.to?.filePath);
    }
  }
  return { moved, skippedInsertPaths };
}

function applyMatchedMoves(db, missingPaths, newFiles) {
  const pairs = matchMoves(missingPaths, newFiles);
  const { moved, skippedInsertPaths } = applyMoves(db, pairs);
  const consumedMissing = new Set(pairs.filter((p) => skippedInsertPaths.has(p.toPath)).map((p) => p.fromPath));
  // Also mark all successfully applied fromPaths
  for (const p of pairs) {
    if (skippedInsertPaths.has(p.toPath)) consumedMissing.add(p.fromPath);
  }
  return {
    applied: pairs.filter((p) => skippedInsertPaths.has(p.toPath)),
    consumedMissing,
    consumedNew: skippedInsertPaths,
    moved
  };
}

module.exports = {
  moveKey,
  matchMoves,
  buildMovePairs: matchMoves,
  applyMovePath,
  applyMoves,
  applyMatchedMoves
};
