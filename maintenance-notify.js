'use strict';

/**
 * Surface due printer maintenance reminders + optional webhooks.
 */

function getDueReminders(db, { asOf = null } = {}) {
  const when = asOf || new Date().toISOString();
  return db.prepare(`
    SELECT r.*, p.nickname AS printer_nickname
    FROM printer_maintenance_reminders r
    LEFT JOIN printers p ON p.id = r.printer_id
    WHERE COALESCE(r.status, 'pending') = 'pending'
      AND r.due_date IS NOT NULL
      AND r.due_date <= ?
    ORDER BY r.due_date ASC
  `).all(when);
}

function formatNotification(reminder) {
  const printer = reminder.printer_nickname || `Printer #${reminder.printer_id}`;
  const title = reminder.title || 'Maintenance due';
  const due = reminder.due_date || '';
  return {
    title: `Maintenance: ${printer}`,
    body: `${title}${due ? ` (due ${due})` : ''}`,
    printerId: reminder.printer_id,
    reminderId: reminder.id
  };
}

function dismissReminder(db, reminderId) {
  return db.prepare(`
    UPDATE printer_maintenance_reminders
    SET status = 'dismissed'
    WHERE id = ?
  `).run(reminderId);
}

function completeReminder(db, reminderId) {
  const row = db.prepare('SELECT * FROM printer_maintenance_reminders WHERE id = ?').get(reminderId);
  if (!row) return { ok: false };
  const interval = Number(row.interval_days) || 0;
  if (interval > 0) {
    db.prepare(`
      UPDATE printer_maintenance_reminders
      SET status = 'pending',
          last_completed_at = datetime('now'),
          due_date = datetime('now', '+' || ? || ' days')
      WHERE id = ?
    `).run(interval, reminderId);
  } else {
    db.prepare(`
      UPDATE printer_maintenance_reminders
      SET status = 'completed', last_completed_at = datetime('now')
      WHERE id = ?
    `).run(reminderId);
  }
  return { ok: true };
}

/**
 * Reminders that trigger when a printer's logged print count hits N.
 * Stored as notes JSON or title pattern: "print_count:N" in notes field as `trigger:print_count=N`.
 */
function checkPrintCountTriggers(db) {
  const reminders = db.prepare(`
    SELECT r.*, p.nickname AS printer_nickname
    FROM printer_maintenance_reminders r
    LEFT JOIN printers p ON p.id = r.printer_id
    WHERE COALESCE(r.status, 'pending') = 'pending'
      AND (r.notes LIKE '%trigger:print_count=%' OR r.maintenance_type = 'print_count')
  `).all();

  const due = [];
  for (const r of reminders) {
    const m = String(r.notes || '').match(/trigger:print_count=(\d+)/i);
    const threshold = m ? Number(m[1]) : null;
    if (!threshold) continue;
    const countRow = db.prepare(`
      SELECT COUNT(*) AS c FROM print_events WHERE printer_id = ?
    `).get(r.printer_id);
    const count = countRow ? countRow.c : 0;
    if (count >= threshold) {
      due.push({ ...r, print_count: count, threshold });
    }
  }
  return due;
}

async function emitWebhook(url, payload, { fetchImpl = global.fetch } = {}) {
  const target = String(url || '').trim();
  if (!target) return { ok: false, reason: 'no url' };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no fetch' };
  try {
    const res = await fetchImpl(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function checkOnLaunch(db, options = {}) {
  const due = getDueReminders(db, options);
  const printTriggers = checkPrintCountTriggers(db);
  const notifications = [
    ...due.map(formatNotification),
    ...printTriggers.map((r) => formatNotification({
      ...r,
      title: r.title || `Maintenance after ${r.threshold || '?'} prints`
    }))
  ];
  return { due, printTriggers, notifications };
}

module.exports = {
  getDueReminders,
  formatNotification,
  dismissReminder,
  completeReminder,
  checkPrintCountTriggers,
  emitWebhook,
  checkOnLaunch
};
