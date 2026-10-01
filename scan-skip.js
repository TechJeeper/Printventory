'use strict';

const path = require('path');

/** Directory names always skipped while scanning a library. */
const SYSTEM_DIR_NAMES = new Set([
  'system volume information',
  '$recycle.bin',
  'windows',
  '$windows.~bt',
  '$windows.~ws',
  'config.msi',
  'programdata',
  'recovery',
  'boot',
  'efi',
  '__macosx',
  'printventory-extracts'
]);

function isDotSegment(name) {
  return typeof name === 'string' && name.length > 1 && name[0] === '.' && name !== '.' && name !== '..';
}

/**
 * Extra folder names from settings. Accepts an array or a newline/comma separated string.
 * A pasted path is reduced to its last segment so "cache" and "library/cache" both match.
 */
function normalizeExcludeNames(list) {
  const set = new Set();
  const raw = Array.isArray(list) ? list : String(list || '').split(/[\r\n,]+/);
  for (const item of raw) {
    const trimmed = String(item || '').trim().replace(/^[/\\]+|[/\\]+$/g, '');
    if (!trimmed || trimmed === '.' || trimmed === '..') continue;
    const seg = trimmed.split(/[/\\]/).filter(Boolean).pop();
    if (seg) set.add(seg.toLowerCase());
  }
  return set;
}

function shouldSkipDirectoryName(dirName, extraLower) {
  if (!dirName || dirName === '.' || dirName === '..') return false;
  if (isDotSegment(dirName)) return true;
  if (/^windows defender/i.test(dirName)) return true;
  const lower = String(dirName).toLowerCase();
  if (SYSTEM_DIR_NAMES.has(lower)) return true;
  if (extraLower && extraLower.has(lower)) return true;
  return false;
}

function shouldSkipFileName(fileName) {
  if (!fileName) return false;
  if (isDotSegment(fileName)) return true;
  if (String(fileName).startsWith('printventory_')) return true;
  return false;
}

/** True when any directory in the path, or the file name itself, should not be indexed. */
function shouldSkipEntryPath(entryPath, extraLower) {
  if (!entryPath) return false;
  const parts = String(entryPath).replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) return false;
  if (shouldSkipFileName(parts[parts.length - 1])) return true;
  for (let i = 0; i < parts.length - 1; i++) {
    if (shouldSkipDirectoryName(parts[i], extraLower)) return true;
  }
  return false;
}

function normalizeExcludePath(p) {
  let resolved = path.resolve(String(p));
  const root = path.parse(resolved).root;
  if (resolved.length > root.length) {
    resolved = resolved.replace(/[\\/]+$/, '');
  }
  if (process.platform === 'win32' || process.platform === 'darwin') {
    resolved = resolved.toLowerCase();
  }
  return resolved;
}

/** Full directory paths to skip. Relative entries are resolved against scanRoot. */
function compileExcludeDirs(excludeDirectories, scanRoot) {
  const compiled = [];
  const list = Array.isArray(excludeDirectories) ? excludeDirectories : [];
  for (const raw of list) {
    if (raw == null) continue;
    let p = String(raw).trim();
    if (!p) continue;
    if (!path.isAbsolute(p) && scanRoot) p = path.resolve(scanRoot, p);
    else p = path.resolve(p);
    compiled.push(normalizeExcludePath(p));
  }
  return compiled;
}

function isExcludedDir(dirPath, compiled) {
  if (!compiled || compiled.length === 0) return false;
  const n = normalizeExcludePath(dirPath);
  const sep = path.sep;
  for (const ex of compiled) {
    if (n === ex || n.startsWith(ex + sep)) return true;
  }
  return false;
}

function pathForExcludeMatch(filePath) {
  const s = String(filePath || '');
  const marker = s.indexOf('::');
  return marker === -1 ? s : s.slice(0, marker);
}

function isExcludedPath(fileOrDir, compiled) {
  if (!compiled || compiled.length === 0) return false;
  const target = pathForExcludeMatch(fileOrDir);
  if (!target) return false;
  return isExcludedDir(target, compiled);
}

module.exports = {
  SYSTEM_DIR_NAMES,
  isDotSegment,
  normalizeExcludeNames,
  shouldSkipDirectoryName,
  shouldSkipFileName,
  shouldSkipEntryPath,
  normalizeExcludePath,
  compileExcludeDirs,
  isExcludedDir,
  isExcludedPath
};
