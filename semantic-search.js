'use strict';

/**
 * Optional AI description + embedding store for semantic / find-similar search.
 */

function ensureSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS model_embeddings (
      model_id INTEGER PRIMARY KEY,
      description TEXT,
      embedding BLOB,
      dims INTEGER,
      provider TEXT,
      updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_model_embeddings_provider ON model_embeddings(provider)').run();
}

function float32ToBuffer(arr) {
  const a = Float32Array.from(arr);
  return Buffer.from(a.buffer);
}

function bufferToFloat32(buf) {
  if (!buf) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return Array.from(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4)));
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function storeEmbedding(db, modelId, embeddingOrMeta, maybeMeta) {
  let description = null;
  let embedding = null;
  let provider = null;
  if (Array.isArray(embeddingOrMeta)) {
    embedding = embeddingOrMeta;
    const meta = maybeMeta && typeof maybeMeta === 'object' ? maybeMeta : {};
    description = meta.description != null ? meta.description : null;
    provider = meta.provider != null ? meta.provider : null;
  } else {
    const meta = embeddingOrMeta && typeof embeddingOrMeta === 'object' ? embeddingOrMeta : {};
    description = meta.description != null ? meta.description : null;
    embedding = meta.embedding != null ? meta.embedding : null;
    provider = meta.provider != null ? meta.provider : null;
  }
  const dims = Array.isArray(embedding) ? embedding.length : null;
  const blob = Array.isArray(embedding) ? float32ToBuffer(embedding) : null;
  db.prepare(`
    INSERT INTO model_embeddings (model_id, description, embedding, dims, provider, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(model_id) DO UPDATE SET
      description = COALESCE(excluded.description, model_embeddings.description),
      embedding = COALESCE(excluded.embedding, model_embeddings.embedding),
      dims = COALESCE(excluded.dims, model_embeddings.dims),
      provider = COALESCE(excluded.provider, model_embeddings.provider),
      updated_at = datetime('now')
  `).run(modelId, description, blob, dims, provider);
  return getEmbedding(db, modelId);
}

function getEmbedding(db, modelId) {
  const row = db.prepare('SELECT * FROM model_embeddings WHERE model_id = ?').get(modelId);
  if (!row) return null;
  return {
    modelId: row.model_id,
    description: row.description,
    embedding: bufferToFloat32(row.embedding),
    dims: row.dims,
    provider: row.provider,
    updated_at: row.updated_at
  };
}

function findSimilar(db, modelId, limitOrOpts) {
  const limit = typeof limitOrOpts === 'number'
    ? limitOrOpts
    : (limitOrOpts && limitOrOpts.limit != null ? limitOrOpts.limit : 12);
  const seed = getEmbedding(db, modelId);
  if (!seed || !seed.embedding) return [];
  const rows = db.prepare(`
    SELECT e.model_id, e.description, e.embedding, m.fileName, m.filePath, m.thumbnail
    FROM model_embeddings e
    JOIN models m ON m.id = e.model_id
    WHERE e.model_id != ? AND e.embedding IS NOT NULL
  `).all(modelId);

  const scored = [];
  for (const row of rows) {
    const emb = bufferToFloat32(row.embedding);
    const score = cosineSimilarity(seed.embedding, emb);
    scored.push({
      model_id: row.model_id,
      modelId: row.model_id,
      fileName: row.fileName,
      filePath: row.filePath,
      thumbnail: row.thumbnail,
      description: row.description,
      score
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, Math.min(Number(limit) || 12, 100)));
}

/** Deterministic stub embedding from text for offline tests / bootstrap. */
function stubEmbeddingFromText(text, dims = 32) {
  const s = String(text || '');
  const out = new Array(dims).fill(0);
  for (let i = 0; i < s.length; i++) {
    out[i % dims] += (s.charCodeAt(i) % 31) / 31;
  }
  const norm = Math.sqrt(out.reduce((a, b) => a + b * b, 0)) || 1;
  return out.map((v) => v / norm);
}

/**
 * Stub hook for aitagging / external embedding providers.
 * Returns null until a provider is configured; callers may use stubEmbeddingFromText offline.
 */
async function generateEmbedding(_textOrImage, _options) {
  return null;
}

function modelTextForEmbedding(row) {
  if (!row) return '';
  return [row.fileName, row.designer, row.parentModel, row.license, row.notes]
    .filter((x) => x != null && String(x).trim())
    .join(' | ');
}

/**
 * Ensure a model has an embedding (stub from metadata when no provider).
 * Returns the stored row or null.
 */
function ensureEmbeddingForModel(db, modelId) {
  ensureSchema(db);
  const id = Number(modelId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const existing = getEmbedding(db, id);
  if (existing && existing.embedding && existing.embedding.length) return existing;
  const row = db.prepare('SELECT id, fileName, designer, parentModel, license, notes FROM models WHERE id = ?').get(id);
  if (!row) return null;
  const text = modelTextForEmbedding(row) || `model:${id}`;
  const embedding = stubEmbeddingFromText(text);
  storeEmbedding(db, id, embedding, { description: text, provider: 'stub-text' });
  return getEmbedding(db, id);
}

/**
 * Bootstrap stub embeddings for models missing them (capped).
 */
function bootstrapMissingEmbeddings(db, { limit = 200 } = {}) {
  ensureSchema(db);
  const rows = db.prepare(`
    SELECT m.id, m.fileName, m.designer, m.parentModel, m.license, m.notes
    FROM models m
    LEFT JOIN model_embeddings e ON e.model_id = m.id
    WHERE e.model_id IS NULL OR e.embedding IS NULL
    LIMIT ?
  `).all(Math.max(1, Math.min(Number(limit) || 200, 2000)));
  let stored = 0;
  for (const row of rows) {
    const text = modelTextForEmbedding(row) || `model:${row.id}`;
    storeEmbedding(db, row.id, stubEmbeddingFromText(text), { description: text, provider: 'stub-text' });
    stored += 1;
  }
  return { stored, scanned: rows.length };
}

/**
 * Find similar models: prefer geometry fingerprints; fall back to embeddings
 * with a minimum score so stub text matches do not flood the UI.
 */
function findSimilarEnsured(db, modelId, limit) {
  const lim = Math.max(1, Math.min(Number(limit) || 12, 100));
  try {
    const geometryFingerprint = require('./geometry-fingerprint');
    const geo = geometryFingerprint.findSimilarModels(db, modelId, lim);
    if (geo && geo.length) return geo;
  } catch (_) { /* geometry table may be empty */ }

  ensureEmbeddingForModel(db, modelId);
  // Light bootstrap of neighbors so first click is not empty
  try { bootstrapMissingEmbeddings(db, { limit: 80 }); } catch (_) { /* ignore */ }
  const emb = findSimilar(db, modelId, lim * 2)
    .filter((s) => Number(s.score) >= 0.88)
    .map((s) => ({ ...s, source: s.source || 'metadata' }))
    .slice(0, lim);
  return emb;
}

module.exports = {
  ensureSchema,
  cosineSimilarity,
  storeEmbedding,
  getEmbedding,
  findSimilar,
  findSimilarEnsured,
  ensureEmbeddingForModel,
  bootstrapMissingEmbeddings,
  generateEmbedding,
  stubEmbeddingFromText,
  modelTextForEmbedding,
  float32ToBuffer,
  bufferToFloat32
};
