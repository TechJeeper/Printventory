'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fflate = require('fflate');
const { extractF3dPreview, extractF3dPreviewEntry } = require('./extract-f3d-preview');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const OTHER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVAAAhGgIB/6Q9yQAAAABJRU5ErkJggg==',
  'base64'
);

describe('extract-f3d-preview', () => {
  test('extracts FusionAssetName[Active]/Previews/small.png', async () => {
    const zipped = fflate.zipSync({
      'FusionAssetName[Active]/Previews/small.png': TINY_PNG,
      'Animation/Previews/small.png': OTHER_PNG
    });
    const entry = await extractF3dPreviewEntry(zipped);
    assert.ok(entry);
    assert.equal(entry.name, 'FusionAssetName[Active]/Previews/small.png');
    assert.equal(Buffer.from(entry.bytes).equals(TINY_PNG), true);
    assert.equal(Buffer.from(await extractF3dPreview(zipped)).equals(TINY_PNG), true);
  });

  test('falls back to any Previews/small.png', async () => {
    const zipped = fflate.zipSync({
      'SomeAsset/Previews/small.png': TINY_PNG
    });
    const entry = await extractF3dPreviewEntry(zipped);
    assert.equal(entry.name, 'SomeAsset/Previews/small.png');
    assert.equal(Buffer.from(entry.bytes).equals(TINY_PNG), true);
  });

  test('returns null when archive has no preview', async () => {
    const zipped = fflate.zipSync({
      'FusionAssetName[Active]/Design.xml': Buffer.from('<x/>')
    });
    assert.equal(await extractF3dPreviewEntry(zipped), null);
  });
});
