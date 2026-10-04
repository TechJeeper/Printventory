'use strict';

/** One row or two of the detailed grid. Larger batches stall tag and detail IPC. */
const PRIMARY_THUMBNAIL_BATCH_LIMIT = 8;

function uniqueFilePaths(filePaths, limit = PRIMARY_THUMBNAIL_BATCH_LIMIT) {
  if (!Array.isArray(filePaths)) return [];
  const cap = Number.isFinite(limit) && limit > 0 ? limit : PRIMARY_THUMBNAIL_BATCH_LIMIT;
  const seen = new Set();
  const out = [];
  for (const raw of filePaths) {
    if (typeof raw !== 'string' || !raw || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Primary (first `::` segment) thumbnail for an explicit path list.
 * Oversized column values stay out of the result so a few huge blobs cannot stall the grid.
 */
function buildPrimaryThumbnailsQuery(filePaths, maxChars) {
  const paths = uniqueFilePaths(filePaths);
  if (paths.length === 0) {
    return { sql: null, params: [], paths };
  }
  const placeholders = paths.map(() => '?').join(', ');
  const sql = `
    SELECT filePath,
      CASE
        WHEN thumbnail IS NULL OR thumbnail = '' OR thumbnail = '3d.png' THEN NULL
        WHEN LENGTH(thumbnail) > ? THEN NULL
        WHEN INSTR(thumbnail, '::') > 0 THEN SUBSTR(thumbnail, 1, INSTR(thumbnail, '::') - 1)
        ELSE thumbnail
      END AS primaryThumb,
      CASE
        WHEN thumbnail IS NOT NULL AND thumbnail != '' AND thumbnail != '3d.png' AND LENGTH(thumbnail) > ? THEN 1
        ELSE 0
      END AS oversized
    FROM models
    WHERE filePath IN (${placeholders})
  `;
  return { sql, params: [maxChars, maxChars, ...paths], paths };
}

function normalizePrimaryThumbnail(value) {
  if (!value || value === '3d.png' || typeof value !== 'string') return null;
  if (!value.startsWith('data:image')) return null;
  return value;
}

module.exports = {
  PRIMARY_THUMBNAIL_BATCH_LIMIT,
  uniqueFilePaths,
  buildPrimaryThumbnailsQuery,
  normalizePrimaryThumbnail
};
