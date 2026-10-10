'use strict';

/** Sentinels returned by the bulk thumbnail job. Not stored in the database. */
const THUMB_SKIP_SIZE = 'skip:size';
const THUMB_SKIP_MESH = 'skip:mesh';
const THUMB_SKIP_TIMEOUT = 'skip:timeout';

function isThumbSkipToken(value) {
  return value === THUMB_SKIP_SIZE || value === THUMB_SKIP_MESH || value === THUMB_SKIP_TIMEOUT;
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

function thumbnailJobFinishedMessage(result, fallback) {
  const saved = Number(result && result.saved);
  const total = Number(result && (result.total != null ? result.total : result.count));
  const skipped = Number(result && result.skipped) || 0;
  const savedN = Number.isFinite(saved) ? saved : 0;
  const totalN = Number.isFinite(total) ? total : 0;

  if (result && result.cancelled) {
    if (savedN > 0 && skipped > 0) {
      return `Stopped. Saved ${savedN} and marked ${skipped} as skipped. The rest can be tried again.`;
    }
    if (savedN > 0) return `Stopped. Saved ${savedN} thumbnail${savedN === 1 ? '' : 's'}. The rest can be tried again.`;
    if (skipped > 0) return `Stopped. Marked ${skipped} as skipped. The rest can be tried again.`;
    return 'Thumbnail generation stopped.';
  }

  if (!Number.isFinite(saved) || !Number.isFinite(total) || totalN <= 0) return fallback;
  if (savedN >= totalN) return fallback;

  if (savedN <= 0 && skipped > 0) {
    const still = Math.max(0, totalN - skipped);
    const marked = `Marked ${skipped} of ${totalN} as skipped (over the size limit, not a valid mesh, or timed out).`;
    if (still === 0) {
      return `${marked} Generate Missing Thumbnails will skip them. Use Regenerate Thumbnails to try again.`;
    }
    return `${marked} ${still} can be tried again.`;
  }

  if (savedN <= 0) return 'No thumbnails were saved. The ones still missing can be tried again.';
  if (skipped > 0) {
    return `Saved ${savedN} of ${totalN} thumbnails. Marked ${skipped} as skipped. Run it again for the ones that are still missing.`;
  }
  return `Saved ${savedN} of ${totalN} thumbnails. Run it again for the ones that are still missing.`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    THUMB_SKIP_SIZE,
    THUMB_SKIP_MESH,
    THUMB_SKIP_TIMEOUT,
    isThumbSkipToken,
    isPermanentThumbnailSkipError,
    thumbnailJobFinishedMessage
  };
}
