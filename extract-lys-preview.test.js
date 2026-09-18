'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fflate = require('fflate');
const { extractLysPreview, extractLysPreviewEntry, readLysManifest } = require('./extract-lys-preview');

// 1x1 PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function buildLys({ prefix = Buffer.alloc(0), padBytes = 16, extraFiles = {}, previewName = 'preview.png' } = {}) {
  const mangoFiles = {
    [previewName]: { offset: '0', size: String(TINY_PNG.length) },
    ...extraFiles
  };
  const manifest = Buffer.from(JSON.stringify({ mangoFiles }), 'utf8');
  const pad = Buffer.alloc(padBytes, 0);
  return Buffer.concat([prefix, manifest, pad, TINY_PNG]);
}

describe('extract-lys-preview', () => {
  test('extracts preview.png after manifest + null padding', () => {
    const data = new Uint8Array(buildLys());
    const entry = extractLysPreviewEntry(data);
    assert.ok(entry);
    assert.equal(entry.name, 'preview.png');
    assert.equal(Buffer.from(entry.bytes).equals(TINY_PNG), true);
    assert.equal(Buffer.from(extractLysPreview(data)).equals(TINY_PNG), true);
  });

  test('finds preview.png nested in a folder path', () => {
    const data = new Uint8Array(buildLys({ previewName: 'thumbs/preview.png' }));
    const entry = extractLysPreviewEntry(data);
    assert.equal(entry.name, 'thumbs/preview.png');
    assert.equal(Buffer.from(entry.bytes).equals(TINY_PNG), true);
  });

  test('falls back to another image when preview.png is missing', () => {
    const extra = { 'shot.jpg': { offset: '0', size: String(TINY_PNG.length) } };
    const manifest = Buffer.from(JSON.stringify({ mangoFiles: extra }), 'utf8');
    const data = new Uint8Array(Buffer.concat([manifest, Buffer.alloc(8, 0), TINY_PNG]));
    const entry = extractLysPreviewEntry(data);
    assert.equal(entry.name, 'shot.jpg');
  });

  test('returns null when mangoFiles has no images', () => {
    const manifest = Buffer.from(JSON.stringify({ mangoFiles: { 'scene.bin': { offset: '0', size: '4' } } }), 'utf8');
    const data = new Uint8Array(Buffer.concat([manifest, Buffer.alloc(4, 0), Buffer.from('abcd')]));
    assert.equal(extractLysPreviewEntry(data), null);
  });

  test('reads manifest with a binary prefix', () => {
    const data = new Uint8Array(buildLys({ prefix: Buffer.from([0x00, 0x01, 0x02, 0x03]) }));
    const { manifest } = readLysManifest(data);
    assert.ok(manifest.mangoFiles['preview.png']);
  });

  test('extracts preview.png from a ZIP-like .lys file', () => {
    const zipped = fflate.zipSync({
      'preview.png': TINY_PNG,
      'scene.bin': new Uint8Array([1, 2, 3, 4])
    });
    const entry = extractLysPreviewEntry(zipped);
    assert.ok(entry);
    assert.equal(entry.name, 'preview.png');
    assert.equal(Buffer.from(entry.bytes).equals(TINY_PNG), true);
  });

  test('rejects an empty ZIP-like .lys without images', () => {
    const zipLike = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    assert.throws(() => extractLysPreviewEntry(zipLike), /ZIP-like|LYS manifest|not a zip|invalid/i);
  });
});
