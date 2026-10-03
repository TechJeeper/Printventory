'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NO_PARENT_FOLDER = 'No Parent Model';
const SPACE_MARGIN_BYTES = 64 * 1024 * 1024;
const PREVIEW_SAMPLE_LIMIT = 20;
const MAX_STRUCTURE_LAYERS = 4;

const STRUCTURE_FIELDS = {
  designer: { id: 'designer', label: 'Designer', empty: 'No Designer', column: 'designer' },
  parentModel: { id: 'parentModel', label: 'Parent Model', empty: 'No Parent Model', column: 'parentModel' },
  license: { id: 'license', label: 'License', empty: 'No License', column: 'license' },
  source: { id: 'source', label: 'Source', empty: 'No Source', column: 'source' },
  printStatus: { id: 'printStatus', label: 'Print Status', empty: 'No Print Status', column: 'print_status' }
};

const SKIP = {
  ZIP: 'Zip entries stay inside their archive',
  URL: 'Browser links have no file to move',
  IN_PLACE: 'Already in the destination layout',
  BAD_NAME: 'File name cannot be used as a path',
  MISSING: 'File is no longer on disk',
  OUTSIDE: 'Destination would leave the chosen root'
};

function emptyPlan(error) {
  return {
    ok: false,
    error,
    moves: [],
    skipped: [],
    reasonCounts: {},
    noParentCount: 0,
    copyBytes: 0,
    copyCount: 0,
    resumeCount: 0,
    sample: []
  };
}

function compareKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let resolved = path.resolve(raw);
  const asPosix = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
  const folded = asPosix || resolved.replace(/\\/g, '/');
  if (process.platform === 'win32' || /^[A-Za-z]:/.test(folded) || folded.startsWith('//')) {
    return folded.toLowerCase();
  }
  return folded;
}

function directoriesOverlap(sourceDir, destDir) {
  const left = compareKey(sourceDir);
  const right = compareKey(destDir);
  if (!left || !right) return true;
  if (left === right) return true;
  if (right.startsWith(left + '/')) return true;
  if (left.startsWith(right + '/')) return true;
  return false;
}

function fileIsInsideDirectory(filePath, directory) {
  const file = compareKey(filePath);
  const dir = compareKey(directory);
  if (!file || !dir) return false;
  return file.startsWith(dir + '/');
}

function pathsAreSame(a, b) {
  const left = compareKey(a);
  const right = compareKey(b);
  return !!left && left === right;
}

function sourceIsScanned(sourceDir, roots) {
  if (!Array.isArray(roots)) return false;
  return roots.some((root) => pathsAreSame(sourceDir, root) || fileIsInsideDirectory(sourceDir, root));
}

function sanitizePathSegment(name) {
  let segment = String(name == null ? '' : name);
  segment = segment.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ');
  segment = segment.replace(/\s+/g, ' ').trim();
  segment = segment.replace(/^[. ]+/, '').replace(/[. ]+$/g, '').trim();
  if (!segment || segment === '.' || segment === '..') return '';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(segment)) {
    segment += '_';
  }
  return segment;
}

function sanitizeFileName(fileName) {
  const base = path.basename(String(fileName || '').replace(/\\/g, '/'));
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const safeStem = sanitizePathSegment(stem);
  const safeExt = String(ext || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '');
  if (!safeStem) return '';
  return safeStem + safeExt;
}

function parentFolderName(parentModel) {
  return sanitizePathSegment(parentModel) || NO_PARENT_FOLDER;
}

function resolveLayers(layers) {
  if (!Array.isArray(layers)) return ['parentModel'];
  const seen = new Set();
  const out = [];
  for (const id of layers) {
    const key = String(id || '');
    if (!STRUCTURE_FIELDS[key] || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_STRUCTURE_LAYERS) break;
  }
  return out;
}

function mostCommonColumn(entries, column) {
  const counts = new Map();
  const order = [];
  for (const model of entries) {
    const name = sanitizePathSegment(model && model[column]);
    if (!name) continue;
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const name of order) {
    const count = counts.get(name);
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

function placementFor(dest, layers, valuesByColumn) {
  const segments = [];
  const emptyLayers = [];
  for (const id of layers) {
    const field = STRUCTURE_FIELDS[id];
    const clean = sanitizePathSegment(valuesByColumn[field.column]);
    if (!clean) emptyLayers.push({ id: field.id, label: field.label, folder: field.empty });
    segments.push(clean || field.empty);
  }
  return {
    folder: segments.length ? path.join(dest, ...segments) : dest,
    emptyLayers,
    noParent: emptyLayers.some((layer) => layer.id === 'parentModel')
  };
}

function valuesForModel(model, layers) {
  const values = {};
  for (const id of layers) {
    const column = STRUCTURE_FIELDS[id].column;
    values[column] = model ? model[column] : '';
  }
  return values;
}

function valuesForGroup(entries, layers) {
  const values = {};
  for (const id of layers) {
    const column = STRUCTURE_FIELDS[id].column;
    values[column] = mostCommonColumn(entries, column);
  }
  return values;
}

function tallyEmptyLayers(moves) {
  const map = new Map();
  for (const move of moves) {
    for (const layer of move.emptyLayers || []) {
      const current = map.get(layer.id) || { id: layer.id, label: layer.label, folder: layer.folder, count: 0 };
      current.count += 1;
      map.set(layer.id, current);
    }
  }
  return [...map.values()];
}

function indexedFileName(fileName, index) {
  if (index <= 1) return fileName;
  const ext = path.extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  return `${stem} (${index})${ext}`;
}

function destinationStaysInsideRoot(root, destFile) {
  const rootKey = compareKey(root);
  const destKey = compareKey(destFile);
  if (!rootKey || !destKey) return false;
  return destKey.startsWith(rootKey + '/');
}

function containerPath(filePath) {
  const value = String(filePath || '');
  const splitAt = value.indexOf('::');
  return splitAt === -1 ? value : value.slice(0, splitAt);
}

function skipReason(filePath) {
  const value = String(filePath || '');
  if (!value) return SKIP.MISSING;
  if (value.startsWith('url::')) return SKIP.URL;
  if (value.includes('::')) return SKIP.ZIP;
  return null;
}

function countReasons(skipped) {
  const counts = {};
  for (const item of skipped) {
    const reason = item && item.reason ? item.reason : 'Skipped';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function zipArchivePath(filePath) {
  const value = String(filePath || '');
  if (!value || value.startsWith('url::')) return '';
  const splitAt = value.indexOf('::');
  if (splitAt <= 0) return '';
  return value.slice(0, splitAt);
}

function allocateDestination(directory, fileName, bytes, destStat, taken) {
  for (let index = 1; index < 10000; index++) {
    const name = indexedFileName(fileName, index);
    const full = path.join(directory, name);
    const key = compareKey(full);
    if (taken.has(key)) continue;
    const existing = destStat ? destStat(full) : null;
    if (!existing) {
      taken.add(key);
      return { to: full, action: 'copy' };
    }
    const sameSize = existing.isFile && bytes != null && Number(existing.size) === Number(bytes);
    if (index === 1 && sameSize) {
      taken.add(key);
      return { to: full, action: 'resume' };
    }
  }
  return null;
}

/**
 * Plan moves for library rows already stored under sourceDir.
 * options.destStat(absPath) -> null | { size, isFile }
 * options.sourceStat(absPath) -> null | { size, isFile }
 */
function planOrganize(models, sourceDir, destDir, options = {}) {
  const source = String(sourceDir || '').trim();
  const dest = String(destDir || '').trim();
  if (!source || !dest) {
    return emptyPlan('Choose a source directory and a destination directory.');
  }
  if (Array.isArray(options.allowedRoots) && !sourceIsScanned(source, options.allowedRoots)) {
    return emptyPlan('Choose a scanned directory, or a folder inside one.');
  }
  if (directoriesOverlap(source, dest)) {
    return emptyPlan('Source and destination must be separate folders. One cannot be inside the other.');
  }

  const destStat = options.destStat || null;
  const sourceStat = options.sourceStat || null;
  const includeZips = options.includeZips === true;
  const layers = resolveLayers(options.layers);
  const taken = new Set();
  const moves = [];
  const skipped = [];
  const claimedArchives = new Set();
  const rows = Array.isArray(models) ? models : [];

  if (includeZips) {
    const groups = new Map();
    for (const model of rows) {
      const filePath = model && model.filePath ? String(model.filePath) : '';
      const archive = zipArchivePath(filePath);
      if (!archive || !fileIsInsideDirectory(archive, source)) continue;
      const key = compareKey(archive);
      if (!groups.has(key)) groups.set(key, { archive, entries: [] });
      groups.get(key).entries.push(model);
    }
    for (const group of groups.values()) {
      const archive = group.archive;
      claimedArchives.add(compareKey(archive));
      let bytes = null;
      if (sourceStat) {
        const onDisk = sourceStat(archive);
        if (!onDisk || !onDisk.isFile) {
          for (const entry of group.entries) {
            skipped.push({ filePath: entry.filePath, reason: SKIP.MISSING });
          }
          continue;
        }
        bytes = Number(onDisk.size);
      }
      const safeName = sanitizeFileName(path.basename(archive));
      if (!safeName) {
        for (const entry of group.entries) {
          skipped.push({ filePath: entry.filePath, reason: SKIP.BAD_NAME });
        }
        continue;
      }
      const placement = placementFor(dest, layers, valuesForGroup(group.entries, layers));
      const allocated = allocateDestination(placement.folder, safeName, bytes, destStat, taken);
      if (!allocated || !destinationStaysInsideRoot(dest, allocated.to)) {
        for (const entry of group.entries) {
          skipped.push({ filePath: entry.filePath, reason: SKIP.OUTSIDE });
        }
        continue;
      }
      if (pathsAreSame(archive, allocated.to)) {
        for (const entry of group.entries) {
          skipped.push({ filePath: entry.filePath, reason: SKIP.IN_PLACE });
        }
        continue;
      }
      const libraryUpdates = group.entries.map((entry) => {
        const current = String(entry.filePath || '');
        const splitAt = current.indexOf('::');
        const suffix = splitAt === -1 ? '' : current.slice(splitAt);
        return {
          from: current,
          to: allocated.to + suffix,
          fileName: entry.fileName || ''
        };
      });
      moves.push({
        from: archive,
        to: allocated.to,
        parentModel: placement.folder,
        fileName: path.basename(allocated.to),
        bytes: bytes == null ? 0 : bytes,
        action: allocated.action,
        noParent: placement.noParent,
        emptyLayers: placement.emptyLayers,
        kind: 'zip',
        zipEntryCount: group.entries.length,
        libraryUpdates
      });
    }
  }

  for (const model of rows) {
    const filePath = model && model.filePath ? String(model.filePath) : '';
    const reason = skipReason(filePath);
    if (reason) {
      if (reason === SKIP.ZIP && includeZips && claimedArchives.has(compareKey(containerPath(filePath)))) {
        continue;
      }
      const holder = reason === SKIP.URL ? '' : containerPath(filePath);
      if (holder && fileIsInsideDirectory(holder, source)) {
        skipped.push({ filePath, reason });
      }
      continue;
    }
    if (!fileIsInsideDirectory(filePath, source)) continue;
    if (claimedArchives.has(compareKey(filePath))) continue;

    let bytes = null;
    if (sourceStat) {
      const onDisk = sourceStat(filePath);
      if (!onDisk || !onDisk.isFile) {
        skipped.push({ filePath, reason: SKIP.MISSING });
        continue;
      }
      bytes = Number(onDisk.size);
    } else if (model.size != null && Number(model.size) >= 0) {
      bytes = Number(model.size);
    }

    const safeName = sanitizeFileName(model.fileName || path.basename(filePath));
    if (!safeName) {
      skipped.push({ filePath, reason: SKIP.BAD_NAME });
      continue;
    }

    const placement = placementFor(dest, layers, valuesForModel(model, layers));
    const allocated = allocateDestination(placement.folder, safeName, bytes, destStat, taken);
    if (!allocated || !destinationStaysInsideRoot(dest, allocated.to)) {
      skipped.push({ filePath, reason: SKIP.OUTSIDE });
      continue;
    }
    if (pathsAreSame(filePath, allocated.to)) {
      skipped.push({ filePath, reason: SKIP.IN_PLACE });
      continue;
    }

    moves.push({
      id: model.id,
      from: filePath,
      to: allocated.to,
      parentModel: placement.folder,
      fileName: path.basename(allocated.to),
      bytes: bytes == null ? 0 : bytes,
      action: allocated.action,
      noParent: placement.noParent,
      emptyLayers: placement.emptyLayers
    });
  }

  const copyMoves = moves.filter((move) => move.action === 'copy');
  const resumeMoves = moves.filter((move) => move.action === 'resume');
  return {
    ok: true,
    error: null,
    moves,
    skipped,
    reasonCounts: countReasons(skipped),
    noParentCount: moves.filter((move) => move.noParent).length,
    emptyLayers: tallyEmptyLayers(moves),
    layers,
    copyBytes: copyMoves.reduce((sum, move) => sum + (Number(move.bytes) || 0), 0),
    copyCount: copyMoves.length,
    resumeCount: resumeMoves.length,
    zipCount: moves.filter((move) => move.kind === 'zip').length,
    zipEntryCount: moves.reduce((sum, move) => sum + (Number(move.zipEntryCount) || 0), 0),
    sample: moves.slice(0, PREVIEW_SAMPLE_LIMIT).map((move) => ({
      from: move.from,
      to: move.to,
      action: move.action,
      zipEntryCount: move.zipEntryCount || 0
    }))
  };
}

function withFreeSpace(plan, freeBytes) {
  const base = plan || emptyPlan('Nothing to organize.');
  const free = Number(freeBytes);
  const known = Number.isFinite(free) && free >= 0;
  const needsCopy = (Number(base.copyBytes) || 0) > 0;
  const enough = !needsCopy || (known && free >= base.copyBytes + SPACE_MARGIN_BYTES);
  let spaceError = null;
  if (base.ok && needsCopy && !enough) {
    spaceError = known
      ? 'Not enough free disk space to copy the files before removing the originals.'
      : 'Could not read free space on the destination.';
  }
  return {
    ...base,
    freeBytes: known ? free : null,
    marginBytes: SPACE_MARGIN_BYTES,
    enoughSpace: !!(base.ok && enough),
    spaceError
  };
}

async function readFreeBytes(dirPath) {
  let current = path.resolve(String(dirPath || ''));
  for (let i = 0; i < 40; i++) {
    try {
      const st = await fs.promises.stat(current);
      if (st.isDirectory()) {
        const space = await fs.promises.statfs(current);
        const available = Number(space.bavail) * Number(space.bsize);
        return Number.isFinite(available) ? available : null;
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') return null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

async function relocatePlannedFile(move, deps = {}) {
  const fsp = deps.fs || fs.promises;
  const copyFile = deps.copyFile || ((from, to) => fsp.copyFile(from, to));
  const rename = deps.rename || ((from, to) => fsp.rename(from, to));
  const unlink = deps.unlink || ((target) => fsp.unlink(target));
  const stat = deps.stat || ((target) => fsp.stat(target));
  const mkdir = deps.mkdir || ((dir) => fsp.mkdir(dir, { recursive: true }));
  const updateFilePath = deps.updateFilePath;
  const updateLibrary = deps.updateLibrary;
  const libraryUpdates = move && Array.isArray(move.libraryUpdates) ? move.libraryUpdates : null;

  if (!move || !move.from || !move.to) {
    return { status: 'failed', error: 'Missing path', from: move && move.from };
  }
  if (libraryUpdates && libraryUpdates.length) {
    if (typeof updateLibrary !== 'function') {
      return { status: 'failed', error: 'Missing library update', from: move.from };
    }
  } else if (typeof updateFilePath !== 'function') {
    return { status: 'failed', error: 'Missing library update', from: move.from };
  }

  async function commitLibrary() {
    if (libraryUpdates && libraryUpdates.length) {
      await updateLibrary(libraryUpdates);
      return;
    }
    await updateFilePath(move.from, move.to);
  }

  async function finishResume() {
    const src = await stat(move.from);
    const dst = await stat(move.to);
    if (!src.isFile() || !dst.isFile() || src.size !== dst.size) {
      return { status: 'failed', error: 'Destination no longer matches the original', from: move.from };
    }
    await commitLibrary();
    try {
      await unlink(move.from);
    } catch (err) {
      return {
        status: 'moved',
        action: 'resume',
        warning: 'Copied but the original remains: ' + (err.message || 'delete failed'),
        from: move.from,
        to: move.to
      };
    }
    return { status: 'moved', action: 'resume', from: move.from, to: move.to };
  }

  if (move.action === 'resume') {
    try {
      return await finishResume();
    } catch (err) {
      return { status: 'failed', error: err.message || 'Could not finish the resumed copy', from: move.from };
    }
  }

  const tempPath = path.join(
    path.dirname(move.to),
    `.printventory-copy-${crypto.randomBytes(8).toString('hex')}`
  );
  try {
    await mkdir(path.dirname(move.to));
    await copyFile(move.from, tempPath);
    const src = await stat(move.from);
    const tmp = await stat(tempPath);
    if (!src.isFile() || src.size !== tmp.size) {
      await unlink(tempPath).catch(() => {});
      return { status: 'failed', error: 'Copy size did not match the original', from: move.from };
    }

    let blocked = null;
    try {
      blocked = await stat(move.to);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    if (blocked) {
      await unlink(tempPath).catch(() => {});
      if (blocked.isFile && blocked.size === src.size) {
        return await finishResume();
      }
      return { status: 'failed', error: 'A different file is already at the destination', from: move.from };
    }

    await rename(tempPath, move.to);
    try {
      await commitLibrary();
    } catch (err) {
      await unlink(move.to).catch(() => {});
      return { status: 'failed', error: err.message || 'Library record was not updated', from: move.from };
    }
    try {
      await unlink(move.from);
    } catch (err) {
      return {
        status: 'moved',
        action: 'copy',
        warning: 'Copied but the original remains: ' + (err.message || 'delete failed'),
        from: move.from,
        to: move.to
      };
    }
    return { status: 'moved', action: 'copy', from: move.from, to: move.to };
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    return { status: 'failed', error: err.message || 'Copy failed', from: move.from };
  }
}

async function runOrganizePlan(plan, deps = {}) {
  const moves = plan && Array.isArray(plan.moves) ? plan.moves : [];
  const results = {
    moved: 0,
    resumed: 0,
    failed: [],
    warnings: [],
    zipModels: 0,
    skipped: plan && Array.isArray(plan.skipped) ? plan.skipped.length : 0
  };
  for (let i = 0; i < moves.length; i++) {
    if (typeof deps.onProgress === 'function') {
      deps.onProgress(i, moves.length, moves[i]);
    }
    const result = await relocatePlannedFile(moves[i], deps);
    if (result.status === 'moved') {
      results.moved += 1;
      results.zipModels += Number(moves[i].zipEntryCount) || 0;
      if (result.action === 'resume') results.resumed += 1;
      if (result.warning) {
        results.warnings.push({ from: result.from, to: result.to, warning: result.warning });
      }
    } else {
      results.failed.push({ from: result.from || moves[i].from, error: result.error || 'Copy failed' });
    }
  }
  if (typeof deps.onProgress === 'function') {
    deps.onProgress(moves.length, moves.length, null);
  }
  return results;
}

module.exports = {
  NO_PARENT_FOLDER,
  SPACE_MARGIN_BYTES,
  PREVIEW_SAMPLE_LIMIT,
  SKIP,
  sanitizePathSegment,
  sanitizeFileName,
  parentFolderName,
  directoriesOverlap,
  fileIsInsideDirectory,
  pathsAreSame,
  sourceIsScanned,
  planOrganize,
  withFreeSpace,
  readFreeBytes,
  relocatePlannedFile,
  runOrganizePlan
};
