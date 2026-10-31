'use strict';

const printEvents = require('./print-events');

const BOARD_COLUMNS = Object.freeze(['want', 'queued', 'printing', 'printed', 'failed']);
const COLUMNS = BOARD_COLUMNS;

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch (_) {
    return false;
  }
}

function deletedFilter(db, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (hasColumn(db, 'models', 'deleted_at')) {
    return ` AND ${prefix}deleted_at IS NULL`;
  }
  return '';
}

function getQueueBoard(db, { limitPerColumn = 200 } = {}) {
  const board = { want: [], queued: [], printing: [], printed: [], failed: [] };
  const filter = deletedFilter(db);
  const limit = Math.max(1, Math.min(Number(limitPerColumn) || 200, 2000));

  for (const status of BOARD_COLUMNS) {
    try {
      board[status] = db.prepare(`
        SELECT id, filePath, fileName, designer, print_status, print_count,
               last_printed_at, printed, rating, favorite
        FROM models
        WHERE COALESCE(print_status, 'unprinted') = ?
        ${filter}
        ORDER BY fileName COLLATE NOCASE ASC
        LIMIT ?
      `).all(status, limit);
    } catch (_) {
      board[status] = [];
    }
  }
  return board;
}

function filamentTotalsPerColumn(db) {
  const out = { want: 0, queued: 0, printing: 0, printed: 0, failed: 0 };
  const filter = deletedFilter(db, 'm');
  for (const status of BOARD_COLUMNS) {
    try {
      const row = db.prepare(`
        SELECT COUNT(mf.filament_id) AS filamentLinks
        FROM models m
        LEFT JOIN model_filaments mf ON mf.model_id = m.id
        WHERE COALESCE(m.print_status, 'unprinted') = ?
        ${filter}
      `).get(status);
      out[status] = Number(row?.filamentLinks) || 0;
    } catch (_) {
      out[status] = 0;
    }
  }
  return out;
}

/**
 * Move model to printing. Does not invent a successful print event unless logStub is set.
 */
function startPrint(db, modelId, options = {}) {
  const id = Number(modelId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid model id');
  const printerIdRaw = options.printerId ?? options.printer_id;
  const printerId = printerIdRaw != null && Number(printerIdRaw) > 0 ? Number(printerIdRaw) : null;

  const model = db.prepare('SELECT id, print_status FROM models WHERE id = ?').get(id);
  if (!model) throw new Error('Model not found');

  const updated = printEvents.setPrintStatus(db, { modelId: id, printStatus: 'printing' });

  if (options.logStub) {
    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO print_events (model_id, printed_at, outcome, quantity, notes, created_at, printer_id)
        VALUES (?, ?, 'cancelled', 1, ?, ?, ?)
      `).run(id, now, 'Started from queue', now, printerId);
    } catch (_) { /* print_events may lack printer_id in older DBs */ }
  }

  return { ok: true, model: updated, modelId: id, status: 'printing', printerId };
}

function moveToStatus(db, modelId, status) {
  return printEvents.setPrintStatus(db, { modelId, printStatus: status });
}

module.exports = {
  BOARD_COLUMNS,
  COLUMNS,
  getQueueBoard,
  filamentTotalsPerColumn,
  startPrint,
  moveToStatus
};
