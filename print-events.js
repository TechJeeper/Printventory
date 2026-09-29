'use strict';

const PRINT_STATUSES = Object.freeze(['unprinted', 'want', 'queued', 'printing', 'printed', 'failed']);
const PRINT_OUTCOMES = Object.freeze(['printed', 'failed', 'cancelled']);

const STATUS_LABELS = Object.freeze({
  unprinted: 'Not printed',
  want: 'Want',
  queued: 'Queued',
  printing: 'Printing',
  printed: 'Printed',
  failed: 'Failed'
});

const FILTER_LABELS = Object.freeze({
  printed: 'Printed',
  'not-printed': 'Not printed',
  unprinted: 'Unprinted',
  want: 'Want',
  queued: 'Queued',
  printing: 'Printing',
  failed: 'Failed',
  'ever-printed': 'Ever printed',
  'never-printed': 'Never printed'
});

const STATUS_SORT_RANK = Object.freeze({
  printing: 0,
  queued: 1,
  want: 2,
  printed: 3,
  failed: 4,
  unprinted: 5
});

function normalizePrintStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return PRINT_STATUSES.includes(status) ? status : 'unprinted';
}

function normalizeOutcome(value) {
  const outcome = String(value || '').trim().toLowerCase();
  return PRINT_OUTCOMES.includes(outcome) ? outcome : 'printed';
}

function statusFromPrintedFlag(printed) {
  return printed ? 'printed' : 'unprinted';
}

function derivedPrinted(printStatus, printCount) {
  const status = normalizePrintStatus(printStatus);
  const count = Number(printCount) || 0;
  return status === 'printed' || count > 0 ? 1 : 0;
}

function effectivePrintStatus(model) {
  if (!model) return 'unprinted';
  if (model.print_status) return normalizePrintStatus(model.print_status);
  return statusFromPrintedFlag(model.printed);
}

function badgeText(model) {
  const status = effectivePrintStatus(model);
  const count = Number(model?.print_count) || 0;
  if (status === 'printed') {
    return count > 0 ? `Printed ×${count}` : 'Printed';
  }
  return STATUS_LABELS[status] || STATUS_LABELS.unprinted;
}

function badgeClassNames(model) {
  const status = effectivePrintStatus(model);
  const classes = ['print-status', `print-status-${status}`];
  if (status === 'printed' || Number(model?.print_count) > 0) classes.push('printed');
  return classes.join(' ');
}

function formatPrintDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function badgeTitle(model) {
  const status = effectivePrintStatus(model);
  const count = Number(model?.print_count) || 0;
  const parts = [`Status: ${STATUS_LABELS[status] || status}`];
  if (count > 0) {
    parts.push(`${count} logged print${count === 1 ? '' : 's'}`);
  } else if (status === 'printed') {
    parts.push('No logged prints yet');
  }
  if (model?.last_printed_at) {
    parts.push(`Last printed: ${formatPrintDate(model.last_printed_at)}`);
  }
  return parts.join('\n');
}

function filterLabel(value) {
  return FILTER_LABELS[value] || String(value || '');
}

function printFilterSql(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'not-printed') return '(printed = 0 OR printed IS NULL)';
  if (v === 'ever-printed') return 'COALESCE(print_count, 0) > 0';
  if (v === 'never-printed') return 'COALESCE(print_count, 0) = 0';
  if (PRINT_STATUSES.includes(v)) return "COALESCE(print_status, 'unprinted') = ?";
  return null;
}

function printFilterSqlBound(value) {
  const sql = printFilterSql(value);
  if (!sql) return null;
  const v = String(value || '').trim().toLowerCase();
  if (PRINT_STATUSES.includes(v)) return { sql, params: [v] };
  return { sql, params: [] };
}

function modelMatchesPrintFilter(model, value) {
  if (!value || value === 'all') return true;
  const v = String(value).trim().toLowerCase();
  const status = effectivePrintStatus(model);
  const count = Number(model?.print_count) || 0;
  const printed = Number(model?.printed) ? 1 : derivedPrinted(status, count);
  if (v === 'printed') return status === 'printed';
  if (v === 'not-printed') return !printed;
  if (v === 'ever-printed') return count > 0;
  if (v === 'never-printed') return count === 0;
  if (PRINT_STATUSES.includes(v)) return status === v;
  return true;
}

function printSortOrderClause(sortOption) {
  switch (sortOption) {
    case 'printed-asc':
      return 'ORDER BY printed ASC, print_status ASC';
    case 'printed-desc':
      return 'ORDER BY printed DESC, print_status DESC';
    case 'printstatus-asc':
      return `ORDER BY CASE print_status
        WHEN 'printing' THEN 0 WHEN 'queued' THEN 1 WHEN 'want' THEN 2
        WHEN 'printed' THEN 3 WHEN 'failed' THEN 4 ELSE 5 END ASC, fileName ASC`;
    case 'printstatus-desc':
      return `ORDER BY CASE print_status
        WHEN 'printing' THEN 0 WHEN 'queued' THEN 1 WHEN 'want' THEN 2
        WHEN 'printed' THEN 3 WHEN 'failed' THEN 4 ELSE 5 END DESC, fileName ASC`;
    case 'printcount-asc':
      return 'ORDER BY COALESCE(print_count, 0) ASC, fileName ASC';
    case 'printcount-desc':
      return 'ORDER BY COALESCE(print_count, 0) DESC, fileName ASC';
    case 'lastprinted-asc':
      return "ORDER BY last_printed_at IS NULL ASC, last_printed_at ASC, fileName ASC";
    case 'lastprinted-desc':
      return "ORDER BY last_printed_at IS NULL ASC, last_printed_at DESC, fileName ASC";
    default:
      return null;
  }
}

function normalizeQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 9999);
}

function normalizeFilamentIds(raw) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const ids = [];
  const seen = new Set();
  for (const item of list) {
    const id = item && typeof item === 'object' ? Number(item.id) : Number(item);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function resolvePrintFieldsOnSave(existing, incoming) {
  const existingStatus = existing
    ? (existing.print_status ? normalizePrintStatus(existing.print_status) : statusFromPrintedFlag(existing.printed))
    : 'unprinted';
  const count = existing ? (Number(existing.print_count) || 0) : 0;
  const lastAt = existing ? (existing.last_printed_at || null) : null;
  let status = existingStatus;
  if (incoming.printStatus !== undefined && incoming.printStatus !== null && incoming.printStatus !== '') {
    status = normalizePrintStatus(incoming.printStatus);
  } else if (incoming.printed !== undefined && existing) {
    const incomingPrinted = incoming.printed ? 1 : 0;
    const existingPrinted = existing.printed ? 1 : 0;
    if (incomingPrinted !== existingPrinted) {
      status = incoming.printed ? 'printed' : 'unprinted';
    }
  } else if (!existing) {
    status = incoming.printed ? 'printed' : 'unprinted';
  }
  return {
    print_status: status,
    print_count: count,
    last_printed_at: lastAt,
    printed: derivedPrinted(status, count)
  };
}

function ensurePrintLifecycleSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS print_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      printed_at DATETIME NOT NULL,
      outcome TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at DATETIME NOT NULL,
      FOREIGN KEY(model_id) REFERENCES models(id)
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS print_event_filaments (
      event_id INTEGER NOT NULL,
      filament_id INTEGER NOT NULL,
      FOREIGN KEY(event_id) REFERENCES print_events(id),
      FOREIGN KEY(filament_id) REFERENCES filaments(id),
      PRIMARY KEY(event_id, filament_id)
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_print_events_model_id ON print_events(model_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_print_events_printed_at ON print_events(printed_at)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_print_event_filaments_filament_id ON print_event_filaments(filament_id)').run();
  try {
    const tableInfo = db.prepare('PRAGMA table_info(print_events)').all();
    if (!tableInfo.some((col) => col.name === 'printer_id')) {
      db.prepare('ALTER TABLE print_events ADD COLUMN printer_id INTEGER').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_print_events_printer_id ON print_events(printer_id)').run();
    }
  } catch (_) {}
  ensurePartsSchema(db);
}

function ensurePartsSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      unit TEXT,
      notes TEXT,
      low_stock INTEGER NOT NULL DEFAULT 0
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS print_event_parts (
      event_id INTEGER NOT NULL,
      part_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      name TEXT,
      PRIMARY KEY (event_id, part_id)
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_parts_name ON parts(name)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_print_event_parts_part_id ON print_event_parts(part_id)').run();
}

function normalizePartsUsage(raw) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const usages = [];
  const seen = new Set();
  for (const item of list) {
    if (item == null || item === '') continue;
    const id = item && typeof item === 'object' ? Number(item.id ?? item.partId) : Number(item);
    const qtyRaw = item && typeof item === 'object' ? Number(item.quantity ?? item.qty ?? 1) : 1;
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    if (!Number.isFinite(qtyRaw) || qtyRaw < 1) continue;
    seen.add(id);
    usages.push({ id, quantity: Math.min(Math.floor(qtyRaw), 9999) });
  }
  return usages;
}

function applyPartUsage(db, eventId, usages, copies) {
  if (!usages.length) return;
  const selectPart = db.prepare('SELECT id, name, quantity FROM parts WHERE id = ?');
  const deduct = db.prepare('UPDATE parts SET quantity = quantity - ? WHERE id = ?');
  const link = db.prepare('INSERT INTO print_event_parts (event_id, part_id, quantity, name) VALUES (?, ?, ?, ?)');
  for (const usage of usages) {
    const part = selectPart.get(usage.id);
    if (!part) throw new Error('Part not found');
    const needed = usage.quantity * copies;
    const available = Number(part.quantity) || 0;
    if (available < needed) {
      throw new Error(`Not enough "${part.name}" in stock (${available} available, ${needed} needed).`);
    }
    deduct.run(needed, part.id);
    link.run(eventId, part.id, needed, part.name);
  }
}

function restorePartUsage(db, eventId) {
  const rows = db.prepare('SELECT part_id, quantity FROM print_event_parts WHERE event_id = ?').all(eventId);
  const restore = db.prepare('UPDATE parts SET quantity = quantity + ? WHERE id = ?');
  for (const row of rows) {
    restore.run(Number(row.quantity) || 0, row.part_id);
  }
  db.prepare('DELETE FROM print_event_parts WHERE event_id = ?').run(eventId);
}

function migratePrintLifecycle(db) {
  const tableInfo = db.prepare('PRAGMA table_info(models)').all();
  const names = new Set(tableInfo.map((col) => col.name));
  const additions = [
    ['print_status', "TEXT DEFAULT 'unprinted'"],
    ['print_count', 'INTEGER DEFAULT 0'],
    ['last_printed_at', 'DATETIME']
  ];
  for (const [col, ddl] of additions) {
    if (!names.has(col)) {
      db.prepare(`ALTER TABLE models ADD COLUMN ${col} ${ddl}`).run();
    }
  }
  ensurePrintLifecycleSchema(db);
  db.prepare('CREATE INDEX IF NOT EXISTS idx_models_print_status ON models(print_status)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_models_print_count ON models(print_count)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_models_last_printed_at ON models(last_printed_at)').run();

  db.prepare(`
    UPDATE models
    SET print_status = CASE
      WHEN printed = 1 THEN 'printed'
      ELSE 'unprinted'
    END
    WHERE print_status IS NULL OR print_status = ''
  `).run();
  db.prepare(`
    UPDATE models
    SET print_count = 0
    WHERE print_count IS NULL
  `).run();
}

function refreshPrintDerivedFields(db, modelId) {
  const successful = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS count, MAX(printed_at) AS last_at
    FROM print_events
    WHERE model_id = ? AND outcome = 'printed'
  `).get(modelId);
  const model = db.prepare('SELECT print_status FROM models WHERE id = ?').get(modelId);
  if (!model) return null;
  const printCount = Number(successful?.count) || 0;
  const lastPrintedAt = successful?.last_at || null;
  const status = normalizePrintStatus(model.print_status);
  const printed = derivedPrinted(status, printCount);
  db.prepare(`
    UPDATE models
    SET print_status = ?, print_count = ?, last_printed_at = ?, printed = ?
    WHERE id = ?
  `).run(status, printCount, lastPrintedAt, printed, modelId);
  return db.prepare(`
    SELECT id, filePath, print_status, print_count, last_printed_at, printed
    FROM models WHERE id = ?
  `).get(modelId);
}

function statusAfterOutcome(currentStatus, outcome) {
  const status = normalizePrintStatus(currentStatus);
  if (outcome === 'printed') return 'printed';
  if (outcome === 'failed') return 'failed';
  if (outcome === 'cancelled' && status === 'printing') return 'queued';
  return status;
}

function logPrintEvent(db, payload) {
  const modelId = resolveModelId(db, payload);
  if (!modelId) throw new Error('Model not found');
  const outcome = normalizeOutcome(payload.outcome);
  const quantity = normalizeQuantity(payload.quantity);
  const printedAt = toIsoDate(payload.printedAt);
  const notes = payload.notes != null ? String(payload.notes) : '';
  const filamentIds = normalizeFilamentIds(payload.filamentIds);
  const partsUsage = normalizePartsUsage(payload.parts);
  const printerIdRaw = payload?.printerId ?? payload?.printer_id;
  const printerId = printerIdRaw != null && Number(printerIdRaw) > 0 ? Number(printerIdRaw) : null;
  const createdAt = new Date().toISOString();

  const result = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO print_events (model_id, printed_at, outcome, quantity, notes, created_at, printer_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(modelId, printedAt, outcome, quantity, notes || null, createdAt, printerId);
    const eventId = insert.lastInsertRowid;
    const link = db.prepare('INSERT OR IGNORE INTO print_event_filaments (event_id, filament_id) VALUES (?, ?)');
    for (const filamentId of filamentIds) {
      const exists = db.prepare('SELECT id FROM filaments WHERE id = ?').get(filamentId);
      if (exists) link.run(eventId, filamentId);
    }
    applyPartUsage(db, eventId, partsUsage, quantity);
    const current = db.prepare('SELECT print_status FROM models WHERE id = ?').get(modelId);
    const nextStatus = statusAfterOutcome(current?.print_status, outcome);
    db.prepare('UPDATE models SET print_status = ? WHERE id = ?').run(nextStatus, modelId);
    const derived = refreshPrintDerivedFields(db, modelId);
    return { eventId, model: derived };
  })();
  return result;
}

function logPrintEventsBatch(db, payload) {
  const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths.filter(Boolean) : [];
  const modelIds = Array.isArray(payload?.modelIds) ? payload.modelIds.filter((id) => Number(id) > 0) : [];
  const results = [];
  db.transaction(() => {
    for (const filePath of filePaths) {
      results.push(logPrintEvent(db, { ...payload, filePath }));
    }
    for (const modelId of modelIds) {
      results.push(logPrintEvent(db, { ...payload, modelId }));
    }
  })();
  return results;
}

function deletePrintEvent(db, eventId) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid print event');
  return db.transaction(() => {
    const row = db.prepare('SELECT id, model_id, outcome FROM print_events WHERE id = ?').get(id);
    if (!row) throw new Error('Print event not found');
    db.prepare('DELETE FROM print_event_filaments WHERE event_id = ?').run(id);
    restorePartUsage(db, id);
    db.prepare('DELETE FROM print_events WHERE id = ?').run(id);
    let model = refreshPrintDerivedFields(db, row.model_id);
    if (row.outcome === 'printed' && model && Number(model.print_count) === 0 && model.print_status === 'printed') {
      db.prepare('UPDATE models SET print_status = ?, printed = ? WHERE id = ?').run('unprinted', 0, row.model_id);
      model = refreshPrintDerivedFields(db, row.model_id);
    }
    return { deleted: true, model };
  })();
}

function setPrintStatus(db, payload) {
  const modelId = resolveModelId(db, payload);
  if (!modelId) throw new Error('Model not found');
  const status = normalizePrintStatus(payload.printStatus || payload.status);
  return db.transaction(() => {
    db.prepare('UPDATE models SET print_status = ? WHERE id = ?').run(status, modelId);
    return refreshPrintDerivedFields(db, modelId);
  })();
}

function setPrintStatusBatch(db, payload) {
  const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths.filter(Boolean) : [];
  const status = normalizePrintStatus(payload.printStatus || payload.status);
  const results = [];
  db.transaction(() => {
    for (const filePath of filePaths) {
      results.push(setPrintStatus(db, { filePath, printStatus: status }));
    }
  })();
  return results;
}

function getPrintEvents(db, modelId) {
  const id = Number(modelId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const hasPrintersTable = (function() {
    try {
      return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='printers'").get());
    } catch (_) { return false; }
  })();

  const hasPrinterTypeCol = hasPrintersTable && (function() {
    try {
      const cols = db.prepare("PRAGMA table_info(printers)").all();
      return cols.some(c => c.name === 'printer_type');
    } catch (_) { return false; }
  })();

  const selectFields = hasPrintersTable
    ? `pe.id, pe.model_id, pe.printed_at, pe.outcome, pe.quantity, pe.notes, pe.created_at, pe.printer_id,
       pr.nickname AS printer_nickname, pr.manufacturer AS printer_manufacturer, pr.model AS printer_model,
       ${hasPrinterTypeCol ? 'pr.printer_type' : 'NULL'} AS printer_type`
    : `pe.id, pe.model_id, pe.printed_at, pe.outcome, pe.quantity, pe.notes, pe.created_at, pe.printer_id,
       NULL AS printer_nickname, NULL AS printer_manufacturer, NULL AS printer_model, NULL AS printer_type`;

  const fromClause = hasPrintersTable
    ? `FROM print_events pe LEFT JOIN printers pr ON pr.id = pe.printer_id`
    : `FROM print_events pe`;

  const events = db.prepare(`
    SELECT ${selectFields}
    ${fromClause}
    WHERE pe.model_id = ?
    ORDER BY pe.printed_at DESC, pe.id DESC
  `).all(id);
  const filamentStmt = db.prepare(`
    SELECT f.id, f.name, f.vendor, f.material, f.color_hex, f.diameter, f.spoolman_id, f.source
    FROM filaments f
    JOIN print_event_filaments pef ON pef.filament_id = f.id
    WHERE pef.event_id = ?
    ORDER BY f.vendor COLLATE NOCASE, f.name COLLATE NOCASE
  `);
  const partStmt = db.prepare(`
    SELECT pep.part_id AS id,
           COALESCE(p.name, pep.name) AS name,
           p.category AS category,
           p.unit AS unit,
           pep.quantity AS quantity
    FROM print_event_parts pep
    LEFT JOIN parts p ON p.id = pep.part_id
    WHERE pep.event_id = ?
    ORDER BY name COLLATE NOCASE
  `);
  return events.map((event) => ({
    ...event,
    filaments: filamentStmt.all(event.id),
    parts: partStmt.all(event.id)
  }));
}

function deletePrintRowsForModel(db, modelId) {
  const events = db.prepare('SELECT id FROM print_events WHERE model_id = ?').all(modelId);
  const delFil = db.prepare('DELETE FROM print_event_filaments WHERE event_id = ?');
  const delParts = db.prepare('DELETE FROM print_event_parts WHERE event_id = ?');
  for (const event of events) {
    delFil.run(event.id);
    delParts.run(event.id);
  }
  db.prepare('DELETE FROM print_events WHERE model_id = ?').run(modelId);
}

function deletePrintEventFilamentsForFilament(db, filamentId) {
  db.prepare('DELETE FROM print_event_filaments WHERE filament_id = ?').run(filamentId);
}

function resolveModelId(db, payload) {
  if (!payload) return null;
  if (payload.modelId != null && Number(payload.modelId) > 0) {
    const row = db.prepare('SELECT id FROM models WHERE id = ?').get(Number(payload.modelId));
    return row ? row.id : null;
  }
  if (payload.filePath) {
    const row = db.prepare('SELECT id FROM models WHERE filePath = ?').get(payload.filePath);
    return row ? row.id : null;
  }
  return null;
}

function bundlePrintSummary(children) {
  const list = Array.isArray(children) ? children : [];
  const childCount = list.length;
  let everPrinted = 0;
  let totalCount = 0;
  for (const child of list) {
    const count = Number(child?.print_count) || 0;
    totalCount += count;
    if (count > 0 || child?.printed || effectivePrintStatus(child) === 'printed') everPrinted += 1;
  }
  if (childCount === 0 || everPrinted === 0) {
    return { label: 'Not printed', className: 'print-status-unprinted', mixed: false, printedCount: 0, totalCount: 0 };
  }
  if (everPrinted === childCount) {
    return {
      label: totalCount > 0 ? `Printed ×${totalCount}` : 'Printed',
      className: 'print-status-printed printed',
      mixed: false,
      printedCount: everPrinted,
      totalCount
    };
  }
  return {
    label: totalCount > 0 ? `Mixed ×${totalCount}` : 'Mixed',
    className: 'print-status-mixed mixed',
    mixed: true,
    printedCount: everPrinted,
    totalCount
  };
}

module.exports = {
  PRINT_STATUSES,
  PRINT_OUTCOMES,
  STATUS_LABELS,
  FILTER_LABELS,
  STATUS_SORT_RANK,
  normalizePrintStatus,
  normalizeOutcome,
  statusFromPrintedFlag,
  derivedPrinted,
  effectivePrintStatus,
  badgeText,
  badgeClassNames,
  badgeTitle,
  formatPrintDate,
  filterLabel,
  printFilterSql,
  printFilterSqlBound,
  modelMatchesPrintFilter,
  printSortOrderClause,
  normalizeQuantity,
  normalizeFilamentIds,
  normalizePartsUsage,
  ensurePartsSchema,
  resolvePrintFieldsOnSave,
  migratePrintLifecycle,
  ensurePrintLifecycleSchema,
  refreshPrintDerivedFields,
  logPrintEvent,
  logPrintEventsBatch,
  deletePrintEvent,
  setPrintStatus,
  setPrintStatusBatch,
  getPrintEvents,
  deletePrintRowsForModel,
  deletePrintEventFilamentsForFilament,
  bundlePrintSummary
};
