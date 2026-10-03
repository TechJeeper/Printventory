'use strict';

const MAX_EXCLUDE_IDS = 2000;

function clampLimit(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function normalizeExcludeIds(excludeIds) {
  if (!Array.isArray(excludeIds)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of excludeIds) {
    const id = parseInt(raw, 10);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_EXCLUDE_IDS) break;
  }
  return out;
}

/**
 * Models with no custom thumbnail, optionally skipping known failures.
 * options may be a limit number (older callers) or { limit, offset, excludeIds }.
 */
function buildMissingThumbnailQuery(options) {
  const opts = options != null && typeof options === 'object' ? options : { limit: options };
  const limit = clampLimit(opts.limit, 50, 500);
  const offsetN = parseInt(opts.offset, 10);
  const offset = Number.isFinite(offsetN) && offsetN > 0 ? Math.floor(offsetN) : 0;
  const excludeIds = normalizeExcludeIds(opts.excludeIds);

  let sql = `
    SELECT id, filePath, fileName, size, designer
    FROM models
    WHERE (thumbnail IS NULL OR thumbnail = '' OR thumbnail = '3d.png')`;
  const params = [];
  if (excludeIds.length) {
    sql += ` AND id NOT IN (${excludeIds.map(() => '?').join(',')})`;
    params.push(...excludeIds);
  }
  sql += `
    ORDER BY fileName COLLATE NOCASE ASC, id ASC
    LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return { sql, params, limit, offset, excludeIds };
}

module.exports = {
  MAX_EXCLUDE_IDS,
  buildMissingThumbnailQuery,
  normalizeExcludeIds
};
