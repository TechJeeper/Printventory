'use strict';

/**
 * Filament price / spool weight / remaining weight helpers.
 */

const COST_COLUMNS = Object.freeze([
  ['price_per_kg', 'REAL'],
  ['spool_weight_g', 'REAL'],
  ['remaining_weight_g', 'REAL'],
  ['low_stock_g', 'REAL']
]);

function ensureSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS filaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      vendor TEXT,
      material TEXT,
      color_hex TEXT,
      diameter REAL,
      spoolman_id INTEGER UNIQUE,
      source TEXT NOT NULL DEFAULT 'manual'
    )
  `).run();

  const cols = db.prepare('PRAGMA table_info(filaments)').all();
  const names = new Set(cols.map((c) => c.name));
  for (const [name, type] of COST_COLUMNS) {
    if (!names.has(name)) {
      db.prepare(`ALTER TABLE filaments ADD COLUMN ${name} ${type}`).run();
    }
  }
}

function costForPrint(grams, pricePerKg) {
  const g = Number(grams);
  const p = Number(pricePerKg);
  if (!Number.isFinite(g) || g <= 0) return 0;
  if (!Number.isFinite(p) || p < 0) return 0;
  return (g / 1000) * p;
}

function parseOptionalNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCostFields(filament = {}) {
  return {
    price_per_kg: parseOptionalNumber(filament.price_per_kg ?? filament.pricePerKg),
    spool_weight_g: parseOptionalNumber(filament.spool_weight_g ?? filament.spoolWeightG),
    remaining_weight_g: parseOptionalNumber(filament.remaining_weight_g ?? filament.remainingWeightG),
    low_stock_g: parseOptionalNumber(filament.low_stock_g ?? filament.lowStockG)
  };
}

function applyCostFields(filament = {}) {
  return { ...filament, ...normalizeCostFields(filament) };
}

function deductGrams(db, filamentId, grams) {
  ensureSchema(db);
  const id = Number(filamentId);
  const g = Number(grams);
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(g) || g <= 0) {
    return { ok: false };
  }
  const row = db.prepare('SELECT remaining_weight_g FROM filaments WHERE id = ?').get(id);
  if (!row) return { ok: false };
  if (row.remaining_weight_g == null) return { ok: true, skipped: true };
  const next = Math.max(0, Number(row.remaining_weight_g) - g);
  db.prepare('UPDATE filaments SET remaining_weight_g = ? WHERE id = ?').run(next, id);
  return { ok: true, remaining_weight_g: next };
}

function deductFilamentUsage(db, filamentIds, gramsTotal) {
  ensureSchema(db);
  const ids = Array.isArray(filamentIds) ? filamentIds.map(Number).filter((id) => id > 0) : [];
  const grams = Number(gramsTotal);
  if (!ids.length || !Number.isFinite(grams) || grams <= 0) return [];
  const per = grams / ids.length;
  const results = [];
  for (const id of ids) {
    const result = deductGrams(db, id, per);
    if (result.ok) {
      const row = db.prepare('SELECT id, remaining_weight_g, price_per_kg FROM filaments WHERE id = ?').get(id);
      if (row) results.push(row);
    }
  }
  return results;
}

function librarySpend(db) {
  ensureSchema(db);
  const rows = db.prepare(`
    SELECT id, name, price_per_kg, spool_weight_g, remaining_weight_g
    FROM filaments
    WHERE price_per_kg IS NOT NULL
  `).all();

  let total = 0;
  const byFilament = [];
  for (const row of rows) {
    const price = Number(row.price_per_kg);
    if (!Number.isFinite(price) || price < 0) continue;
    let usedG = null;
    if (row.spool_weight_g != null && row.remaining_weight_g != null) {
      usedG = Math.max(0, Number(row.spool_weight_g) - Number(row.remaining_weight_g));
    }
    const spend = usedG != null ? costForPrint(usedG, price) : 0;
    total += spend;
    byFilament.push({
      id: row.id,
      name: row.name,
      usedGrams: usedG,
      spend,
      price_per_kg: price
    });
  }
  return { total, byFilament };
}

function lowStockFilaments(db) {
  ensureSchema(db);
  return db.prepare(`
    SELECT *
    FROM filaments
    WHERE remaining_weight_g IS NOT NULL
      AND low_stock_g IS NOT NULL
      AND remaining_weight_g <= low_stock_g
    ORDER BY remaining_weight_g ASC, name COLLATE NOCASE ASC
  `).all();
}

module.exports = {
  COST_COLUMNS,
  ensureSchema,
  costForPrint,
  normalizeCostFields,
  applyCostFields,
  deductGrams,
  deductFilamentUsage,
  librarySpend,
  lowStockFilaments
};
