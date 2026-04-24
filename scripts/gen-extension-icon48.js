'use strict';
/**
 * One-off: write chrome-extension/icon48.png (48x48 RGBA solid #2d2d2d).
 * Run: node scripts/gen-extension-icon48.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const w = 48;
const h = 48;
// PNG raw image data: filter 0 + RGBA per row
const rowSize = 1 + w * 4;
const raw = Buffer.alloc(h * rowSize);
for (let y = 0; y < h; y++) {
  const rowStart = y * rowSize;
  raw[rowStart] = 0; // None filter
  for (let x = 0; x < w; x++) {
    const i = rowStart + 1 + x * 4;
    raw[i] = 0x2d;
    raw[i + 1] = 0x2d;
    raw[i + 2] = 0x2d;
    raw[i + 3] = 0xff;
  }
}

function crc32(buf) {
  let c = 0xffffffff;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let k = n;
    for (let j = 0; j < 8; j++) {
      k = (k & 1) ? (0xedb88320 ^ (k >>> 1)) : (k >>> 1);
    }
    table[n] = k >>> 0;
  }
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function be32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  return Buffer.concat([be32(data.length), body, be32(crc32(body))]);
}

const ihdr = Buffer.concat([
  be32(w),
  be32(h),
  Buffer.from([8, 6, 0, 0, 0]) // 8-bit RGBA
]);
const idat = zlib.deflateSync(raw, { level: 9 });
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, '..', 'chrome-extension', 'icon48.png');
fs.writeFileSync(out, png);
console.log('Wrote', out, png.length, 'bytes');
