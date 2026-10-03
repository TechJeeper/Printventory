'use strict';

/** Path of the file on disk. ZIP entries use archivePath::innerPath. */
function normalizeDedupPath(filePath) {
  if (!filePath) return '';
  let normalized = String(filePath);
  const zipSep = normalized.indexOf('::');
  if (zipSep !== -1) normalized = normalized.slice(0, zipSep);
  try {
    normalized = decodeURIComponent(normalized);
  } catch (e) {
    // Keep the original string when it is not valid encoding.
  }
  normalized = normalized.replace(/\\/g, '/').trim().replace(/\/+$/, '');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  return normalized;
}

function dedupPathsAreCaseInsensitive(fileNorm, dirNorm) {
  return /^[A-Za-z]:\//.test(fileNorm)
    || /^[A-Za-z]:\//.test(dirNorm)
    || fileNorm.startsWith('//')
    || dirNorm.startsWith('//');
}

/** True when filePath is the directory or any nested file under it. */
function fileIsUnderPreferredDirectory(filePath, preferredDir) {
  const dirNorm = normalizeDedupPath(preferredDir);
  const fileNorm = normalizeDedupPath(filePath);
  if (!dirNorm || !fileNorm) return false;
  if (dedupPathsAreCaseInsensitive(fileNorm, dirNorm)) {
    const fileLower = fileNorm.toLowerCase();
    const dirLower = dirNorm.toLowerCase();
    return fileLower === dirLower || fileLower.startsWith(dirLower + '/');
  }
  return fileNorm === dirNorm || fileNorm.startsWith(dirNorm + '/');
}

/**
 * Copy to keep in a duplicate group.
 * A file under preferredDir wins, including nested folders.
 * Among those, the shortest real path wins over a deeper copy or a ZIP entry.
 * Otherwise keep a ZIP, then the first file.
 */
function pickDedupKeeperPath(files, preferredDir) {
  const list = Array.isArray(files) ? files.filter((f) => f && f.filePath) : [];
  if (!list.length) return '';
  if (preferredDir) {
    const under = list.filter((f) => fileIsUnderPreferredDirectory(f.filePath, preferredDir));
    if (under.length) {
      const loose = under.filter((f) => !String(f.filePath).includes('::'));
      const pool = loose.length ? loose : under;
      pool.sort((a, b) => {
        const al = normalizeDedupPath(a.filePath).length;
        const bl = normalizeDedupPath(b.filePath).length;
        if (al !== bl) return al - bl;
        return String(a.filePath).localeCompare(String(b.filePath));
      });
      return pool[0].filePath;
    }
  }
  const zipFile = list.find((f) => String(f.filePath).includes('::'));
  if (zipFile) return zipFile.filePath;
  return list[0].filePath;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeDedupPath,
    fileIsUnderPreferredDirectory,
    pickDedupKeeperPath
  };
}
