'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const printerManager = require('./printer-manager');

function createTestDb() {
  const db = new Database(':memory:');
  printerManager.ensurePrinterSchema(db);
  return db;
}

test('creates and retrieves a printer', () => {
  const db = createTestDb();
  const printer = printerManager.savePrinter(db, {
    nickname: 'Living Room Ender',
    manufacturer: 'Creality',
    model: 'Ender 3 V2',
    firmwareType: 'Marlin',
    webUrl: 'http://octopi.local'
  });

  assert.equal(printer.nickname, 'Living Room Ender');
  assert.equal(printer.manufacturer, 'Creality');
  assert.equal(printer.model, 'Ender 3 V2');
  assert.equal(printer.firmware_type, 'Marlin');
  assert.equal(printer.is_klipper, false);
  assert.equal(printer.web_url, 'http://octopi.local');

  const all = printerManager.getAllPrinters(db);
  assert.equal(all.length, 1);
  assert.equal(all[0].nickname, 'Living Room Ender');
});

test('auto-detects Klipper from firmwareType or explicit flag', () => {
  const db = createTestDb();
  const voron = printerManager.savePrinter(db, {
    nickname: 'Stealth Voron 2.4',
    manufacturer: 'Voron Design',
    model: '2.4r2',
    firmwareType: 'Klipper',
    webUrl: 'mainsail.local'
  });

  assert.equal(voron.is_klipper, true);
  // Auto-prefixes http:// if omitted
  assert.equal(voron.web_url, 'http://mainsail.local');

  const customKlipper = printerManager.savePrinter(db, {
    nickname: 'Custom Delta',
    firmwareType: 'Custom',
    isKlipper: true
  });
  assert.equal(customKlipper.is_klipper, true);
});

test('updates and deletes a printer', () => {
  const db = createTestDb();
  const created = printerManager.savePrinter(db, { nickname: 'Prusa MK3S+' });
  assert.equal(created.nickname, 'Prusa MK3S+');

  const updated = printerManager.savePrinter(db, {
    id: created.id,
    nickname: 'Prusa MK3S+ (Upgraded)',
    model: 'MK3.5'
  });
  assert.equal(updated.nickname, 'Prusa MK3S+ (Upgraded)');
  assert.equal(updated.model, 'MK3.5');

  const deleted = printerManager.deletePrinter(db, created.id);
  assert.equal(deleted, true);
  assert.equal(printerManager.getAllPrinters(db).length, 0);
});

test('manages maintenance logs for a printer', () => {
  const db = createTestDb();
  const printer = printerManager.savePrinter(db, { nickname: 'Bambu X1C' });

  const log1 = printerManager.savePrinterMaintenanceLog(db, {
    printerId: printer.id,
    maintenanceType: 'Lubrication',
    title: 'Lubricate Y-axis carbon rods & lead screws',
    description: 'Cleaned with IPA and applied silicone lubricant',
    performedAt: new Date().toISOString()
  });

  assert.equal(log1.printer_id, printer.id);
  assert.equal(log1.maintenance_type, 'Lubrication');

  const logs = printerManager.getPrinterMaintenanceLogs(db, printer.id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].title, 'Lubricate Y-axis carbon rods & lead screws');

  const deleted = printerManager.deletePrinterMaintenanceLog(db, log1.id);
  assert.equal(deleted, true);
  assert.equal(printerManager.getPrinterMaintenanceLogs(db, printer.id).length, 0);
});

test('schedules reminders and marking completed creates log entry and rolls repeating reminder', () => {
  const db = createTestDb();
  const printer = printerManager.savePrinter(db, { nickname: 'Voron 0.2' });

  const reminder = printerManager.savePrinterReminder(db, {
    printerId: printer.id,
    title: 'Clean PEI sheet',
    maintenanceType: 'Cleaning',
    dueDate: new Date().toISOString(),
    intervalDays: 14,
    notes: 'Warm water and dish soap'
  });

  assert.equal(reminder.title, 'Clean PEI sheet');
  assert.equal(reminder.interval_days, 14);
  assert.equal(reminder.status, 'pending');

  // Complete reminder
  const completed = printerManager.completePrinterReminder(db, reminder.id, 'Done with Dawn soap');
  // Since intervalDays = 14, it rolls over to next pending due date
  assert.equal(completed.status, 'pending');
  assert.ok(new Date(completed.due_date) > new Date());

  // Check that maintenance log entry was automatically created
  const logs = printerManager.getPrinterMaintenanceLogs(db, printer.id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].title, 'Clean PEI sheet');
  assert.ok(logs[0].description.includes('Done with Dawn soap'));
});

test('tracks prints logged to a printer', () => {
  const db = createTestDb();
  const printEvents = require('./print-events');
  db.prepare(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE,
      fileName TEXT,
      printed INTEGER DEFAULT 0
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS filaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      vendor TEXT,
      material TEXT,
      color_hex TEXT,
      diameter REAL,
      spoolman_id INTEGER,
      source TEXT
    )
  `).run();
  printEvents.migratePrintLifecycle(db);
  const model = db.prepare('INSERT INTO models (filePath, fileName) VALUES (?, ?)').run('c:/test.stl', 'test.stl');

  const printer = printerManager.savePrinter(db, { nickname: 'Mercury One.1' });
  printEvents.logPrintEvent(db, {
    modelId: model.lastInsertRowid,
    printerId: printer.id,
    outcome: 'printed',
    quantity: 2
  });

  const printers = printerManager.getAllPrinters(db);
  const found = printers.find((p) => p.id === printer.id);
  assert.equal(found.total_prints, 1);
  assert.ok(found.last_printed_at);

  const history = printEvents.getPrintEvents(db, model.lastInsertRowid);
  assert.equal(history.length, 1);
  assert.equal(history[0].printer_id, printer.id);
  assert.equal(history[0].printer_nickname, 'Mercury One.1');
});

test('supports printer types: FDM, SLA, SLS, DLP, LCD, MJF, DMLS, SLM', () => {
  const db = createTestDb();
  const types = ['FDM', 'SLA', 'SLS', 'DLP', 'LCD', 'MJF', 'DMLS', 'SLM'];

  types.forEach((type, idx) => {
    const p = printerManager.savePrinter(db, {
      nickname: `Machine ${idx + 1} (${type})`,
      printerType: type
    });
    assert.equal(p.printer_type, type);
  });

  const all = printerManager.getAllPrinters(db);
  assert.equal(all.length, types.length);
  types.forEach((type) => {
    assert.ok(all.some((p) => p.printer_type === type));
  });

  // Updating printer type
  const first = all[0];
  const updated = printerManager.savePrinter(db, {
    id: first.id,
    nickname: first.nickname,
    printerType: 'SLS'
  });
  assert.equal(updated.printer_type, 'SLS');
});

test('migrates older schema without printer_type column safely', () => {
  const db = new Database(':memory:');
  // Create old table structure without printer_type
  db.prepare(`
    CREATE TABLE printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      manufacturer TEXT,
      model TEXT,
      firmware_type TEXT,
      is_klipper INTEGER DEFAULT 0,
      web_url TEXT,
      notes TEXT,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `).run();

  db.prepare(`
    INSERT INTO printers (nickname, created_at, updated_at)
    VALUES ('Legacy Ender', datetime('now'), datetime('now'))
  `).run();

  // Run ensurePrinterSchema migration
  printerManager.ensurePrinterSchema(db);

  const printers = printerManager.getAllPrinters(db);
  assert.equal(printers.length, 1);
  assert.equal(printers[0].nickname, 'Legacy Ender');
  assert.equal(printers[0].printer_type, null);

  // Now update it with a printer_type
  const updated = printerManager.savePrinter(db, {
    id: printers[0].id,
    nickname: 'Legacy Ender',
    printerType: 'FDM'
  });
  assert.equal(updated.printer_type, 'FDM');
});

