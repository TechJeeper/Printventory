/**
 * Derive folder / zip bundle identity from a model filePath.
 * Shared by main process (scan, save) and tests.
 */
const path = require('path');

function normalizePath(filepath) {
  return String(filepath || '').replace(/\\/g, '/');
}

/**
 * @param {string} filePath
 * @returns {{ bundleKey: string, bundleLabel: string, bundleKind: string }}
 */
function deriveBundleFromFilePath(filePath) {
  const empty = { bundleKey: '', bundleLabel: '', bundleKind: '' };
  if (!filePath || typeof filePath !== 'string') return empty;
  if (filePath.startsWith('url::')) return empty;

  if (filePath.includes('::')) {
    const zipPath = filePath.split('::')[0];
    const normalized = normalizePath(zipPath);
    if (!normalized) return empty;
    const label = path.basename(normalized) || normalized;
    return {
      bundleKey: `zip:${normalized.toLowerCase()}`,
      bundleLabel: label,
      bundleKind: 'zip',
    };
  }

  const dir = path.dirname(filePath);
  const normalizedDir = normalizePath(dir);
  if (!normalizedDir || normalizedDir === '.' || normalizedDir === '/') {
    return empty;
  }
  const label = path.basename(normalizedDir) || normalizedDir;
  return {
    bundleKey: `folder:${normalizedDir.toLowerCase()}`,
    bundleLabel: label,
    bundleKind: 'folder',
  };
}

module.exports = {
  deriveBundleFromFilePath,
  normalizePath,
};
