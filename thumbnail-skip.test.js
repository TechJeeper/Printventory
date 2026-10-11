#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  THUMB_SKIP_SIZE,
  THUMB_SKIP_MESH,
  THUMB_SKIP_TIMEOUT,
  isThumbSkipToken,
  thumbSkipErrorTag,
  thumbnailErrorTagSentence,
  isPermanentThumbnailSkipError,
  describeThumbnailFailure,
  groupForceFailures,
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
  assert.match(message, /355 are still missing/);
});

test('skipped files are not described as still missing', () => {
  const message = thumbnailJobFinishedMessage({
    saved: 1,
    skipped: 364,
    total: 366
  }, 'done');
  assert.match(message, /Saved 1 of 366/);
  assert.match(message, /Marked 364 as skipped/);
  assert.match(message, /1 is still missing/);
  assert.doesNotMatch(message, /ones that are still missing/);
});

test('skip reasons map to err tags', () => {
  assert.strictEqual(thumbSkipErrorTag(THUMB_SKIP_SIZE), 'err:too_large');
  assert.strictEqual(thumbSkipErrorTag(THUMB_SKIP_TIMEOUT), 'err:timeout');
  assert.strictEqual(thumbSkipErrorTag(THUMB_SKIP_MESH), 'err:no_preview');
  assert.strictEqual(thumbSkipErrorTag('3d.png'), '');
});

test('the finished message names the err tags that were applied', () => {
  const message = thumbnailJobFinishedMessage({
    saved: 1,
    skipped: 2,
    total: 3,
    errorTags: ['err:timeout', 'err:too_large']
  }, 'done');
  assert.match(message, /Skipped files were tagged err:timeout and err:too_large/);
  assert.strictEqual(
    thumbnailErrorTagSentence(['err:no_preview', 'err:timeout', 'err:too_large']),
    'Skipped files were tagged err:no_preview, err:timeout, and err:too_large.'
  );
});

test('force failures keep the parse reason and group by it', () => {
  assert.strictEqual(
    describeThumbnailFailure(new Error('STL header does not match the file size')),
    'STL header does not match the file size'
  );
  assert.strictEqual(
    describeThumbnailFailure(null, 'timeout', 'Loading model timed out after 30000ms'),
    'Loading model timed out after 30000ms'
  );
  assert.strictEqual(describeThumbnailFailure(new Error('Failed to fetch')), 'Could not read the file');
  const groups = groupForceFailures([
    { filePath: '/a.stl', reason: 'STL header does not match the file size' },
    { filePath: '/b.step', reason: 'Timed out' },
    { filePath: '/c.stl', reason: 'STL header does not match the file size' }
  ]);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].reason, 'STL header does not match the file size');
  assert.deepStrictEqual(groups[0].filePaths, ['/a.stl', '/c.stl']);
  assert.deepStrictEqual(groups[1].filePaths, ['/b.step']);
});
