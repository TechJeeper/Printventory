'use strict';

/**
 * Pull the embedded scene thumbnail out of DragonFruit .voxl files.
 *
 * extensions["ora.preview"] = { kind, mimeType, encoding, dataBase64 }
 *
 * V2 binary ("VOXL" magic): header + chunk directory; thumbnail in EXTD index 0.
 * V1 (JSON "{"): plain or compressed envelope with root extensions.
 */

const zlib = require('zlib');

const HEADER_SIZE = 16;
const DIR_ENTRY_SIZE = 20;
const PREVIEW_KEY = 'ora.preview';
const td = new TextDecoder('utf-8');

function toSource(input) {
  if (input instanceof Uint8Array) {
    return { size: input.length, read: async (o, n) => input.subarray(o, Math.min(input.length, o + n)) };
  }
  if (input instanceof ArrayBuffer) return toSource(new Uint8Array(input));
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return toSource(new Uint8Array(input));
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return { size: input.size, read: async (o, n) => new Uint8Array(await input.slice(o, o + n).arrayBuffer()) };
  }
  if (input && typeof input.read === 'function' && Number.isFinite(input.size)) return input;
  throw new TypeError('expected Uint8Array, ArrayBuffer, Blob, or { size, read(offset, length) }');
}

async function readExact(src, offset, length, what) {
  if (offset + length > src.size) throw new Error(`${what} runs past end of file`);
  const b = await src.read(offset, length);
  if (b.length !== length) throw new Error(`short read for ${what}`);
  return b;
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function inflateZlib(bytes) {
  return new Uint8Array(zlib.inflateSync(bytes));
}

function base64ToBytes(b64) {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

function previewFromExtensions(ext) {
  const p = ext && typeof ext === 'object' ? ext[PREVIEW_KEY] : null;
  if (!p || typeof p.dataBase64 !== 'string' || !p.dataBase64) return null;
  return {
    mimeType: typeof p.mimeType === 'string' ? p.mimeType : 'image/png',
    bytes: base64ToBytes(p.dataBase64)
  };
}

async function extractV2(src) {
  const header = await readExact(src, 0, HEADER_SIZE, 'header');
  const version = u16(header, 4);
  if (version < 2) throw new Error(`unsupported VOXL binary version ${version}`);
  const count = u32(header, 8);
  const dir = await readExact(src, HEADER_SIZE, count * DIR_ENTRY_SIZE, 'chunk directory');

  for (let i = 0; i < count; i++) {
    const b = i * DIR_ENTRY_SIZE;
    const type = String.fromCharCode(dir[b], dir[b + 1], dir[b + 2], dir[b + 3]);
    if (type !== 'EXTD' || u16(dir, b + 4) !== 0) continue;

    const compression = u16(dir, b + 6);
    const offset = u32(dir, b + 8);
    const compSize = u32(dir, b + 12);
    const rawSize = u32(dir, b + 16);
    let data = await readExact(src, offset, compSize, 'EXTD chunk');
    if (compression === 1) data = inflateZlib(data);
    else if (compression !== 0) throw new Error(`unknown compression code ${compression}`);
    if (rawSize && data.length !== rawSize) throw new Error(`EXTD size mismatch (${data.length} != ${rawSize})`);
    return previewFromExtensions(JSON.parse(td.decode(data)));
  }
  return null;
}

function decodeRleU8(encoded, expected) {
  if (encoded.length % 2) throw new Error('bad RLE payload');
  const out = new Uint8Array(expected);
  let o = 0;
  for (let i = 0; i < encoded.length; i += 2) {
    const n = encoded[i];
    if (!n || o + n > expected) throw new Error('bad RLE run');
    out.fill(encoded[i + 1], o, o + n);
    o += n;
  }
  if (o !== expected) throw new Error('RLE size mismatch');
  return out;
}

async function extractV1(src) {
  const root = JSON.parse(td.decode(await readExact(src, 0, src.size, 'document')));
  const c = root?.compression;
  if (root?.magic === 'VOXL' && c && typeof c === 'object' && typeof c.payloadBase64 === 'string') {
    if (c.kind !== 'document-json-utf8') throw new Error(`unsupported compression kind ${c.kind}`);
    let inner = base64ToBytes(c.payloadBase64);
    if (c.encoding === 'base64-zlib') inner = inflateZlib(inner);
    else if (c.encoding === 'base64-rle-u8') inner = decodeRleU8(inner, c.uncompressedSizeBytes);
    else if (c.encoding !== 'base64-raw') throw new Error(`unsupported encoding ${c.encoding}`);
    return previewFromExtensions(JSON.parse(td.decode(inner))?.extensions);
  }
  return previewFromExtensions(root?.extensions);
}

async function extractVoxlPreviewEntry(input) {
  const src = toSource(input);
  const head = await src.read(0, Math.min(src.size, 64));
  if (head.length >= 4 && head[0] === 0x56 && head[1] === 0x4f && head[2] === 0x58 && head[3] === 0x4c) {
    return extractV2(src);
  }
  const firstNonSpace = head.find(
    (b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0xef && b !== 0xbb && b !== 0xbf
  );
  if (firstNonSpace === 0x7b) return extractV1(src);
  throw new Error('not a VOXL file');
}

async function extractVoxlPreview(input) {
  return (await extractVoxlPreviewEntry(input))?.bytes ?? null;
}

module.exports = {
  extractVoxlPreviewEntry,
  extractVoxlPreview
};
