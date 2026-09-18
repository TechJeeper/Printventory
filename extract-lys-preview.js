'use strict';

/**
 * Pull the embedded preview image out of Lychee .lys files.
 *
 * Classic mango container:
 *   [optional binary prefix] {JSON manifest with "mangoFiles"} [null padding] [data blobs]
 * Newer files are ZIP and store preview.png as a zip entry.
 */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IMAGE_RE = /\.(png|jpe?g|webp|bmp)$/i;
const MAX_SCAN = 2_000_000; // the manifest sits near the start of the file

function isZip(data) {
  return !!(data && data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b);
}

/** Index one past the '}' that closes the object opening at `start`, or -1. */
function matchBrace(data, start, limit) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < limit; i++) {
    const c = data[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === 0x5c) esc = true;
      else if (c === 0x22) inStr = false;
      continue;
    }
    if (c === 0x22) inStr = true;
    else if (c === 0x7b) depth++;
    else if (c === 0x7d) {
      depth--;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function indexOfBytes(data, needle, from, limit) {
  outer: for (let i = from; i <= limit - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (data[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function pickImageEntry(entries) {
  return entries.find(([name]) => /(^|[\\/])preview\.png$/i.test(name))
    ?? entries.find(([name]) => IMAGE_RE.test(name));
}

function extractLysPreviewFromZip(data) {
  let unzipSync;
  try {
    unzipSync = require('fflate').unzipSync;
  } catch {
    return null;
  }
  let zip;
  try {
    zip = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
  } catch {
    return null;
  }
  const entry = pickImageEntry(Object.entries(zip).filter(([, bytes]) => bytes && bytes.length));
  if (!entry) return null;
  return { name: entry[0], bytes: entry[1] };
}

function extractEmbeddedPng(data) {
  const start = indexOfBytes(data, PNG_SIG, 0, data.length);
  if (start < 0) return null;
  let offset = start + 8;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    if (length > data.length) break;
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    offset += 12 + length;
    if (type === 'IEND') {
      return data.subarray(start, offset);
    }
  }
  return null;
}

/** Locate and parse the JSON manifest. Returns { manifest, end } or throws. */
function readLysManifest(data) {
  const limit = Math.min(data.length, MAX_SCAN);
  const marker = new TextEncoder().encode('"mangoFiles"');
  const decoder = new TextDecoder('utf-8');

  for (let m = indexOfBytes(data, marker, 0, limit); m >= 0; m = indexOfBytes(data, marker, m + 1, limit)) {
    for (let s = m; s >= Math.max(0, m - 200_000); s--) {
      if (data[s] !== 0x7b) continue;
      const end = matchBrace(data, s, limit);
      if (end < 0) continue;
      try {
        const manifest = JSON.parse(decoder.decode(data.subarray(s, end)));
        if (manifest && typeof manifest === 'object' && manifest.mangoFiles) return { manifest, end };
      } catch {
        /* keep walking back */
      }
    }
  }
  if (isZip(data)) throw new Error('ZIP-like .lys variant is not supported');
  throw new Error('LYS manifest not found');
}

function isPng(bytes) {
  return bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b);
}

function extractLysPreviewEntryMango(data) {
  const { manifest, end } = readLysManifest(data);
  const files = manifest.mangoFiles || {};
  const entry = pickImageEntry(Object.entries(files));
  if (!entry) return null;

  const [name, info] = entry;
  const offset = Number(info.offset || 0);
  const size = Number(info.size || 0);
  if (!(size > 0)) return null;

  let padded = end;
  while (padded < data.length && data[padded] === 0) padded++;
  const tail = Math.max(...Object.values(files).map((f) => Number(f.offset || 0) + Number(f.size || 0)));
  const exact = data.length - tail;
  const candidates = [...new Set([exact, padded, end])].filter((s) => s >= end && s <= padded);

  for (const start of candidates) {
    const bytes = data.subarray(start + offset, start + offset + size);
    if (bytes.length === size && (!/\.png$/i.test(name) || isPng(bytes))) return { name, bytes };
  }
  const png = extractEmbeddedPng(data);
  if (png) return { name, bytes: png };
  throw new Error(`${name} is listed in the manifest but its bytes could not be located`);
}

/**
 * Returns the embedded preview image bytes (normally PNG), or null if the file has none.
 * @param {Uint8Array} data  whole .lys file
 * @returns {{ name: string, bytes: Uint8Array } | null}
 */
function extractLysPreviewEntry(data) {
  if (isZip(data)) {
    const zipEntry = extractLysPreviewFromZip(data);
    if (zipEntry) return zipEntry;
  }
  try {
    return extractLysPreviewEntryMango(data);
  } catch (error) {
    const png = extractEmbeddedPng(data);
    if (png) return { name: 'preview.png', bytes: png };
    throw error;
  }
}

function extractLysPreview(data) {
  return extractLysPreviewEntry(data)?.bytes ?? null;
}

module.exports = {
  readLysManifest,
  extractLysPreviewEntry,
  extractLysPreview
};
