'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeChituboxPreview,
  chituboxPreviewPng,
  extractChituboxPreviewEntry,
  readChituboxPreviewHeader
} = require('./extract-chitubox-preview');

function writeU32(buf, off, value) {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >> 8) & 0xff;
  buf[off + 2] = (value >> 16) & 0xff;
  buf[off + 3] = (value >> 24) & 0xff;
}

/** Build a tiny 2x1 solid red preview (RGB565-ish 15-bit without run flag). */
function buildChitubox({ width = 2, height = 1, includePreview = true } = {}) {
  const headerOff = 32;
  const dataOff = 64;
  // Solid red: R=31 G=0 B=0 => (31<<11)=0xF800
  const pixel = Buffer.alloc(4);
  pixel.writeUInt16LE(0xf800, 0);
  pixel.writeUInt16LE(0xf800, 2);
  const file = Buffer.alloc(dataOff + pixel.length);
  writeU32(file, 0, 0xab231243);
  writeU32(file, 4, 0);
  writeU32(file, 8, 0);
  writeU32(file, 12, includePreview ? headerOff : 0);
  if (includePreview) {
    writeU32(file, headerOff, width);
    writeU32(file, headerOff + 4, height);
    writeU32(file, headerOff + 8, dataOff);
    writeU32(file, headerOff + 12, pixel.length);
    pixel.copy(file, dataOff);
  }
  return new Uint8Array(file);
}

describe('extract-chitubox-preview', () => {
  test('reads preview header', () => {
    const data = buildChitubox();
    const h = readChituboxPreviewHeader(data);
    assert.deepEqual(h, { width: 2, height: 1, offset: 64, size: 4 });
  });

  test('decodes RGB preview pixels', () => {
    const img = decodeChituboxPreview(buildChitubox());
    assert.ok(img);
    assert.equal(img.width, 2);
    assert.equal(img.height, 1);
    assert.equal(img.rgba[0], 255);
    assert.equal(img.rgba[1], 0);
    assert.equal(img.rgba[2], 0);
    assert.equal(img.rgba[3], 255);
  });

  test('encodes a valid PNG', () => {
    const png = chituboxPreviewPng(buildChitubox());
    assert.ok(png);
    assert.equal(Buffer.from(png.slice(0, 8)).toString('hex'), '89504e470d0a1a0a');
    const entry = extractChituboxPreviewEntry(buildChitubox());
    assert.equal(entry.name, 'preview.png');
  });

  test('returns null when preview pointer is missing', () => {
    assert.equal(decodeChituboxPreview(buildChitubox({ includePreview: false })), null);
  });

  test('rejects bad magic', () => {
    assert.throws(() => decodeChituboxPreview(new Uint8Array(32)), /Not a \.chitubox/);
  });
});
