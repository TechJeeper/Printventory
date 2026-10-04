'use strict';

const fs = require('fs');
const path = require('path');

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

function basename(filePath) {
  const parts = String(filePath || '').split(/[/\\]/);
  return parts[parts.length - 1] || String(filePath || '');
}

function shortDeleteError(code, message) {
  if (code === 'EPERM' || code === 'EACCES') {
    return 'Permission denied. The file may be open in another program.';
  }
  if (code === 'EBUSY') return 'The file is in use by another program.';
  if (code === 'EISDIR' || code === 'ENOTDIR') return 'That path is a folder, not a file.';
  if (code === 'ZIP') return 'Files inside a ZIP archive cannot be deleted.';
  if (code === 'ENOENT') return 'File not found.';
  const text = String(message || '').split('\n')[0].trim();
  return text ? text.slice(0, 180) : 'Could not delete file';
}

function toWindowsLongPath(filePath) {
  if (process.platform !== 'win32') return null;
  if (!filePath || filePath.startsWith('\\\\?\\')) return null;
  let resolved;
  try {
    resolved = path.resolve(filePath);
  } catch (_) {
    return null;
  }
  if (resolved.startsWith('\\\\?\\')) return null;
  if (resolved.startsWith('\\\\')) return `\\\\?\\UNC\\${resolved.slice(2)}`;
  return `\\\\?\\${resolved}`;
}

async function attemptUnlink(fsPromises, target) {
  try {
    await fsPromises.unlink(target);
    return { ok: true, missing: false };
  } catch (err) {
    return { ok: false, err };
  }
}

/**
 * Remove one library file from disk.
 * ENOENT is success with missing:true so the caller can drop the library row.
 * Windows read-only / in-use files are retried once after clearing the read-only bit.
 */
async function unlinkLibraryFile(filePath, fsPromises = fs.promises) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, code: 'EINVAL', message: 'Missing file path' };
  }
  if (filePath.startsWith('url::')) {
    return { ok: true, missing: false, skippedDisk: true };
  }
  if (filePath.includes('::')) {
    return { ok: false, code: 'ZIP', message: shortDeleteError('ZIP') };
  }

  let target = filePath;
  try {
    target = path.normalize(filePath);
  } catch (_) {
    target = filePath;
  }

  let attempt = await attemptUnlink(fsPromises, target);
  if (!attempt.ok && attempt.err && RETRYABLE.has(attempt.err.code)) {
    try { await fsPromises.chmod(target, 0o666); } catch (_) { /* still try unlink */ }
    attempt = await attemptUnlink(fsPromises, target);
  }

  if (!attempt.ok && attempt.err && attempt.err.code === 'ENOENT' && target.length >= 240) {
    const longPath = toWindowsLongPath(target);
    if (longPath && longPath !== target) {
      attempt = await attemptUnlink(fsPromises, longPath);
    }
  }

  if (attempt.ok) return attempt;
  const err = attempt.err || {};
  if (err.code === 'ENOENT') return { ok: true, missing: true };
  return {
    ok: false,
    code: err.code || 'EIO',
    message: shortDeleteError(err.code, err.message)
  };
}

function buildDeleteSummary({ deleted = 0, alreadyMissing = 0, failed = [], total = 0 } = {}) {
  const failCount = Array.isArray(failed) ? failed.length : 0;
  const parts = [];
  if (deleted > 0) {
    parts.push(`Deleted ${deleted} file${deleted === 1 ? '' : 's'} from disk.`);
  }
  if (alreadyMissing > 0) {
    parts.push(
      `${alreadyMissing} file${alreadyMissing === 1 ? ' was' : 's were'} already missing from disk and ${alreadyMissing === 1 ? 'was' : 'were'} removed from the library.`
    );
  }
  if (!failCount) {
    return (deleted > 0 && alreadyMissing > 0) || (!deleted && alreadyMissing > 0) ? parts.join(' ') : '';
  }

  const byReason = new Map();
  for (const item of failed) {
    const why = item && item.message ? item.message : 'Could not delete file';
    byReason.set(why, (byReason.get(why) || 0) + 1);
  }
  const reasons = [...byReason.entries()].map(([why, count]) => `${count} file${count === 1 ? '' : 's'}: ${why}`);
  const names = failed.slice(0, 5).map((item) => basename(item && item.filePath));
  const more = failCount > names.length ? `\n... and ${failCount - names.length} more` : '';
  const ofTotal = total || (deleted + alreadyMissing + failCount);
  parts.push(
    `${failCount} of ${ofTotal} file${failCount === 1 ? '' : 's'} could not be deleted.\n${reasons.join('\n')}\n\n${names.join('\n')}${more}`
  );
  return parts.join('\n\n');
}

module.exports = {
  unlinkLibraryFile,
  buildDeleteSummary,
  shortDeleteError
};
