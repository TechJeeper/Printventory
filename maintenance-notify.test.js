'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const maintenanceNotify = require('./maintenance-notify');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('getDueReminders filters by date', () => {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE printers (id INTEGER PRIMARY KEY, nickname TEXT)
  `).run();
  db.prepare(`
    CREATE TABLE printer_maintenance_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      printer_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      maintenance_type TEXT,
      due_date DATETIME NOT NULL,
      interval_days INTEGER DEFAULT 0,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      last_completed_at DATETIME,
      created_at DATETIME NOT NULL
    )
  `).run();
  db.prepare("INSERT INTO printers (id, nickname) VALUES (1, 'X1')").run();
  db.prepare(`
    INSERT INTO printer_maintenance_reminders
      (printer_id, title, due_date, status, created_at)
    VALUES (1, 'Oil rails', '2020-01-01', 'pending', '2020-01-01')
  `).run();
  db.prepare(`
    INSERT INTO printer_maintenance_reminders
      (printer_id, title, due_date, status, created_at)
    VALUES (1, 'Future', '2099-01-01', 'pending', '2020-01-01')
  `).run();
  const due = maintenanceNotify.getDueReminders(db, { asOf: '2026-01-01' });
  assert.equal(due.length, 1);
  assert.equal(due[0].title, 'Oil rails');
  const note = maintenanceNotify.formatNotification(due[0]);
  assert.match(note.title, /X1/);
  db.close();
});

console.log('maintenance-notify tests done');
