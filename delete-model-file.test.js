#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { unlinkLibraryFile, buildDeleteSummary } = require('./delete-model-file');

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-delete-'));

(async () => {
  await test('deletes a real file', async () => {
    const file = path.join(dir, 'keep-gone.stl');
    fs.writeFileSync(file, 'stl');
    const result = await unlinkLibraryFile(file);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.missing, false);
    assert.strictEqual(fs.existsSync(file), false);
  });

  await test('treats a missing file as already removed', async () => {
    const result = await unlinkLibraryFile(path.join(dir, 'not-here.stl'));
    assert.deepStrictEqual(result, { ok: true, missing: true });
  });

  await test('retries a read-only file', async () => {
    const file = path.join(dir, 'readonly.stl');
    fs.writeFileSync(file, 'stl');
    fs.chmodSync(file, 0o444);
    const result = await unlinkLibraryFile(file);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.existsSync(file), false);
  });

  await test('refuses zip entries', async () => {
    const result = await unlinkLibraryFile('C:\\models\\pack.zip::part.stl');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'ZIP');
  });

  await test('refuses a directory the OS will not unlink', async () => {
    const blocked = path.join(dir, 'blocked.stl');
    fs.mkdirSync(blocked);
    const result = await unlinkLibraryFile(blocked);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(fs.existsSync(blocked), true);
  });

  await test('skips url-only models', async () => {
    const result = await unlinkLibraryFile('url::https://example.com/model');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skippedDisk, true);
  });

  await test('summarizes a mixed delete without listing every file', async () => {
    const summary = buildDeleteSummary({
      deleted: 2,
      alreadyMissing: 1300,
      failed: [
        { filePath: 'C:\\a\\one.stl', message: 'The file is in use by another program.' },
        { filePath: 'C:\\a\\two.stl', message: 'The file is in use by another program.' }
      ],
      total: 1304
    });
    assert.match(summary, /Deleted 2 files/);
    assert.match(summary, /1300 files were already missing/);
    assert.match(summary, /2 of 1304 files could not be deleted/);
    assert.match(summary, /2 files: The file is in use/);
    assert.doesNotMatch(summary, /Failed to delete file: C:\\a\\one\.stl[\s\S]*Failed to delete file: C:\\a\\two\.stl/);
  });

  await test('omits a dialog summary when every file was deleted', () => {
    assert.strictEqual(buildDeleteSummary({ deleted: 4, alreadyMissing: 0, failed: [], total: 4 }), '');
  });

  fs.rmSync(dir, { recursive: true, force: true });
})();
