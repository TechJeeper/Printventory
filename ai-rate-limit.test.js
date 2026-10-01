#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { isRateLimitError, parseRetryAfterMs, rateLimitWaitMs } = require('./ai-rate-limit');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('detects 429 from status or message', () => {
  assert.strictEqual(isRateLimitError({ status: 429 }), true);
  assert.strictEqual(isRateLimitError({ response: { status: 429 } }), true);
  assert.strictEqual(isRateLimitError({ message: '429 Rate limit reached' }), true);
  assert.strictEqual(isRateLimitError({ status: 500 }), false);
});

test('honors Retry-After seconds and HTTP dates', () => {
  assert.strictEqual(parseRetryAfterMs({ headers: { 'retry-after': '12' } }), 12000);
  const now = Date.parse('2026-10-01T14:00:00Z');
  const later = new Date(now + 30000).toUTCString();
  assert.strictEqual(parseRetryAfterMs({ headers: { get: (name) => name === 'retry-after' ? later : null } }, now), 30000);
});

test('caps a long Retry-After and backs off when the header is missing', () => {
  assert.strictEqual(parseRetryAfterMs({ headers: { 'retry-after': '100000' } }), 120000);
  assert.strictEqual(rateLimitWaitMs({ status: 429 }, 1), 5000);
  assert.strictEqual(rateLimitWaitMs({ status: 429 }, 3), 20000);
  assert.strictEqual(rateLimitWaitMs({ status: 429, headers: { 'retry-after': '8' } }, 4), 8000);
});
