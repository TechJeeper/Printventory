#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  THUMB_SKIP_SIZE,
  THUMB_SKIP_MESH,
  THUMB_SKIP_TIMEOUT,
  isThumbSkipToken,
  isPermanentThumbnailSkipError,
  thumbnailJobFinishedMessage
} = require('./thumbnail-skip');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('skip tokens are recognized', () => {
  assert.strictEqual(isThumbSkipToken(THUMB_SKIP_SIZE), true);
  assert.strictEqual(isThumbSkipToken(THUMB_SKIP_MESH), true);
  assert.strictEqual(isThumbSkipToken(THUMB_SKIP_TIMEOUT), true);
  assert.strictEqual(isThumbSkipToken('3d.png'), false);
  assert.strictEqual(isThumbSkipToken('data:image/png;base64,abc'), false);
});

test('stl header and empty mesh errors are permanent skips', () => {
  assert.strictEqual(isPermanentThumbnailSkipError(new Error('STL header does not match the file size')), true);
  assert.strictEqual(isPermanentThumbnailSkipError(new Error('STL file too small to be valid')), true);
  assert.strictEqual(isPermanentThumbnailSkipError(new Error('Model contains no drawable mesh geometry')), true);
  assert.strictEqual(isPermanentThumbnailSkipError(new Error('Loading model timed out after 30000ms')), false);
});

test('a job that only skipped files explains why the count comes back', () => {
  const message = thumbnailJobFinishedMessage({
    cancelled: false,
    saved: 0,
    skipped: 362,
    total: 365
  }, 'Thumbnail generation completed successfully.');
  assert.match(message, /Marked 362 of 365 as skipped/);
  assert.match(message, /3 can be tried again/);
});

test('marking every file as skipped tells the user how to retry', () => {
  const message = thumbnailJobFinishedMessage({
    saved: 0,
    skipped: 365,
    total: 365
  }, 'done');
  assert.match(message, /Regenerate Thumbnails/);
});

test('a stopped job keeps the thumbnails already written', () => {
  const message = thumbnailJobFinishedMessage({
    cancelled: true,
    saved: 4,
    skipped: 20,
    total: 365
  }, 'done');
  assert.match(message, /Stopped/);
  assert.match(message, /Saved 4/);
  assert.match(message, /marked 20 as skipped/);
});

test('a partial save still names the remainder', () => {
  const message = thumbnailJobFinishedMessage({
    saved: 10,
    skipped: 0,
    total: 365
  }, 'done');
  assert.match(message, /Saved 10 of 365/);
});
