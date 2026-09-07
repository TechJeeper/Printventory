'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const INBOX_FOLDER_NAME = 'PrintventoryInbox';
const INBOX_EXT = '.pvimport.json';
const POLL_INTERVAL_MS = 60 * 1000;

function defaultInboxDirectory(homedir) {
  return path.join(homedir || os.homedir(), 'Downloads', INBOX_FOLDER_NAME);
}

function resolveInboxDirectory(custom, options) {
  const trimmed = custom == null ? '' : String(custom).trim();
  if (trimmed) return trimmed;
  return defaultInboxDirectory(options && options.homedir);
}

function inboxDirectoryBesideDatabase(dbPath) {
  if (!dbPath) return null;
  return path.join(path.dirname(dbPath), INBOX_FOLDER_NAME);
}

function uniqueInboxDirectories(dirs) {
  const seen = new Set();
  const out = [];
  (dirs || []).forEach((dir) => {
    if (!dir) return;
    let key;
    try {
      key = path.resolve(dir).toLowerCase();
    } catch (e) {
      key = String(dir).toLowerCase();
    }
    if (seen.has(key)) return;
    seen.add(key);
    out.push(dir);
  });
  return out;
}

async function importInboxMany(options) {
  const dirs = uniqueInboxDirectories(options && options.inboxDirs);
  const combined = { imported: 0, failed: 0, skipped: 0, errors: [], models: [] };
  for (const inboxDir of dirs) {
    const part = await importInbox(Object.assign({}, options, { inboxDir: inboxDir }));
    combined.imported += part.imported;
    combined.failed += part.failed;
    combined.skipped += part.skipped;
    combined.errors = combined.errors.concat(part.errors || []);
    combined.models = combined.models.concat(part.models || []);
  }
  return combined;
}

function isInboxFileName(name) {
  return typeof name === 'string' && name.toLowerCase().endsWith(INBOX_EXT);
}

function parseInboxPayload(raw, fileName) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error('Invalid JSON in ' + (fileName || 'inbox file'));
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Inbox file must be a JSON object');
  }
  const version = data.version == null ? 1 : Number(data.version);
  if (version !== 1) {
    throw new Error('Unsupported inbox version: ' + data.version);
  }
  const source = data.source || data.url || null;
  let filePath = data.filePath || null;
  if (filePath != null) filePath = String(filePath).trim() || null;
  if (!filePath && source) {
    filePath = String(source).startsWith('url::') ? String(source) : 'url::' + source;
  }
  if (!filePath) {
    throw new Error('Inbox item needs filePath or source');
  }
  const parentModel = data.parentModel || data.fileName || null;
  return {
    id: data.id || null,
    createdAt: data.createdAt || null,
    filePath: filePath,
    fileName: data.fileName || parentModel || path.basename(filePath.replace(/^url::/, '')),
    designer: data.designer || null,
    parentModel: parentModel,
    source: source,
    notes: data.notes || null,
    license: data.license || null
  };
}

function toModelData(item) {
  return {
    filePath: item.filePath,
    fileName: item.fileName,
    designer: item.designer,
    parentModel: item.parentModel,
    source: item.source,
    notes: item.notes,
    license: item.license,
    markAsNew: true
  };
}

function ensureDir(fsApi, dir) {
  if (!fsApi.existsSync(dir)) {
    fsApi.mkdirSync(dir, { recursive: true });
  }
}

function moveInboxFile(fsApi, pathApi, fromPath, destDir, destName) {
  ensureDir(fsApi, destDir);
  let target = pathApi.join(destDir, destName);
  if (fsApi.existsSync(target)) {
    const stamp = Date.now();
    const ext = destName.toLowerCase().endsWith(INBOX_EXT) ? INBOX_EXT : pathApi.extname(destName);
    const stem = destName.slice(0, destName.length - ext.length);
    target = pathApi.join(destDir, stem + '-' + stamp + ext);
  }
  fsApi.renameSync(fromPath, target);
  return target;
}

function fileLooksReady(fsApi, filePath, nowMs) {
  try {
    const st = fsApi.statSync(filePath);
    if (!st || !st.isFile() || st.size < 2) return false;
    const age = (nowMs || Date.now()) - (st.mtimeMs || 0);
    return age >= 750;
  } catch (e) {
    return false;
  }
}

function isUrlModelPath(filePath) {
  return typeof filePath === 'string' && filePath.startsWith('url::');
}

/**
 * Import *.pvimport.json from inboxDir. Successful files go to processed/,
 * failures to failed/. Inject fs/path/saveModel for tests.
 */
async function importInbox(options) {
  const fsApi = (options && options.fs) || fs;
  const pathApi = (options && options.path) || path;
  const saveModel = options && options.saveModel;
  const inboxDir = options && options.inboxDir;
  const nowMs = options && options.nowMs;
  if (!inboxDir) throw new Error('inboxDir is required');
  if (typeof saveModel !== 'function') throw new Error('saveModel is required');

  const result = { imported: 0, failed: 0, skipped: 0, errors: [], models: [] };
  if (!fsApi.existsSync(inboxDir)) {
    return result;
  }

  const processedDir = pathApi.join(inboxDir, 'processed');
  const failedDir = pathApi.join(inboxDir, 'failed');
  let names;
  try {
    names = fsApi.readdirSync(inboxDir);
  } catch (e) {
    result.errors.push(e.message || String(e));
    return result;
  }

  const files = names.filter((name) => isInboxFileName(name));
  for (const name of files) {
    const full = pathApi.join(inboxDir, name);
    if (!fileLooksReady(fsApi, full, nowMs)) {
      result.skipped += 1;
      continue;
    }
    try {
      const raw = fsApi.readFileSync(full, 'utf8');
      const item = parseInboxPayload(raw, name);
      if (!isUrlModelPath(item.filePath) && !fsApi.existsSync(item.filePath)) {
        throw new Error('Model file not found: ' + item.filePath);
      }
      const saved = await saveModel(toModelData(item));
      moveInboxFile(fsApi, pathApi, full, processedDir, name);
      result.imported += 1;
      result.models.push(saved || item);
    } catch (err) {
      result.failed += 1;
      result.errors.push((name + ': ') + (err && err.message ? err.message : String(err)));
      try {
        moveInboxFile(fsApi, pathApi, full, failedDir, name);
      } catch (moveErr) {
        result.errors.push(name + ' (move failed): ' + (moveErr.message || String(moveErr)));
      }
    }
  }
  return result;
}

module.exports = {
  INBOX_FOLDER_NAME,
  INBOX_EXT,
  POLL_INTERVAL_MS,
  defaultInboxDirectory,
  resolveInboxDirectory,
  inboxDirectoryBesideDatabase,
  uniqueInboxDirectories,
  isInboxFileName,
  parseInboxPayload,
  toModelData,
  importInbox,
  importInboxMany
};
