/**
 * Resize and compress stored thumbnail data URLs for grid display.
 * Uses Electron nativeImage (main process only).
 */
const { nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Max longest edge in px (≈2× the 276px detailed grid cell). */
const THUMBNAIL_MAX_DIMENSION = 512;

/** JPEG quality 0–100 for opaque images. */
const THUMBNAIL_JPEG_QUALITY = 82;

/** Stored data URLs larger than this are candidates for background migration (cheap SQL prefilter). */
const THUMBNAIL_MAX_STORED_CHARS = 150000;

/**
 * Hard limit before loading a thumbnail string into V8/SQLite bridge.
 * This is a crash-prevention guard, not a quality threshold — use THUMBNAIL_MAX_DIMENSION for that.
 */
const THUMBNAIL_ABSOLUTE_MAX_LOAD_CHARS = 8_000_000;

const decodeFailureCache = new Set();

function isCompressibleDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image') && value.length > 0;
}

function parseThumbnailParts(thumbnailString) {
  if (!thumbnailString || thumbnailString === '3d.png') return [];
  if (!thumbnailString.includes('::')) {
    return [thumbnailString].filter(Boolean);
  }
  return thumbnailString.split('::').filter(Boolean);
}

function joinThumbnailParts(parts) {
  if (!parts || parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.join('::');
}

function decodeBase64Payload(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return null;
  const payload = dataUrl.slice(commaIndex + 1).replace(/\s/g, '');
  if (!payload) return null;
  try {
    return Buffer.from(payload, 'base64');
  } catch {
    return null;
  }
}

function extensionForImageBuffer(buffer) {
  if (!buffer || buffer.length < 4) return 'png';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return 'png';
}

function getImageFromBuffer(buffer) {
  if (!buffer || buffer.length === 0) return null;

  try {
    const fromBuffer = nativeImage.createFromBuffer(buffer);
    if (fromBuffer && !fromBuffer.isEmpty()) return fromBuffer;
  } catch {
    // fall through
  }

  let tempPath = null;
  try {
    const ext = extensionForImageBuffer(buffer);
    tempPath = path.join(os.tmpdir(), `pv-thumb-${process.pid}-${Date.now()}.${ext}`);
    fs.writeFileSync(tempPath, buffer);
    const fromPath = nativeImage.createFromPath(tempPath);
    if (fromPath && !fromPath.isEmpty()) return fromPath;
  } catch {
    // fall through
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }

  return null;
}

function getImageFromDataUrl(dataUrl) {
  if (!isCompressibleDataUrl(dataUrl)) return null;

  try {
    const buffer = decodeBase64Payload(dataUrl);
    if (buffer) {
      const fromBuffer = getImageFromBuffer(buffer);
      if (fromBuffer) return fromBuffer;
    }

    const fromDataUrl = nativeImage.createFromDataURL(dataUrl);
    if (fromDataUrl && !fromDataUrl.isEmpty()) return fromDataUrl;
  } catch (error) {
    const cacheKey = `${dataUrl.length}:${dataUrl.slice(0, 48)}`;
    if (!decodeFailureCache.has(cacheKey)) {
      decodeFailureCache.add(cacheKey);
      console.warn('thumbnail-compress: could not decode image:', error.message);
    }
  }

  return null;
}

function needsCompression(dataUrl) {
  if (!isCompressibleDataUrl(dataUrl)) return false;

  const img = getImageFromDataUrl(dataUrl);
  if (!img) {
    // Can't decode — leave stored bytes as-is; compression is impossible.
    return false;
  }

  const { width, height } = img.getSize();
  if (Math.max(width, height) > THUMBNAIL_MAX_DIMENSION) return true;

  return dataUrl.length > THUMBNAIL_MAX_STORED_CHARS;
}

function encodeNativeImage(img, preferPng) {
  let usePng = preferPng;
  if (!usePng && typeof img.hasAlpha === 'function') {
    try {
      usePng = img.hasAlpha();
    } catch {
      usePng = false;
    }
  }

  if (usePng) {
    const buffer = img.toPNG();
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  const buffer = img.toJPEG(THUMBNAIL_JPEG_QUALITY);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

function compressDataUrl(dataUrl) {
  if (!isCompressibleDataUrl(dataUrl)) return dataUrl;

  const img = getImageFromDataUrl(dataUrl);
  if (!img) return dataUrl;

  const { width, height } = img.getSize();
  const maxDim = Math.max(width, height);
  const overSize = dataUrl.length > THUMBNAIL_MAX_STORED_CHARS;
  if (maxDim <= THUMBNAIL_MAX_DIMENSION && !overSize) {
    return dataUrl;
  }

  let working = img;
  if (maxDim > THUMBNAIL_MAX_DIMENSION) {
    const scale = THUMBNAIL_MAX_DIMENSION / maxDim;
    const nextWidth = Math.max(1, Math.round(width * scale));
    const nextHeight = Math.max(1, Math.round(height * scale));
    working = img.resize({ width: nextWidth, height: nextHeight, quality: 'good' });
  }

  const preferPng = dataUrl.startsWith('data:image/png');
  let compressed = encodeNativeImage(working, preferPng);

  if (
    compressed.startsWith('data:image/png') &&
    compressed.length > THUMBNAIL_MAX_STORED_CHARS
  ) {
    compressed = encodeNativeImage(working, false);
  }

  return compressed.length < dataUrl.length ? compressed : dataUrl;
}

/**
 * Compress each data URL in a thumbnail column value (single or :: joined).
 * @returns {{ value: string, changed: boolean }}
 */
function compressThumbnailBlob(thumbnailString) {
  if (!thumbnailString || thumbnailString === '3d.png') {
    return { value: thumbnailString, changed: false };
  }

  const parts = parseThumbnailParts(thumbnailString);
  if (parts.length === 0) {
    return { value: thumbnailString, changed: false };
  }

  let changed = false;
  const nextParts = parts.map((part) => {
    if (!isCompressibleDataUrl(part)) return part;
    const compressed = compressDataUrl(part);
    if (compressed !== part) changed = true;
    return compressed;
  });

  const value = joinThumbnailParts(nextParts);
  if (value !== thumbnailString) changed = true;
  return { value, changed };
}

module.exports = {
  THUMBNAIL_MAX_DIMENSION,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_STORED_CHARS,
  THUMBNAIL_ABSOLUTE_MAX_LOAD_CHARS,
  isCompressibleDataUrl,
  needsCompression,
  compressDataUrl,
  compressThumbnailBlob,
  parseThumbnailParts,
  joinThumbnailParts
};
