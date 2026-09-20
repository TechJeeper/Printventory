'use strict';

/**
 * Pull the embedded preview image out of .chitubox project files.
 *
 * Layout:
 *   0x00  u32  magic 0xAB231243
 *   0x04  u32  model instance count
 *   0x08  u32  pointer to the first instance record
 *   0x0C  u32  pointer to the preview header
 *
 * Preview header (little-endian u32s):
 *   +0 width  +4 height  +8 data offset  +12 data size
 *
 * Preview data: RLE-compressed 15-bit colour (ChiTuBox .ctb style).
 * Each u16 is RRRRR GGGGG F BBBBB (F = run flag, bit 5). When F is set, the
 * next u16 carries (run length - 1) in its low 12 bits.
 */

const zlib = require('zlib');

const MAGIC = 0xab231243;
const MAX_DIM = 4096;

function u32(data, off) {
  return (data[off] | (data[off + 1] << 8) | (data[off + 2] << 16) | (data[off + 3] << 24)) >>> 0;
}

function readChituboxPreviewHeader(data) {
  if (data.length < 16 || u32(data, 0) !== MAGIC) throw new Error('Not a .chitubox file (bad magic)');
  const hdr = u32(data, 12);
  if (hdr === 0 || hdr + 16 > data.length) return null;
  const width = u32(data, hdr);
  const height = u32(data, hdr + 4);
  const offset = u32(data, hdr + 8);
  const size = u32(data, hdr + 12);
  if (!width || !height || width > MAX_DIM || height > MAX_DIM) return null;
  if (!size || offset + size > data.length) return null;
  return { width, height, offset, size };
}

function decodeChituboxPreview(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const h = readChituboxPreviewHeader(bytes);
  if (!h) return null;
  const { width, height, offset, size } = h;
  const total = width * height;
  const rgba = new Uint8ClampedArray(total * 4);
  const end = offset + size;
  let px = 0;

  for (let i = offset; i + 1 < end && px < total; ) {
    const dot = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
    let run = 1;
    if (dot & 0x0020) {
      if (i + 1 >= end) break;
      run += (bytes[i] | (bytes[i + 1] << 8)) & 0x0fff;
      i += 2;
    }
    const r5 = (dot >> 11) & 0x1f;
    const g5 = (dot >> 6) & 0x1f;
    const b5 = dot & 0x1f;
    const r = (r5 << 3) | (r5 >> 2);
    const g = (g5 << 3) | (g5 >> 2);
    const b = (b5 << 3) | (b5 >> 2);
    const stop = Math.min(total, px + run);
    for (; px < stop; px++) {
      const o = px * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
  if (px < total) throw new Error(`preview data ended early (${px}/${total} pixels)`);
  return { width, height, rgba };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw);

  const chunks = [];
  const chunk = (type, body) => {
    const buf = new Uint8Array(12 + body.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i);
    buf.set(body, 8);
    dv.setUint32(8 + body.length, crc32(buf, 4, 8 + body.length));
    chunks.push(buf);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  chunk('IHDR', ihdr);
  chunk('IDAT', idat);
  chunk('IEND', new Uint8Array(0));

  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const out = new Uint8Array(8 + chunks.reduce((s, c) => s + c.length, 0));
  out.set(sig, 0);
  let o = 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function chituboxPreviewPng(data) {
  const img = decodeChituboxPreview(data);
  return img ? encodePng(img.width, img.height, img.rgba) : null;
}

function extractChituboxPreviewEntry(data) {
  const png = chituboxPreviewPng(data);
  if (!png) return null;
  return { name: 'preview.png', bytes: png };
}

module.exports = {
  readChituboxPreviewHeader,
  decodeChituboxPreview,
  encodePng,
  chituboxPreviewPng,
  extractChituboxPreviewEntry
};
