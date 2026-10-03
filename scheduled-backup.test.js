#!/usr/bin/env node
'use strict';

const assert = require('assert');
const scheduledBackup = require('./scheduled-backup');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

function atLocal(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

test('missing frequency, time, and keep count fall back to defaults', () => {
  assert.strictEqual(scheduledBackup.normalizeFrequency(''), 'off');
  assert.strictEqual(scheduledBackup.normalizeFrequency('yearly'), 'off');
  assert.strictEqual(scheduledBackup.normalizeFrequency(' Weekly '), 'weekly');
  assert.strictEqual(scheduledBackup.normalizeTime(''), '03:00');
  assert.strictEqual(scheduledBackup.normalizeTime('3:05'), '03:05');
  assert.strictEqual(scheduledBackup.normalizeTime('15:45'), '15:45');
  assert.strictEqual(scheduledBackup.normalizeTime('24:00'), '03:00');
  assert.strictEqual(scheduledBackup.normalizeKeep(''), scheduledBackup.DEFAULT_KEEP);
  assert.strictEqual(scheduledBackup.normalizeKeep('0'), 1);
  assert.strictEqual(scheduledBackup.normalizeKeep('1000'), 100);
  assert.strictEqual(scheduledBackup.normalizeKeep('4'), 4);
});

test('daily and weekly are due at the chosen local time', () => {
  const time = '15:30';
  const thursday = atLocal(2026, 10, 1, 15, 30);
  const thursdayIso = thursday.toISOString();
  assert.strictEqual(scheduledBackup.isBackupDue('daily', '', thursday.getTime(), time), true);
  assert.strictEqual(scheduledBackup.isBackupDue('daily', 'not-a-date', thursday.getTime(), time), true);
  assert.strictEqual(scheduledBackup.isBackupDue('daily', thursdayIso, atLocal(2026, 10, 2, 15, 29).getTime(), time), false);
  assert.strictEqual(scheduledBackup.isBackupDue('daily', thursdayIso, atLocal(2026, 10, 2, 15, 30).getTime(), time), true);

  const sunday = atLocal(2026, 10, 4, 15, 30);
  const sundayIso = sunday.toISOString();
  assert.strictEqual(scheduledBackup.isBackupDue('weekly', sundayIso, atLocal(2026, 10, 11, 15, 29).getTime(), time), false);
  assert.strictEqual(scheduledBackup.isBackupDue('weekly', sundayIso, atLocal(2026, 10, 11, 15, 30).getTime(), time), true);
  const previousSunday = atLocal(2026, 9, 27, 15, 30);
  assert.strictEqual(
    scheduledBackup.isBackupDue('weekly', previousSunday.toISOString(), atLocal(2026, 10, 7, 9, 0).getTime(), time),
    true
  );
});

test('quit and off never fire from the timer', () => {
  const now = atLocal(2026, 10, 3, 12, 0).getTime();
  assert.strictEqual(scheduledBackup.isBackupDue('quit', '', now, '03:00'), false);
  assert.strictEqual(scheduledBackup.isBackupDue('off', new Date(now).toISOString(), now, '03:00'), false);
  assert.strictEqual(scheduledBackup.isBackupDue('quit', new Date(now).toISOString(), now, '15:30'), false);
});

test('rotation keeps the newest copies and leaves unrelated files', () => {
  const newest = scheduledBackup.backupFileName(new Date('2026-10-03T03:00:00.000Z'));
  const middle = scheduledBackup.backupFileName(new Date('2026-10-02T03:00:00.000Z'));
  const oldest = scheduledBackup.backupFileName(new Date('2026-10-01T03:00:00.000Z'));
  const names = [oldest, 'notes.txt', newest, 'backup_printventory.db', middle, 'printventory-backup-bad.db'];
  assert.deepStrictEqual(scheduledBackup.filesToPrune(names, 2), [oldest]);
  assert.deepStrictEqual(scheduledBackup.filesToPrune(names, 10), []);
  assert.deepStrictEqual(scheduledBackup.filesToPrune(names), []);
});

test('backup file names match the rotation pattern', () => {
  const name = scheduledBackup.backupFileName(new Date('2026-10-03T15:04:05.006Z'));
  assert.strictEqual(name, 'printventory-backup-2026-10-03T15-04-05-006Z.db');
  assert.deepStrictEqual(scheduledBackup.filesToPrune([name], 1), []);
});

test('OS task is only for packaged desktop daily or weekly with a folder', () => {
  const base = { packaged: true, serverMode: false, folder: '\\\\nas\\backups', frequency: 'daily' };
  assert.strictEqual(scheduledBackup.shouldRegisterOsTask(base), true);
  assert.strictEqual(scheduledBackup.shouldRegisterOsTask({ ...base, frequency: 'weekly' }), true);
  assert.strictEqual(scheduledBackup.shouldRegisterOsTask({ ...base, frequency: 'quit' }), false);
  assert.strictEqual(scheduledBackup.shouldRegisterOsTask({ ...base, frequency: 'off' }), false);
  assert.strictEqual(scheduledBackup.shouldRegisterOsTask({ ...base, folder: '  ' }), false);
  assert.strictEqual(scheduledBackup.shouldRegisterOsTask({ ...base, packaged: false }), false);
  assert.strictEqual(scheduledBackup.shouldRegisterOsTask({ ...base, serverMode: true }), false);
});

test('Windows task XML runs the backup flag and catches up after sleep', () => {
  const xml = scheduledBackup.windowsTaskXml({
    exePath: 'C:\\Program Files\\Printventory & Co\\Printventory.exe',
    frequency: 'weekly'
  });
  assert.ok(xml.includes('<StartWhenAvailable>true</StartWhenAvailable>'));
  assert.ok(xml.includes('<Sunday />'));
  assert.ok(xml.includes('<Command>C:\\Program Files\\Printventory &amp; Co\\Printventory.exe</Command>'));
  assert.ok(xml.includes('<StartBoundary>2026-01-04T03:00:00</StartBoundary>'));
  assert.ok(xml.includes('<Arguments>--scheduled-backup</Arguments>'));
  assert.ok(!xml.includes('<ScheduleByDay>'));
  const daily = scheduledBackup.windowsTaskXml({ exePath: 'Printventory.exe', frequency: 'daily', time: '15:45' });
  assert.ok(daily.includes('<StartBoundary>2026-01-04T15:45:00</StartBoundary>'));
  assert.ok(daily.includes('<DaysInterval>1</DaysInterval>'));
  assert.ok(!daily.includes('<Sunday />'));
});

test('launchd and systemd schedules match daily and weekly', () => {
  const weeklyPlist = scheduledBackup.launchAgentPlist({
    exePath: '/Applications/Printventory.app/Contents/MacOS/Printventory',
    frequency: 'weekly'
  });
  assert.ok(weeklyPlist.includes('<integer>0</integer>'));
  assert.ok(weeklyPlist.includes('<integer>3</integer>'));
  assert.ok(weeklyPlist.includes('--scheduled-backup'));
  const dailyPlist = scheduledBackup.launchAgentPlist({ exePath: '/bin/Printventory', frequency: 'daily', time: '15:45' });
  assert.ok(!dailyPlist.includes('Weekday'));
  assert.ok(dailyPlist.includes('<integer>15</integer>'));
  assert.ok(dailyPlist.includes('<integer>45</integer>'));

  const service = scheduledBackup.systemdService({ exePath: '/opt/Printventory AppImage' });
  assert.ok(service.includes('ExecStart="/opt/Printventory AppImage" --scheduled-backup'));
  assert.ok(scheduledBackup.systemdTimer({ frequency: 'daily' }).includes('OnCalendar=*-*-* 03:00:00'));
  assert.ok(scheduledBackup.systemdTimer({ frequency: 'daily', time: '15:45' }).includes('OnCalendar=*-*-* 15:45:00'));
  assert.ok(scheduledBackup.systemdTimer({ frequency: 'daily' }).includes('Persistent=true'));
  assert.ok(scheduledBackup.systemdTimer({ frequency: 'weekly', time: '15:45' }).includes('OnCalendar=Sun *-*-* 15:45:00'));
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
