'use strict';

/**
 * Backend logic and SQLite data access for Printer Management,
 * maintenance logs, and scheduled maintenance reminders.
 */

const { normalizePrinterHost } = require('./printer-discovery');

function ensurePrinterSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      manufacturer TEXT,
      model TEXT,
      printer_type TEXT,
      firmware_type TEXT,
      is_klipper INTEGER DEFAULT 0,
      web_url TEXT,
      host TEXT,
      bambu_serial TEXT,
      bambu_access_code TEXT,
      prusa_username TEXT,
      prusa_password TEXT,
      notes TEXT,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `).run();

  try {
    const printerCols = db.prepare('PRAGMA table_info(printers)').all();
    if (printerCols.length > 0 && !printerCols.some((col) => col.name === 'printer_type')) {
      db.prepare('ALTER TABLE printers ADD COLUMN printer_type TEXT').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_printers_printer_type ON printers(printer_type)').run();
    }
    const connectionCols = [
      ['host', 'TEXT'],
      ['bambu_serial', 'TEXT'],
      ['bambu_access_code', 'TEXT'],
      ['prusa_username', 'TEXT'],
      ['prusa_password', 'TEXT']
    ];
    const refreshedCols = db.prepare('PRAGMA table_info(printers)').all();
    for (const [name, type] of connectionCols) {
      if (refreshedCols.length > 0 && !refreshedCols.some((col) => col.name === name)) {
        db.prepare(`ALTER TABLE printers ADD COLUMN ${name} ${type}`).run();
      }
    }
  } catch (err) {
    // Ignore migration error if already exists
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS printer_maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      printer_id INTEGER NOT NULL,
      maintenance_type TEXT NOT NULL,
      title TEXT,
      description TEXT,
      performed_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY(printer_id) REFERENCES printers(id) ON DELETE CASCADE
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS printer_maintenance_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      printer_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      maintenance_type TEXT,
      due_date DATETIME NOT NULL,
      interval_days INTEGER DEFAULT 0,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      last_completed_at DATETIME,
      created_at DATETIME NOT NULL,
      FOREIGN KEY(printer_id) REFERENCES printers(id) ON DELETE CASCADE
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_printers_nickname ON printers(nickname)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_printers_printer_type ON printers(printer_type)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_printer_maintenance_logs_printer_id ON printer_maintenance_logs(printer_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_printer_maintenance_logs_performed_at ON printer_maintenance_logs(performed_at)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_printer_reminders_printer_id ON printer_maintenance_reminders(printer_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_printer_reminders_due_date ON printer_maintenance_reminders(due_date)').run();

  // Ensure print_events table has printer_id column
  try {
    const tableInfo = db.prepare('PRAGMA table_info(print_events)').all();
    if (tableInfo.length > 0 && !tableInfo.some((col) => col.name === 'printer_id')) {
      db.prepare('ALTER TABLE print_events ADD COLUMN printer_id INTEGER REFERENCES printers(id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_print_events_printer_id ON print_events(printer_id)').run();
    }
  } catch (err) {
    // If print_events does not exist yet, it will be added during ensurePrintLifecycleSchema
  }
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function hasTable(db, tableName) {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

function getAllPrinters(db) {
  ensurePrinterSchema(db);
  const hasPrintEvents = hasTable(db, 'print_events');
  const printEventsCols = hasPrintEvents
    ? `, (SELECT COUNT(*) FROM print_events pe WHERE pe.printer_id = p.id) AS total_prints,
       (SELECT MAX(pe.printed_at) FROM print_events pe WHERE pe.printer_id = p.id) AS last_printed_at`
    : ', 0 AS total_prints, NULL AS last_printed_at';

  const printers = db.prepare(`
    SELECT p.*${printEventsCols},
      (SELECT COUNT(*) FROM printer_maintenance_reminders pmr 
       WHERE pmr.printer_id = p.id AND pmr.status = 'pending' AND datetime(pmr.due_date) <= datetime('now', '+7 days')) AS due_reminders_count
    FROM printers p
    ORDER BY p.nickname COLLATE NOCASE ASC, p.id ASC
  `).all();

  return printers.map((p) => ({
    ...p,
    is_klipper: Boolean(p.is_klipper)
  }));
}

function getPrinterById(db, id) {
  ensurePrinterSchema(db);
  const row = db.prepare('SELECT * FROM printers WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    is_klipper: Boolean(row.is_klipper)
  };
}

function fieldProvided(printer, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(printer || {}, key));
}

function cleanOptionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function resolveTextField(printer, keys, existingValue) {
  if (!fieldProvided(printer, keys)) return existingValue ?? null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(printer, key)) return cleanOptionalText(printer[key]);
  }
  return existingValue ?? null;
}

function resolveWebUrl(printer, existingValue) {
  if (!fieldProvided(printer, ['webUrl', 'web_url'])) return existingValue ?? null;
  const raw = Object.prototype.hasOwnProperty.call(printer, 'webUrl') ? printer.webUrl : printer.web_url;
  let webUrl = cleanOptionalText(raw);
  if (webUrl && !/^https?:\/\//i.test(webUrl)) webUrl = `http://${webUrl}`;
  return webUrl;
}

function resolveHost(printer, existingValue) {
  if (!fieldProvided(printer, ['host'])) return existingValue ?? null;
  return normalizePrinterHost(printer.host);
}

function savePrinter(db, printer) {
  ensurePrinterSchema(db);
  const nickname = String(printer?.nickname || '').trim();
  if (!nickname) throw new Error('Printer nickname is required');

  const manufacturer = String(printer?.manufacturer || '').trim() || null;
  const model = String(printer?.model || '').trim() || null;
  const printerType = String(printer?.printerType || printer?.printer_type || printer?.technology || printer?.type || '').trim() || null;
  const firmwareType = String(printer?.firmwareType || printer?.firmware_type || '').trim() || null;
  const isKlipper = firmwareType && firmwareType.toLowerCase() === 'klipper' ? 1 : 0;
  const notes = String(printer?.notes || '').trim() || null;
  const now = new Date().toISOString();

  const id = printer?.id != null && printer.id !== '' ? Number(printer.id) : null;
  const existing = id ? db.prepare('SELECT * FROM printers WHERE id = ?').get(id) : null;
  if (id) {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid printer ID');
    if (!existing) throw new Error('Printer not found');
  }

  const webUrl = resolveWebUrl(printer, existing?.web_url);
  const host = resolveHost(printer, existing?.host);
  const bambuSerial = resolveTextField(printer, ['bambuSerial', 'bambu_serial'], existing?.bambu_serial);
  const bambuAccessCode = resolveTextField(printer, ['bambuAccessCode', 'bambu_access_code'], existing?.bambu_access_code);
  const prusaUsername = resolveTextField(printer, ['prusaUsername', 'prusa_username'], existing?.prusa_username);
  const prusaPassword = resolveTextField(printer, ['prusaPassword', 'prusa_password'], existing?.prusa_password);

  if (id) {
    db.prepare(`
      UPDATE printers
      SET nickname = ?, manufacturer = ?, model = ?, printer_type = ?, firmware_type = ?, is_klipper = ?, web_url = ?, host = ?, bambu_serial = ?, bambu_access_code = ?, prusa_username = ?, prusa_password = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(nickname, manufacturer, model, printerType, firmwareType, isKlipper, webUrl, host, bambuSerial, bambuAccessCode, prusaUsername, prusaPassword, notes, now, id);

    return getPrinterById(db, id);
  }

  const result = db.prepare(`
    INSERT INTO printers (nickname, manufacturer, model, printer_type, firmware_type, is_klipper, web_url, host, bambu_serial, bambu_access_code, prusa_username, prusa_password, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nickname, manufacturer, model, printerType, firmwareType, isKlipper, webUrl, host, bambuSerial, bambuAccessCode, prusaUsername, prusaPassword, notes, now, now);

  return getPrinterById(db, result.lastInsertRowid);
}

function deletePrinter(db, printerId) {
  ensurePrinterSchema(db);
  const id = Number(printerId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid printer ID');

  return db.transaction(() => {
    // Nullify printer_id in print_events to preserve history
    if (hasTable(db, 'print_events')) {
      db.prepare('UPDATE print_events SET printer_id = NULL WHERE printer_id = ?').run(id);
    }
    db.prepare('DELETE FROM printer_maintenance_logs WHERE printer_id = ?').run(id);
    db.prepare('DELETE FROM printer_maintenance_reminders WHERE printer_id = ?').run(id);
    const result = db.prepare('DELETE FROM printers WHERE id = ?').run(id);
    return result.changes > 0;
  })();
}

function getPrinterMaintenanceLogs(db, printerId) {
  ensurePrinterSchema(db);
  const id = Number(printerId);
  if (!Number.isInteger(id) || id <= 0) return [];

  return db.prepare(`
    SELECT * FROM printer_maintenance_logs
    WHERE printer_id = ?
    ORDER BY performed_at DESC, id DESC
  `).all(id);
}

function savePrinterMaintenanceLog(db, logEntry) {
  ensurePrinterSchema(db);
  const printerId = Number(logEntry?.printerId ?? logEntry?.printer_id);
  if (!Number.isInteger(printerId) || printerId <= 0) throw new Error('Valid printer ID is required');

  const maintenanceType = String(logEntry?.maintenanceType || logEntry?.maintenance_type || 'General Maintenance').trim();
  const title = String(logEntry?.title || maintenanceType).trim();
  const description = String(logEntry?.description || '').trim() || null;
  const performedAt = normalizeDate(logEntry?.performedAt ?? logEntry?.performed_at);
  const now = new Date().toISOString();

  const id = logEntry?.id != null && logEntry.id !== '' ? Number(logEntry.id) : null;
  if (id) {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid log ID');
    db.prepare(`
      UPDATE printer_maintenance_logs
      SET maintenance_type = ?, title = ?, description = ?, performed_at = ?
      WHERE id = ? AND printer_id = ?
    `).run(maintenanceType, title, description, performedAt, id, printerId);
    return db.prepare('SELECT * FROM printer_maintenance_logs WHERE id = ?').get(id);
  }

  const result = db.prepare(`
    INSERT INTO printer_maintenance_logs (printer_id, maintenance_type, title, description, performed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(printerId, maintenanceType, title, description, performedAt, now);

  return db.prepare('SELECT * FROM printer_maintenance_logs WHERE id = ?').get(result.lastInsertRowid);
}

function deletePrinterMaintenanceLog(db, logId) {
  ensurePrinterSchema(db);
  const id = Number(logId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid log ID');
  const result = db.prepare('DELETE FROM printer_maintenance_logs WHERE id = ?').run(id);
  return result.changes > 0;
}

function getPrinterReminders(db, printerId) {
  ensurePrinterSchema(db);
  let query = 'SELECT * FROM printer_maintenance_reminders';
  const params = [];

  if (printerId) {
    const id = Number(printerId);
    if (Number.isInteger(id) && id > 0) {
      query += ' WHERE printer_id = ?';
      params.push(id);
    }
  }

  query += ` ORDER BY 
    CASE status WHEN 'pending' THEN 0 ELSE 1 END,
    due_date ASC, id ASC`;

  return db.prepare(query).all(...params);
}

function savePrinterReminder(db, reminder) {
  ensurePrinterSchema(db);
  const printerId = Number(reminder?.printerId ?? reminder?.printer_id);
  if (!Number.isInteger(printerId) || printerId <= 0) throw new Error('Valid printer ID is required');

  const title = String(reminder?.title || '').trim();
  if (!title) throw new Error('Reminder title is required');

  const maintenanceType = String(reminder?.maintenanceType || reminder?.maintenance_type || 'General Maintenance').trim();
  const dueDate = normalizeDate(reminder?.dueDate ?? reminder?.due_date);
  const intervalDays = Math.max(0, Math.floor(Number(reminder?.intervalDays ?? reminder?.interval_days) || 0));
  const notes = String(reminder?.notes || '').trim() || null;
  const status = String(reminder?.status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending';
  const now = new Date().toISOString();

  const id = reminder?.id != null && reminder.id !== '' ? Number(reminder.id) : null;
  if (id) {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid reminder ID');
    db.prepare(`
      UPDATE printer_maintenance_reminders
      SET title = ?, maintenance_type = ?, due_date = ?, interval_days = ?, notes = ?, status = ?
      WHERE id = ? AND printer_id = ?
    `).run(title, maintenanceType, dueDate, intervalDays, notes, status, id, printerId);
    return db.prepare('SELECT * FROM printer_maintenance_reminders WHERE id = ?').get(id);
  }

  const result = db.prepare(`
    INSERT INTO printer_maintenance_reminders (printer_id, title, maintenance_type, due_date, interval_days, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(printerId, title, maintenanceType, dueDate, intervalDays, notes, status, now);

  return db.prepare('SELECT * FROM printer_maintenance_reminders WHERE id = ?').get(result.lastInsertRowid);
}

function deletePrinterReminder(db, reminderId) {
  ensurePrinterSchema(db);
  const id = Number(reminderId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid reminder ID');
  const result = db.prepare('DELETE FROM printer_maintenance_reminders WHERE id = ?').run(id);
  return result.changes > 0;
}

function completePrinterReminder(db, reminderId, notes) {
  ensurePrinterSchema(db);
  const id = Number(reminderId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid reminder ID');

  return db.transaction(() => {
    const reminder = db.prepare('SELECT * FROM printer_maintenance_reminders WHERE id = ?').get(id);
    if (!reminder) throw new Error('Reminder not found');

    const now = new Date().toISOString();
    const completionNotes = notes ? String(notes).trim() : (reminder.notes ? `Completed: ${reminder.notes}` : 'Completed scheduled reminder');

    // Automatically record a maintenance log entry
    savePrinterMaintenanceLog(db, {
      printerId: reminder.printer_id,
      maintenanceType: reminder.maintenance_type || 'Scheduled Maintenance',
      title: reminder.title,
      description: completionNotes,
      performedAt: now
    });

    // If repeating, advance due date by intervalDays; otherwise mark as completed
    if (reminder.interval_days > 0) {
      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() + reminder.interval_days);
      db.prepare(`
        UPDATE printer_maintenance_reminders
        SET due_date = ?, status = 'pending', last_completed_at = ?
        WHERE id = ?
      `).run(nextDue.toISOString(), now, id);
    } else {
      db.prepare(`
        UPDATE printer_maintenance_reminders
        SET status = 'completed', last_completed_at = ?
        WHERE id = ?
      `).run(now, id);
    }

    return db.prepare('SELECT * FROM printer_maintenance_reminders WHERE id = ?').get(id);
  })();
}

module.exports = {
  ensurePrinterSchema,
  getAllPrinters,
  getPrinterById,
  savePrinter,
  deletePrinter,
  getPrinterMaintenanceLogs,
  savePrinterMaintenanceLog,
  deletePrinterMaintenanceLog,
  getPrinterReminders,
  savePrinterReminder,
  deletePrinterReminder,
  completePrinterReminder
};
