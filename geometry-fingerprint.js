'use strict';

/**
 * Geometry fingerprint near-duplicate detection.
 */

function ensureSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS model_geometry (
      model_id INTEGER PRIMARY KEY,
      triangle_count INTEGER,
      bbox_x REAL,
      bbox_y REAL,
      bbox_z REAL,
      volume REAL,
      surface_area REAL,
      histogram_json TEXT,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
    )
  `).run();
}

function nowIso() {
  return new Date().toISOString();
}

function safeNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Build a comparable fingerprint object from mesh stats.
 */
function computeFingerprint(input) {
  const src = input && typeof input === 'object' ? input : {};
  const bbox = Array.isArray(src.bbox) ? src.bbox : [src.bbox_x, src.bbox_y, src.bbox_z];
  const bx = Math.abs(safeNum(bbox[0]));
  const by = Math.abs(safeNum(bbox[1]));
  const bz = Math.abs(safeNum(bbox[2]));
  const sortedBbox = [bx, by, bz].sort((a, b) => a - b);
  let histogram = null;
  if (Array.isArray(src.vertexHistogram)) {
    histogram = src.vertexHistogram.map((n) => safeNum(n));
  } else if (typeof src.histogram_json === 'string' && src.histogram_json) {
    try {
      const parsed = JSON.parse(src.histogram_json);
      if (Array.isArray(parsed)) histogram = parsed.map((n) => safeNum(n));
    } catch (_) {
      histogram = null;
    }
  }
  return {
    triangleCount: Math.max(0, Math.floor(safeNum(src.triangleCount != null ? src.triangleCount : src.triangle_count))),
    bbox: sortedBbox,
    volume: Math.abs(safeNum(src.volume)),
    surfaceArea: Math.abs(safeNum(src.surfaceArea != null ? src.surfaceArea : src.surface_area)),
    vertexHistogram: histogram
  };
}

function relDiff(a, b) {
  const x = Math.abs(safeNum(a));
  const y = Math.abs(safeNum(b));
  const denom = Math.max(x, y, 1e-9);
  return Math.abs(x - y) / denom;
}

function histogramDistance(a, b) {
  const aOk = Array.isArray(a) && a.length;
  const bOk = Array.isArray(b) && b.length;
  if (!aOk && !bOk) return 0; // both missing → treat as identical
  if (!aOk || !bOk || a.length !== b.length) return 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = safeNum(a[i]);
    const y = safeNum(b[i]);
    sum += Math.abs(x - y);
    norm += Math.max(x, y);
  }
  if (norm < 1e-9) return 0;
  return Math.min(1, sum / (2 * norm));
}

/**
 * Similarity score 0–1 (1 = identical).
 */
function fingerprintDistance(a, b) {
  const fa = computeFingerprint(a);
  const fb = computeFingerprint(b);
  const weights = { triangles: 0.25, bbox: 0.3, volume: 0.2, surface: 0.15, hist: 0.1 };
  const triSim = 1 - relDiff(fa.triangleCount, fb.triangleCount);
  let bboxSim = 0;
  for (let i = 0; i < 3; i += 1) {
    bboxSim += 1 - relDiff(fa.bbox[i], fb.bbox[i]);
  }
  bboxSim /= 3;
  const volSim = 1 - relDiff(fa.volume, fb.volume);
  const surfSim = 1 - relDiff(fa.surfaceArea, fb.surfaceArea);
  const histSim = 1 - histogramDistance(fa.vertexHistogram, fb.vertexHistogram);
  const score =
    weights.triangles * triSim +
    weights.bbox * bboxSim +
    weights.volume * volSim +
    weights.surface * surfSim +
    weights.hist * histSim;
  return Math.max(0, Math.min(1, score));
}

function storeGeometry(db, modelId, stats) {
  ensureSchema(db);
  const id = Number(modelId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid model id');
  const fp = computeFingerprint(stats);
  db.prepare(`
    INSERT INTO model_geometry (
      model_id, triangle_count, bbox_x, bbox_y, bbox_z, volume, surface_area, histogram_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      triangle_count = excluded.triangle_count,
      bbox_x = excluded.bbox_x,
      bbox_y = excluded.bbox_y,
      bbox_z = excluded.bbox_z,
      volume = excluded.volume,
      surface_area = excluded.surface_area,
      histogram_json = excluded.histogram_json,
      updated_at = excluded.updated_at
  `).run(
    id,
    fp.triangleCount,
    fp.bbox[0],
    fp.bbox[1],
    fp.bbox[2],
    fp.volume,
    fp.surfaceArea,
    fp.vertexHistogram ? JSON.stringify(fp.vertexHistogram) : null,
    nowIso()
  );
  return db.prepare('SELECT * FROM model_geometry WHERE model_id = ?').get(id);
}

function rowToFingerprint(row) {
  return computeFingerprint({
    triangle_count: row.triangle_count,
    bbox: [row.bbox_x, row.bbox_y, row.bbox_z],
    volume: row.volume,
    surface_area: row.surface_area,
    histogram_json: row.histogram_json
  });
}

/**
 * Find near-duplicate groups at or above threshold (0–1 similarity).
 */
function findNearDuplicates(db, threshold) {
  ensureSchema(db);
  const minScore = Math.max(0, Math.min(1, Number(threshold)));
  if (!Number.isFinite(minScore)) return [];
  const rows = db.prepare('SELECT * FROM model_geometry ORDER BY model_id ASC').all();
  if (rows.length < 2) return [];

  const parent = rows.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  const fps = rows.map(rowToFingerprint);
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const score = fingerprintDistance(fps[i], fps[j]);
      if (score >= minScore) union(i, j);
    }
  }

  const groupsMap = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const root = find(i);
    if (!groupsMap.has(root)) groupsMap.set(root, []);
    groupsMap.get(root).push({
      model_id: rows[i].model_id,
      fingerprint: fps[i]
    });
  }

  const groups = [];
  for (const members of groupsMap.values()) {
    if (members.length < 2) continue;
    let minPair = 1;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        minPair = Math.min(minPair, fingerprintDistance(members[i].fingerprint, members[j].fingerprint));
      }
    }
    groups.push({
      size: members.length,
      minSimilarity: minPair,
      similarity: minPair,
      modelIds: members.map((m) => m.model_id),
      members
    });
  }
  groups.sort((a, b) => b.size - a.size || b.minSimilarity - a.minSimilarity);
  return groups;
}

/**
 * Cheap fingerprint from a binary STL buffer (triangle count + sample bbox).
 * Returns null when the buffer is not a recognizable binary STL.
 */
function fingerprintFromStlBuffer(buffer) {
  if (!buffer || buffer.byteLength < 84) return null;
  const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  // ASCII STL starts with "solid"
  const head = view.slice(0, 5).toString('ascii');
  if (head === 'solid') return null;
  const triangleCount = view.readUInt32LE(80);
  if (!triangleCount || triangleCount > 50_000_000) return null;
  const expected = 84 + triangleCount * 50;
  if (view.byteLength < Math.min(expected, 84 + 50)) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let area = 0;
  const sampleStep = Math.max(1, Math.floor(triangleCount / 2000));
  const hist = new Array(8).fill(0);
  let sampled = 0;

  for (let i = 0; i < triangleCount; i += sampleStep) {
    const off = 84 + i * 50;
    if (off + 48 > view.byteLength) break;
    const n0 = view.readFloatLE(off);
    const n1 = view.readFloatLE(off + 4);
    const n2 = view.readFloatLE(off + 8);
    const v = [];
    for (let vi = 0; vi < 3; vi += 1) {
      const base = off + 12 + vi * 12;
      const x = view.readFloatLE(base);
      const y = view.readFloatLE(base + 4);
      const z = view.readFloatLE(base + 8);
      v.push([x, y, z]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const abx = v[1][0] - v[0][0];
    const aby = v[1][1] - v[0][1];
    const abz = v[1][2] - v[0][2];
    const acx = v[2][0] - v[0][0];
    const acy = v[2][1] - v[0][1];
    const acz = v[2][2] - v[0][2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    const nx = Number.isFinite(n0) ? n0 : 0;
    const ny = Number.isFinite(n1) ? n1 : 0;
    const nz = Number.isFinite(n2) ? n2 : 0;
    const bin =
      (nx >= 0 ? 1 : 0) +
      (ny >= 0 ? 2 : 0) +
      (nz >= 0 ? 4 : 0);
    hist[bin] += 1;
    sampled += 1;
  }
  if (!Number.isFinite(minX) || sampled === 0) return null;
  const bx = maxX - minX;
  const by = maxY - minY;
  const bz = maxZ - minZ;
  const scale = Math.max(sampled, 1);
  const surfaceArea = area * (triangleCount / sampled);
  return {
    triangleCount,
    bbox: [bx, by, bz],
    volume: Math.abs(bx * by * bz),
    surfaceArea,
    vertexHistogram: hist.map((n) => n / scale)
  };
}

/**
 * Rank other models by geometry similarity to seed modelId.
 */
function findSimilarModels(db, modelId, limit = 12) {
  ensureSchema(db);
  const id = Number(modelId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const seedRow = db.prepare('SELECT * FROM model_geometry WHERE model_id = ?').get(id);
  if (!seedRow) return [];
  const seedFp = rowToFingerprint(seedRow);
  const rows = db.prepare(`
    SELECT g.*, m.fileName, m.filePath, m.thumbnail
    FROM model_geometry g
    JOIN models m ON m.id = g.model_id
    WHERE g.model_id != ?
  `).all(id);
  const scored = [];
  for (const row of rows) {
    const score = fingerprintDistance(seedFp, rowToFingerprint(row));
    if (score < 0.7) continue;
    scored.push({
      model_id: row.model_id,
      modelId: row.model_id,
      fileName: row.fileName,
      filePath: row.filePath,
      thumbnail: row.thumbnail,
      score,
      source: 'geometry'
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, Math.min(Number(limit) || 12, 100)));
}

module.exports = {
  ensureSchema,
  computeFingerprint,
  fingerprintDistance,
  findNearDuplicates,
  findSimilarModels,
  storeGeometry,
  rowToFingerprint,
  fingerprintFromStlBuffer
};
