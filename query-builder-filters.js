'use strict';

/**
 * Numeric/date filter helpers shared by saved searches and get-models-filtered.
 * Kept separate from query-builder.js (browser IIFE) so Node can require this safely.
 */

function sizeGt(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return null;
  return { op: 'sizeGt', value: n };
}

function dateAddedWithinDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n < 0) return null;
  return { op: 'dateAddedWithinDays', value: Math.floor(n) };
}

function printCountGt(count) {
  const n = Number(count);
  if (!Number.isFinite(n)) return null;
  return { op: 'printCountGt', value: n };
}

function lastPrintedBefore(isoOrDate) {
  if (isoOrDate == null || isoOrDate === '') return null;
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return null;
  return { op: 'lastPrintedBefore', value: date.toISOString() };
}

function ratingGte(rating) {
  const n = Number(rating);
  if (!Number.isFinite(n)) return null;
  return { op: 'ratingGte', value: n };
}

function serializeFilterState(state) {
  const obj = state && typeof state === 'object' ? state : {};
  return JSON.stringify(obj);
}

function deserializeFilterState(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Build SQL fragments for numeric/date filters on the models table.
 * Accepts either a flat filters object or filters.numericFilters array of {op,value}.
 * Returns { sqlFragments: string[], params: any[] }.
 */
function applyNumericFilters(filters) {
  const sqlFragments = [];
  const params = [];
  if (!filters || typeof filters !== 'object') {
    return { sqlFragments, params };
  }

  const ops = [];
  if (Array.isArray(filters.numericFilters)) {
    for (const item of filters.numericFilters) {
      if (!item || !item.op) continue;
      ops.push(item);
    }
  }

  if (filters.sizeGt != null && filters.sizeGt !== '') {
    const f = sizeGt(filters.sizeGt);
    if (f) ops.push(f);
  }
  if (filters.dateAddedWithinDays != null && filters.dateAddedWithinDays !== '') {
    const f = dateAddedWithinDays(filters.dateAddedWithinDays);
    if (f) ops.push(f);
  }
  if (filters.printCountGt != null && filters.printCountGt !== '') {
    const f = printCountGt(filters.printCountGt);
    if (f) ops.push(f);
  }
  if (filters.lastPrintedBefore != null && filters.lastPrintedBefore !== '') {
    const f = lastPrintedBefore(filters.lastPrintedBefore);
    if (f) ops.push(f);
  }
  if (filters.ratingGte != null && filters.ratingGte !== '') {
    const f = ratingGte(filters.ratingGte);
    if (f) ops.push(f);
  }

  for (const item of ops) {
    switch (item.op) {
      case 'sizeGt':
        sqlFragments.push('COALESCE(size, 0) > ?');
        params.push(Number(item.value));
        break;
      case 'dateAddedWithinDays': {
        const days = Math.floor(Number(item.value));
        sqlFragments.push("dateAdded IS NOT NULL AND datetime(dateAdded) >= datetime('now', ?)");
        params.push(`-${days} days`);
        break;
      }
      case 'printCountGt':
        sqlFragments.push('COALESCE(print_count, 0) > ?');
        params.push(Number(item.value));
        break;
      case 'lastPrintedBefore':
        sqlFragments.push('last_printed_at IS NOT NULL AND datetime(last_printed_at) < datetime(?)');
        params.push(String(item.value));
        break;
      case 'ratingGte':
        sqlFragments.push('COALESCE(rating, 0) >= ?');
        params.push(Number(item.value));
        break;
      default:
        break;
    }
  }

  return { sqlFragments, params };
}

module.exports = {
  sizeGt,
  dateAddedWithinDays,
  printCountGt,
  lastPrintedBefore,
  ratingGte,
  serializeFilterState,
  deserializeFilterState,
  applyNumericFilters
};
