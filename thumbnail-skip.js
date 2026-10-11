'use strict';

/** Sentinels returned by the bulk thumbnail job. Not stored in the database. */
const THUMB_SKIP_SIZE = 'skip:size';
const THUMB_SKIP_MESH = 'skip:mesh';
const THUMB_SKIP_TIMEOUT = 'skip:timeout';

const THUMB_ERR_TOO_LARGE = 'err:too_large';
const THUMB_ERR_TIMEOUT = 'err:timeout';
const THUMB_ERR_NO_PREVIEW = 'err:no_preview';

function isThumbSkipToken(value) {
  return value === THUMB_SKIP_SIZE || value === THUMB_SKIP_MESH || value === THUMB_SKIP_TIMEOUT;
}

function thumbSkipErrorTag(token) {
  if (token === THUMB_SKIP_SIZE) return THUMB_ERR_TOO_LARGE;
  if (token === THUMB_SKIP_TIMEOUT) return THUMB_ERR_TIMEOUT;
  if (token === THUMB_SKIP_MESH) return THUMB_ERR_NO_PREVIEW;
  return '';
}

function thumbnailErrorTags() {
  return [THUMB_ERR_TOO_LARGE, THUMB_ERR_TIMEOUT, THUMB_ERR_NO_PREVIEW];
}

function thumbnailErrorTagSentence(tags) {
  const names = [];
  const seen = new Set();
  for (const tag of tags || []) {
    const name = String(tag || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  names.sort();
  if (!names.length) return '';
  if (names.length === 1) return `Skipped files were tagged ${names[0]}.`;
  if (names.length === 2) return `Skipped files were tagged ${names[0]} and ${names[1]}.`;
  return `Skipped files were tagged ${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}.`;
}

/**
 * Failures that will not succeed on another pass with the same file and size limit.
 * Timeouts are handled separately so a slow STEP file is not parsed twice in one job.
 */
function isPermanentThumbnailSkipError(error) {
  const msg = String((error && error.message) || error || '');
  return /STL header does not match the file size/i.test(msg)
    || /STL file too small/i.test(msg)
    || /no drawable mesh/i.test(msg);
}

function describeThumbnailFailure(error, noted, detail) {
  const raw = String(detail || (error && error.message) || error || '').replace(/\s+/g, ' ').trim();
  if (/load aborted/i.test(raw)) return 'Stopped';
  if (noted === 'timeout' || /timed out/i.test(raw)) {
    return /timed out/i.test(raw) ? raw : 'Timed out';
  }
  if (/STL header does not match the file size/i.test(raw)) return 'STL header does not match the file size';
  if (/failed to fetch/i.test(raw)) return 'Could not read the file';
  if (/no drawable mesh/i.test(raw)) return 'No drawable mesh';
  if (/no embedded preview/i.test(raw)) return 'No embedded preview image';
  if (raw && raw !== 'mesh' && raw !== 'timeout' && raw !== 'error') {
    return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
  }
  if (noted === 'mesh') return 'Not a valid mesh';
  return 'Could not render a thumbnail';
}

function groupForceFailures(failures) {
  const groups = new Map();
  for (const item of failures || []) {
    const filePath = item && item.filePath;
    if (!filePath) continue;
    const reason = (item && item.reason) || 'Could not render a thumbnail';
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(filePath);
  }
  return [...groups.entries()]
    .map(([reason, filePaths]) => ({ reason, filePaths }))
    .sort((a, b) => b.filePaths.length - a.filePaths.length || a.reason.localeCompare(b.reason));
}

function withThumbnailErrorTagNote(message, result) {
  const skipped = Number(result && result.skipped) || 0;
  if (!message || skipped <= 0) return message;
  const note = thumbnailErrorTagSentence(result && result.errorTags);
  if (!note) return message;
  return `${message} ${note}`;
}

function thumbnailJobFinishedMessage(result, fallback) {
  const saved = Number(result && result.saved);
  const total = Number(result && (result.total != null ? result.total : result.count));
  const skipped = Number(result && result.skipped) || 0;
  const savedN = Number.isFinite(saved) ? saved : 0;
  const totalN = Number.isFinite(total) ? total : 0;
  let message = fallback;

  if (result && result.cancelled) {
    if (savedN > 0 && skipped > 0) {
      message = `Stopped. Saved ${savedN} and marked ${skipped} as skipped. The rest can be tried again.`;
    } else if (savedN > 0) {
      message = `Stopped. Saved ${savedN} thumbnail${savedN === 1 ? '' : 's'}. The rest can be tried again.`;
    } else if (skipped > 0) {
      message = `Stopped. Marked ${skipped} as skipped. The rest can be tried again.`;
    } else {
      message = 'Thumbnail generation stopped.';
    }
    return withThumbnailErrorTagNote(message, result);
  }

  if (!Number.isFinite(saved) || !Number.isFinite(total) || totalN <= 0) return fallback;
  if (savedN >= totalN) return fallback;

  if (savedN <= 0 && skipped > 0) {
    const still = Math.max(0, totalN - skipped);
    const marked = `Marked ${skipped} of ${totalN} as skipped (over the size limit, not a valid mesh, or timed out).`;
    message = still === 0
      ? `${marked} Generate Missing Thumbnails will skip them. Use Regenerate Thumbnails to try again.`
      : `${marked} ${still} can be tried again.`;
  } else if (savedN <= 0) {
    message = 'No thumbnails were saved. The ones still missing can be tried again.';
  } else if (skipped > 0) {
    const still = Math.max(0, totalN - savedN - skipped);
    const marked = `Marked ${skipped} as skipped (over the size limit, not a valid mesh, or timed out).`;
    if (still === 0) {
      message = `Saved ${savedN} of ${totalN} thumbnails. ${marked} Nothing is still missing.`;
    } else {
      const noun = still === 1 ? 'is' : 'are';
      message = `Saved ${savedN} of ${totalN} thumbnails. ${marked} ${still} ${noun} still missing and can be tried again.`;
    }
  } else {
    const remaining = Math.max(0, totalN - savedN);
    message = `Saved ${savedN} of ${totalN} thumbnails. ${remaining} ${remaining === 1 ? 'is' : 'are'} still missing.`;
  }
  return withThumbnailErrorTagNote(message, result);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    THUMB_SKIP_SIZE,
    THUMB_SKIP_MESH,
    THUMB_SKIP_TIMEOUT,
    THUMB_ERR_TOO_LARGE,
    THUMB_ERR_TIMEOUT,
    THUMB_ERR_NO_PREVIEW,
    isThumbSkipToken,
    thumbSkipErrorTag,
    thumbnailErrorTags,
    thumbnailErrorTagSentence,
    isPermanentThumbnailSkipError,
    describeThumbnailFailure,
    groupForceFailures,
    thumbnailJobFinishedMessage
  };
}
