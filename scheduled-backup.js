'use strict';

const FREQUENCIES = ['off', 'daily', 'weekly', 'quit'];
const DEFAULT_TIME = '03:00';
const DEFAULT_KEEP = 10;
const MIN_KEEP = 1;
const MAX_KEEP = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const BACKUP_NAME_RE = /^printventory-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.db$/;

const WINDOWS_TASK_NAME = 'Printventory\\Database Backup';
const LAUNCH_AGENT_LABEL = 'com.printventory.backup';
const SYSTEMD_UNIT_NAME = 'printventory-backup';
const SETTING_KEYS = ['scheduledBackupFolder', 'scheduledBackupFrequency', 'scheduledBackupTime', 'scheduledBackupKeep'];

function normalizeFrequency(value) {
  const frequency = String(value || '').trim().toLowerCase();
  return FREQUENCIES.includes(frequency) ? frequency : 'off';
}

function normalizeKeep(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_KEEP;
  return Math.min(MAX_KEEP, Math.max(MIN_KEEP, parsed));
}

function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value == null ? '' : value).trim());
  if (!match) return DEFAULT_TIME;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return DEFAULT_TIME;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function mostRecentSlotMs(nowMs, timeOfDay, weekly) {
  const normalized = normalizeTime(timeOfDay);
  const hour = parseInt(normalized.slice(0, 2), 10);
  const minute = parseInt(normalized.slice(3, 5), 10);
  const slot = new Date(nowMs);
  slot.setSeconds(0, 0);
  slot.setHours(hour, minute, 0, 0);
  if (weekly) {
    slot.setDate(slot.getDate() - slot.getDay());
    if (slot.getTime() > nowMs) slot.setDate(slot.getDate() - 7);
  } else if (slot.getTime() > nowMs) {
    slot.setDate(slot.getDate() - 1);
  }
  return slot.getTime();
}

function isBackupDue(frequency, lastSuccessIso, nowMs, timeOfDay) {
  const normalized = normalizeFrequency(frequency);
  if (normalized !== 'daily' && normalized !== 'weekly') return false;
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return false;
  const slot = mostRecentSlotMs(now, timeOfDay, normalized === 'weekly');
  if (lastSuccessIso == null || String(lastSuccessIso).trim() === '') return true;
  const last = Date.parse(String(lastSuccessIso));
  if (!Number.isFinite(last)) return true;
  return last < slot;
}

function backupFileName(date) {
  const when = date instanceof Date ? date : new Date(date);
  const stamp = when.toISOString().replace(/[:.]/g, '-');
  return `printventory-backup-${stamp}.db`;
}

function filesToPrune(names, keep) {
  const retain = normalizeKeep(keep);
  const matched = (Array.isArray(names) ? names : [])
    .map((name) => {
      const match = BACKUP_NAME_RE.exec(String(name));
      return match ? { name: String(name), stamp: match[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
  return matched.slice(retain).map((entry) => entry.name);
}

function shouldRegisterOsTask({ packaged, serverMode, folder, frequency }) {
  if (!packaged || serverMode) return false;
  if (!String(folder || '').trim()) return false;
  const normalized = normalizeFrequency(frequency);
  return normalized === 'daily' || normalized === 'weekly';
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plistEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function windowsTaskXml({ exePath, frequency, time }) {
  const weekly = normalizeFrequency(frequency) === 'weekly';
  const when = normalizeTime(time);
  const schedule = weekly
    ? `<ScheduleByWeek>
        <DaysOfWeek>
          <Sunday />
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>`
    : `<ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Printventory database backup</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-04T${when}:00</StartBoundary>
      <Enabled>true</Enabled>
      ${schedule}
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(exePath)}</Command>
      <Arguments>--scheduled-backup</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

function launchAgentPlist({ exePath, frequency, time }) {
  const weekly = normalizeFrequency(frequency) === 'weekly';
  const when = normalizeTime(time);
  const hour = parseInt(when.slice(0, 2), 10);
  const minute = parseInt(when.slice(3, 5), 10);
  const weekday = weekly
    ? `    <key>Weekday</key>
    <integer>0</integer>
`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${plistEscape(exePath)}</string>
    <string>--scheduled-backup</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
${weekday}    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
</dict>
</plist>
`;
}

function systemdExecPath(exePath) {
  const escaped = String(exePath).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function systemdService({ exePath }) {
  return `[Unit]
Description=Printventory database backup

[Service]
Type=oneshot
ExecStart=${systemdExecPath(exePath)} --scheduled-backup
`;
}

function systemdTimer({ frequency, time }) {
  const when = normalizeTime(time);
  const calendar = normalizeFrequency(frequency) === 'weekly'
    ? `Sun *-*-* ${when}:00`
    : `*-*-* ${when}:00`;
  return `[Unit]
Description=Printventory database backup schedule

[Timer]
OnCalendar=${calendar}
Persistent=true

[Install]
WantedBy=timers.target
`;
}

module.exports = {
  FREQUENCIES,
  DEFAULT_TIME,
  DEFAULT_KEEP,
  MIN_KEEP,
  MAX_KEEP,
  DAY_MS,
  WEEK_MS,
  WINDOWS_TASK_NAME,
  LAUNCH_AGENT_LABEL,
  SYSTEMD_UNIT_NAME,
  SETTING_KEYS,
  normalizeFrequency,
  normalizeTime,
  normalizeKeep,
  isBackupDue,
  backupFileName,
  filesToPrune,
  shouldRegisterOsTask,
  windowsTaskXml,
  launchAgentPlist,
  systemdService,
  systemdTimer
};
