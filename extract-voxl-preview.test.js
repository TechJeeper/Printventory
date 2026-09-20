'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { extractVoxlPreview, extractVoxlPreviewEntry } = require('./extract-voxl-preview');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function writeU16(buf, off, value) {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >> 8) & 0xff;
}

function writeU32(buf, off, value) {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >> 8) & 0xff;
  buf[off + 2] = (value >> 16) & 0xff;
  buf[off + 3] = (value >> 24) & 0xff;
}

function buildV2({ withPreview = true, compress = false } = {}) {
  const extdObj = withPreview
    ? {
        'ora.preview': {
          kind: 'scene-thumbnail',
          mimeType: 'image/png',
          encoding: 'base64',
          dataBase64: TINY_PNG.toString('base64')
        }
      }
    : { other: true };
  let extdRaw = Buffer.from(JSON.stringify(extdObj), 'utf8');
  let compression = 0;
  let extdStored = extdRaw;
  if (compress) {
    extdStored = zlib.deflateSync(extdRaw);
    compression = 1;
  }
  const headerSize = 16;
  const dirSize = 20;
  const offset = headerSize + dirSize;
  const file = Buffer.alloc(offset + extdStored.length);
  file.write('VOXL', 0);
  writeU16(file, 4, 2);
  writeU16(file, 6, 0);
  writeU32(file, 8, 1);
  writeU32(file, 12, 0);
  file.write('EXTD', 16);
  writeU16(file, 20, 0);
  writeU16(file, 22, compression);
  writeU32(file, 24, offset);
  writeU32(file, 28, extdStored.length);
  writeU32(file, 32, extdRaw.length);
  extdStored.copy(file, offset);
  return new Uint8Array(file);
}

describe('extract-voxl-preview', () => {
  test('extracts PNG from V2 EXTD chunk', async () => {
    const entry = await extractVoxlPreviewEntry(buildV2());
    assert.ok(entry);
    assert.equal(entry.mimeType, 'image/png');
    assert.equal(Buffer.from(entry.bytes).equals(TINY_PNG), true);
    assert.equal(Buffer.from(await extractVoxlPreview(buildV2())).equals(TINY_PNG), true);
  });

  test('extracts PNG from zlib-compressed EXTD', async () => {
    const entry = await extractVoxlPreviewEntry(buildV2({ compress: true }));
    assert.ok(entry);
    assert.equal(Buffer.from(entry.bytes).equals(TINY_PNG), true);
  });

  test('returns null when EXTD has no ora.preview', async () => {
    assert.equal(await extractVoxlPreviewEntry(buildV2({ withPreview: false })), null);
  });

  test('extracts PNG from V1 JSON document', async () => {
    const doc = {
      extensions: {
        'ora.preview': {
          mimeType: 'image/png',
          dataBase64: TINY_PNG.toString('base64')
        }
      }
    };
    const entry = await extractVoxlPreviewEntry(Buffer.from(JSON.stringify(doc), 'utf8'));
    assert.ok(entry);
    assert.equal(Buffer.from(entry.bytes).equals(TINY_PNG), true);
  });
});
