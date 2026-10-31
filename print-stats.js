'use strict';

/**
 * Aggregate print_events into dashboard-ready statistics.
 */

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch (_) {
    return false;
  }
}

function hasTable(db, name) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
  } catch (_) {
    return false;
  }
}

function normalizeRange(options = {}) {
  const from = options.from ? new Date(options.from) : null;
  const to = options.to ? new Date(options.to) : null;
  return {
    fromIso: from && !Number.isNaN(from.getTime()) ? from.toISOString() : null,
    toIso: to && !Number.isNaN(to.getTime()) ? to.toISOString() : null
  };
}

function dateClause(fromIso, toIso, column = 'printed_at') {
  const parts = [];
  const params = [];
  if (fromIso) {
    parts.push(`${column} >= ?`);
    params.push(fromIso);
  }
  if (toIso) {
    parts.push(`${column} <= ?`);
    params.push(toIso);
  }
  return {
    sql: parts.length ? ` AND ${parts.join(' AND ')}` : '',
    params
  };
}

function aggregatePrintStats(db, options = {}) {
  const { fromIso, toIso } = normalizeRange(options);
  const range = dateClause(fromIso, toIso);

  const empty = {
    printsPerMonth: [],
    successVsFailed: { printed: 0, failed: 0, cancelled: 0 },
    printsPerPrinter: [],
    filamentUsageByMaterial: [],
    partsConsumed: [],
    mostPrintedModels: [],
    wantNeverPrintedCount: 0,
    librarySpend: null
  };

  if (!hasTable(db, 'print_events')) return empty;

  const printsPerMonth = db.prepare(`
    SELECT substr(printed_at, 1, 7) AS month,
           COALESCE(SUM(quantity), 0) AS count
    FROM print_events
    WHERE 1=1${range.sql}
    GROUP BY month
    ORDER BY month ASC
  `).all(...range.params);

  const outcomeRows = db.prepare(`
    SELECT outcome, COALESCE(SUM(quantity), 0) AS count
    FROM print_events
    WHERE 1=1${range.sql}
    GROUP BY outcome
  `).all(...range.params);
  const successVsFailed = { printed: 0, failed: 0, cancelled: 0 };
  for (const row of outcomeRows) {
    const key = String(row.outcome || '').toLowerCase();
    if (key in successVsFailed) successVsFailed[key] = Number(row.count) || 0;
  }

  let printsPerPrinter = [];
  if (hasColumn(db, 'print_events', 'printer_id') && hasTable(db, 'printers')) {
    printsPerPrinter = db.prepare(`
      SELECT pe.printer_id AS printerId,
             COALESCE(pr.nickname, 'Unknown') AS nickname,
             COALESCE(SUM(pe.quantity), 0) AS count
      FROM print_events pe
      LEFT JOIN printers pr ON pr.id = pe.printer_id
      WHERE 1=1${range.sql}
      GROUP BY pe.printer_id
      ORDER BY count DESC
    `).all(...range.params);
  }

  let filamentUsageByMaterial = [];
  if (hasTable(db, 'print_event_filaments') && hasTable(db, 'filaments')) {
    filamentUsageByMaterial = db.prepare(`
      SELECT COALESCE(f.material, 'Unknown') AS material,
             COALESCE(f.vendor, '') AS vendor,
             COUNT(*) AS eventLinks,
             COALESCE(SUM(pe.quantity), 0) AS quantity
      FROM print_event_filaments pef
      JOIN print_events pe ON pe.id = pef.event_id
      JOIN filaments f ON f.id = pef.filament_id
      WHERE 1=1${range.sql}
      GROUP BY COALESCE(f.material, 'Unknown'), COALESCE(f.vendor, '')
      ORDER BY quantity DESC
    `).all(...range.params);
  }

  let partsConsumed = [];
  if (hasTable(db, 'print_event_parts')) {
    partsConsumed = db.prepare(`
      SELECT COALESCE(pep.name, p.name, 'Part') AS part_name,
             COALESCE(SUM(pep.quantity), 0) AS quantity
      FROM print_event_parts pep
      LEFT JOIN parts p ON p.id = pep.part_id
      JOIN print_events pe ON pe.id = pep.event_id
      WHERE 1=1${range.sql}
      GROUP BY COALESCE(pep.name, p.name, 'Part')
      ORDER BY quantity DESC
    `).all(...range.params).map((row) => ({ name: row.part_name, quantity: row.quantity }));
  }

  const mostPrintedModels = db.prepare(`
    SELECT pe.model_id AS modelId,
           m.fileName AS fileName,
           m.filePath AS filePath,
           COALESCE(SUM(CASE WHEN pe.outcome = 'printed' THEN pe.quantity ELSE 0 END), 0) AS printCount
    FROM print_events pe
    LEFT JOIN models m ON m.id = pe.model_id
    WHERE 1=1${range.sql}
    GROUP BY pe.model_id
    HAVING printCount > 0
    ORDER BY printCount DESC
    LIMIT 25
  `).all(...range.params);

  let wantNeverPrintedCount = 0;
  if (hasTable(db, 'models') && hasColumn(db, 'models', 'print_status')) {
    const deletedFilter = hasColumn(db, 'models', 'deleted_at')
      ? " AND (deleted_at IS NULL OR deleted_at = '')"
      : '';
    wantNeverPrintedCount = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM models
      WHERE COALESCE(print_status, 'unprinted') = 'want'
        AND COALESCE(print_count, 0) = 0
        ${deletedFilter}
    `).get()?.count) || 0;
  }

  let librarySpend = null;
  if (hasTable(db, 'filaments') && hasColumn(db, 'filaments', 'price_per_kg')) {
    try {
      const filamentCost = require('./filament-cost');
      librarySpend = filamentCost.librarySpend(db);
    } catch (_) {
      librarySpend = null;
    }
  }

  return {
    printsPerMonth,
    successVsFailed,
    printsPerPrinter,
    filamentUsageByMaterial,
    partsConsumed,
    mostPrintedModels,
    wantNeverPrintedCount,
    librarySpend
  };
}

module.exports = {
  aggregatePrintStats
};
