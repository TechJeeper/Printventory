'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fflate = require('fflate');
const JSZip = require('jszip');
const {
  extractZipEntryBuffer,
  extractWithFflate,
  extractWithJszip,
  findZipEntry,
  isFragileZipError
} = require('../zip-extract');

let tempDir;

function makeFake3mf(label) {
  return Buffer.from(fflate.zipSync({
    '[Content_Types].xml': fflate.strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
    ),
    '3D/3dmodel.model': fflate.strToU8(
      `<?xml version="1.0"?><model unit="millimeter">${label}</model>`
    )
  }));
}

async function writeOuterZip(filePath, files, compression) {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) {
    zip.file(name, data, { compression });
  }
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression,
    compressionOptions: compression === 'DEFLATE' ? { level: 6 } : undefined
  });
  await fs.promises.writeFile(filePath, buf);
}

before(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printventory-zip-extract-'));
});

after(async () => {
  if (tempDir) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});

describe('zip-extract nested 3mf', () => {
  test('extracts deflated 3mf entries from an outer zip', async () => {
    const left = makeFake3mf('left');
    const right = makeFake3mf('right');
    const zipPath = path.join(tempDir, 'Main+Files-deflate.zip');
    await writeOuterZip(zipPath, {
      'kraken-ams-left-no-support-boxes-1.00.3mf': left,
      'kraken-ams-right-1.00.3mf': right
    }, 'DEFLATE');

    const extractedLeft = await extractZipEntryBuffer(
      zipPath,
      'kraken-ams-left-no-support-boxes-1.00.3mf'
    );
    const extractedRight = await extractZipEntryBuffer(zipPath, 'kraken-ams-right-1.00.3mf');

    assert.deepEqual(extractedLeft, left);
    assert.deepEqual(extractedRight, right);
  });

  test('extracts stored (uncompressed) 3mf entries from an outer zip', async () => {
    const left = makeFake3mf('stored-left');
    const zipPath = path.join(tempDir, 'Main+Files-store.zip');
    await writeOuterZip(zipPath, {
      'nested/kraken-ams-left-no-support-boxes-1.00.3mf': left
    }, 'STORE');

    const extracted = await extractZipEntryBuffer(
      zipPath,
      'nested/kraken-ams-left-no-support-boxes-1.00.3mf'
    );
    assert.deepEqual(extracted, left);
  });

  test('hashes two nested 3mf files from the same zip in parallel', async () => {
    const left = makeFake3mf('hash-left');
    const right = makeFake3mf('hash-right');
    const zipPath = path.join(tempDir, 'Kraken AMS.zip');
    await writeOuterZip(zipPath, {
      'kraken-ams-left-no-support-boxes-1.00.3mf': left,
      'kraken-ams-right-1.00.3mf': right
    }, 'DEFLATE');

    const [leftHash, rightHash, leftHashAgain] = await Promise.all([
      extractZipEntryBuffer(zipPath, 'kraken-ams-left-no-support-boxes-1.00.3mf')
        .then((buf) => crypto.createHash('md5').update(buf).digest('hex')),
      extractZipEntryBuffer(zipPath, 'kraken-ams-right-1.00.3mf')
        .then((buf) => crypto.createHash('md5').update(buf).digest('hex')),
      extractZipEntryBuffer(zipPath, 'kraken-ams-left-no-support-boxes-1.00.3mf')
        .then((buf) => crypto.createHash('md5').update(buf).digest('hex'))
    ]);

    assert.equal(leftHash, crypto.createHash('md5').update(left).digest('hex'));
    assert.equal(rightHash, crypto.createHash('md5').update(right).digest('hex'));
    assert.equal(leftHashAgain, leftHash);
    assert.notEqual(leftHash, rightHash);
  });

  test('fflate and JSZip fallbacks return the same bytes as stream-zip', async () => {
    const payload = makeFake3mf('fallback');
    const zipPath = path.join(tempDir, 'fallback.zip');
    await writeOuterZip(zipPath, { 'model.3mf': payload }, 'DEFLATE');

    const fromStreamZip = await extractZipEntryBuffer(zipPath, 'model.3mf');
    const fromFflate = await extractWithFflate(zipPath, 'model.3mf');
    const fromJszip = await extractWithJszip(zipPath, 'model.3mf');

    assert.deepEqual(fromFflate, fromStreamZip);
    assert.deepEqual(fromJszip, fromStreamZip);
    assert.deepEqual(fromStreamZip, payload);
  });

  test('findZipEntry matches slash variants', () => {
    const entries = {
      'dir\\model.3mf': { name: 'dir\\model.3mf', isDirectory: false }
    };
    const found = findZipEntry(entries, 'dir/model.3mf');
    assert.ok(found);
    assert.equal(found.name, 'dir\\model.3mf');
  });

  test('isFragileZipError detects local header and zlib failures', () => {
    assert.equal(isFragileZipError(new Error('Invalid local header')), true);
    const eof = new Error('unexpected end of file');
    eof.code = 'Z_BUF_ERROR';
    assert.equal(isFragileZipError(eof), true);
    assert.equal(isFragileZipError(new Error('Zip entry not found: x')), false);
  });

  test('recovers when local headers are shifted relative to the central directory', async () => {
    const payload = makeFake3mf('shifted');
    const zipPath = path.join(tempDir, 'shifted-local-header.zip');
    await writeOuterZip(zipPath, { 'model.3mf': payload }, 'DEFLATE');

    const original = await fs.promises.readFile(zipPath);
    const shifted = Buffer.concat([Buffer.from('XXXX'), original]);
    const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const eocdAt = shifted.lastIndexOf(eocdSig);
    assert.ok(eocdAt >= 0, 'EOCD signature should exist');
    shifted.writeUInt32LE(shifted.readUInt32LE(eocdAt + 16) + 4, eocdAt + 16);
    await fs.promises.writeFile(zipPath, shifted);

    const StreamZip = require('node-stream-zip');
    const zip = new StreamZip.async({ file: zipPath });
    await assert.rejects(
      async () => zip.entryData('model.3mf'),
      /Invalid local header/i
    );
    await zip.close();

    const recovered = await extractZipEntryBuffer(zipPath, 'model.3mf');
    assert.deepEqual(recovered, payload);
  });
});
