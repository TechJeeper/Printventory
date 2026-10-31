'use strict';

const path = require('path');

/**
 * Path display helpers: full / parent / filename modes plus user aliases.
 */

function normalizeSlashes(p) {
  return String(p || '').replace(/\\/g, '/');
}

function applyAliases(fullPath, aliases) {
  let result = String(fullPath || '');
  if (!result || !Array.isArray(aliases) || !aliases.length) return result;
  // Longer `from` first so nested aliases apply correctly
  const sorted = aliases
    .filter((a) => a && a.from != null && String(a.from).length)
    .map((a) => ({ from: String(a.from), to: a.to == null ? '' : String(a.to) }))
    .sort((a, b) => b.from.length - a.from.length);

  for (const alias of sorted) {
    const fromNorm = normalizeSlashes(alias.from);
    const pathNorm = normalizeSlashes(result);
    if (pathNorm === fromNorm || pathNorm.startsWith(fromNorm.endsWith('/') ? fromNorm : fromNorm + '/')) {
      const rest = pathNorm.slice(fromNorm.length).replace(/^\//, '');
      const toBase = normalizeSlashes(alias.to).replace(/\/+$/, '');
      result = rest ? (toBase ? `${toBase}/${rest}` : rest) : (toBase || alias.to);
      // Preserve original separator style loosely via forward slashes after alias
      break;
    }
    // Also try raw prefix match (Windows drive letters, mixed separators)
    if (result.startsWith(alias.from)) {
      const rest = result.slice(alias.from.length);
      result = String(alias.to) + rest;
      break;
    }
  }
  return result;
}

/**
 * @param {string} fullPath
 * @param {'full'|'parent'|'filename'} mode
 * @param {Array<{from:string,to:string}>} aliases
 */
function formatPathForDisplay(fullPath, mode, aliases) {
  const aliased = applyAliases(fullPath, aliases);
  const m = String(mode || 'full').toLowerCase();
  if (m === 'filename') {
    // Handle zip entries path::entry
    const zipSep = aliased.indexOf('::');
    const target = zipSep >= 0 ? aliased.slice(zipSep + 2) : aliased;
    return path.basename(normalizeSlashes(target)) || aliased;
  }
  if (m === 'parent') {
    const zipSep = aliased.indexOf('::');
    if (zipSep >= 0) {
      const zipPath = aliased.slice(0, zipSep);
      const entry = aliased.slice(zipSep + 2);
      const entryParent = normalizeSlashes(path.posix.dirname(normalizeSlashes(entry).replace(/^\/+/, '')));
      if (!entryParent || entryParent === '.') {
        return normalizeSlashes(path.dirname(zipPath)) || zipPath;
      }
      return `${normalizeSlashes(path.dirname(zipPath))}/${entryParent}`.replace(/\/+/g, '/');
    }
    const parent = path.dirname(aliased);
    return parent === '.' ? aliased : parent;
  }
  return aliased;
}

const SETTINGS_KEYS = Object.freeze({
  pathDisplayMode: 'pathDisplayMode',
  pathAliases: 'pathAliases'
});

function parsePathAliases(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizePathDisplayMode(mode) {
  const m = String(mode || 'full').toLowerCase();
  if (m === 'parent' || m === 'filename' || m === 'full') return m;
  return 'full';
}

module.exports = {
  formatPathForDisplay,
  applyAliases,
  SETTINGS_KEYS,
  parsePathAliases,
  normalizePathDisplayMode
};
