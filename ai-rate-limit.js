'use strict';

const MAX_RATE_LIMIT_WAIT_MS = 120000;

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const value = headers.get(name) || headers.get(name.toLowerCase());
    if (value) return value;
  }
  const lower = name.toLowerCase();
  if (headers[lower] != null) return headers[lower];
  if (headers[name] != null) return headers[name];
  return null;
}

function readRetryAfterHeader(error) {
  if (!error) return null;
  const fromError = headerValue(error.headers, 'retry-after');
  if (fromError != null && fromError !== '') return fromError;
  const fromResponse = headerValue(error.response && error.response.headers, 'retry-after');
  if (fromResponse != null && fromResponse !== '') return fromResponse;
  return null;
}

function isRateLimitError(error) {
  if (!error) return false;
  if (error.status === 429) return true;
  if (error.response && error.response.status === 429) return true;
  if (error.code === 'rate_limit_exceeded') return true;
  return !!(error.message && String(error.message).includes('429'));
}

/** Milliseconds to wait, or null when the response has no usable Retry-After. Capped at 2 minutes. */
function parseRetryAfterMs(error, now = Date.now()) {
  const raw = readRetryAfterHeader(error);
  if (raw == null || raw === '') return null;
  const seconds = Number(String(raw).trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.round(seconds * 1000));
  }
  const dateMs = Date.parse(String(raw));
  if (Number.isFinite(dateMs)) {
    return Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.max(0, dateMs - now));
  }
  return null;
}

function rateLimitWaitMs(error, attempt, now = Date.now()) {
  const fromHeader = parseRetryAfterMs(error, now);
  if (fromHeader != null) return fromHeader;
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(60000, 5000 * Math.pow(2, n - 1));
}

function rateLimitUserMessage(error, now = Date.now()) {
  const ms = parseRetryAfterMs(error, now);
  const tail = ' Tags already generated can still be applied.';
  if (ms != null && ms >= 1000 && ms < 60000) {
    const secs = Math.ceil(ms / 1000);
    return `API rate limit has been exceeded. Waited and retried, but the limit is still in effect. Try again in about ${secs} seconds.${tail}`;
  }
  if (ms != null && ms >= 60000) {
    const waitMinutes = Math.ceil(ms / 60000);
    return `API rate limit has been exceeded. Waited and retried, but the limit is still in effect. Try again in about ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}.${tail}`;
  }
  return `API rate limit has been exceeded after several retries.${tail}`;
}

module.exports = {
  MAX_RATE_LIMIT_WAIT_MS,
  isRateLimitError,
  parseRetryAfterMs,
  rateLimitWaitMs,
  rateLimitUserMessage
};
