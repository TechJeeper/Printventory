'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const JSZip = require('jszip');
const fflate = require('fflate');

const LOC_SIG = 0x04034b50;
const LOCHDR = 30;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const MAX_IN_MEMORY_FALLBACK_BYTES = 512 * 1024 * 1024;

const zipOpQueues = new Map();

function zipLockKey(zipPath) {
  try {
    return path.resolve(zipPath);
  } catch (_) {
    return String(zipPath || '');
  }
}

function withZipFileLock(zipPath, operation) {
  const key = zipLockKey(zipPath);
  const prev = zipOpQueues.get(key) || Promise.resolve();
  const run = prev.then(operation, operation);
  zipOpQueues.set(key, run.then(() => undefined, () => undefined));
  return run;
}

function normalizeZipEntryName(entryPath) {
  return String(entryPath || '').replace(/\\/g, '/');
}

function namesMatch(a, b) {
  return normalizeZipEntryName(a) === normalizeZipEntryName(b);
}

/** Find a zip central-directory entry; normalize \ vs / (Windows vs zip standard). */
function findZipEntry(entries, entryPath) {
  if (!entries || !entryPath) return null;
  if (entries[entryPath]) return entries[entryPath];
  const normalized = normalizeZipEntryName(entryPath);
  if (entries[normalized]) return entries[normalized];
  for (const entry of Object.values(entries)) {
    if (!entry || entry.isDirectory) continue;
    if (namesMatch(entry.name, normalized)) return entry;
  }
  return null;
}

function isFragileZipError(error) {
  const msg = error && error.message ? error.message : String(error || '');
  const code = error && error.code;
  return code === 'Z_BUF_ERROR' ||
    code === 'Z_DATA_ERROR' ||
    /invalid local header|unexpected end of file|invalid distance|incorrect header check|invalid entry header|invalid block type/i.test(msg);
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error || 'Unknown zip error');
}

async function extractWithStreamZip(zipPath, entryPath) {
  const StreamZip = require('node-stream-zip');
  const zip = new StreamZip.async({ file: zipPath });
  let closed = false;
  try {
    const entries = await zip.entries();
    const entry = findZipEntry(entries, entryPath);
    if (!entry) {
      throw new Error(`Zip entry not found: ${entryPath}`);
    }
    try {
      return await zip.entryData(entry.name || entryPath);
    } catch (extractErr) {
      if (!isFragileZipError(extractErr)) throw extractErr;
      await zip.close();
      closed = true;
      return await extractUsingCentralDirectory(zipPath, entry);
    }
  } finally {
    if (!closed) {
      await zip.close();
    }
  }
}

async function extractUsingCentralDirectory(zipPath, entry) {
  const handle = await fs.promises.open(zipPath, 'r');
  try {
    let offset = Number(entry.offset) || 0;
    const header = Buffer.alloc(LOCHDR);
    await handle.read(header, 0, LOCHDR, offset);

    if (header.readUInt32LE(0) !== LOC_SIG) {
      const window = Buffer.alloc(1024);
      const winStart = Math.max(0, offset - 64);
      const { bytesRead } = await handle.read(window, 0, window.length, winStart);
      let found = -1;
      for (let i = 0; i <= bytesRead - 4; i++) {
        if (window.readUInt32LE(i) === LOC_SIG) {
          found = i;
          break;
        }
      }
      if (found < 0) {
        throw new Error('Invalid local header');
      }
      offset = winStart + found;
      await handle.read(header, 0, LOCHDR, offset);
      if (header.readUInt32LE(0) !== LOC_SIG) {
        throw new Error('Invalid local header');
      }
    }

    const method = header.readUInt16LE(8);
    const fnameLen = header.readUInt16LE(26);
    const extraLen = header.readUInt16LE(28);
    const dataStart = offset + LOCHDR + fnameLen + extraLen;
    const compressedSize = Number(entry.compressedSize) || 0;
    if (compressedSize < 0 || !Number.isFinite(compressedSize)) {
      throw new Error('Invalid compressed size');
    }

    const compressed = Buffer.alloc(compressedSize);
    const { bytesRead } = await handle.read(compressed, 0, compressedSize, dataStart);
    if (bytesRead !== compressedSize) {
      const err = new Error('unexpected end of file');
      err.code = 'Z_BUF_ERROR';
      throw err;
    }

    if (method === METHOD_STORED) {
      return compressed;
    }
    if (method === METHOD_DEFLATE) {
      const uncompressedSize = Number(entry.size);
      const inflateOpts = Number.isFinite(uncompressedSize) && uncompressedSize > 0
        ? { maxOutputLength: uncompressedSize + 32 }
        : undefined;
      return zlib.inflateRawSync(compressed, inflateOpts);
    }
    throw new Error(`Unsupported ZIP compression method: ${method}`);
  } finally {
    await handle.close();
  }
}

function findUnzippedFile(unzipped, entryPath) {
  const normalized = normalizeZipEntryName(entryPath);
  if (unzipped[entryPath]) return unzipped[entryPath];
  if (unzipped[normalized]) return unzipped[normalized];
  const key = Object.keys(unzipped).find((name) => namesMatch(name, normalized));
  return key ? unzipped[key] : null;
}

async function extractWithFflate(zipPath, entryPath) {
  const data = await fs.promises.readFile(zipPath);
  const unzipped = fflate.unzipSync(new Uint8Array(data), {
    filter(file) {
      return namesMatch(file.name, entryPath);
    }
  });
  const file = findUnzippedFile(unzipped, entryPath);
  if (!file) {
    throw new Error(`Zip entry not found: ${entryPath}`);
  }
  return Buffer.from(file);
}

async function extractWithJszip(zipPath, entryPath) {
  const data = await fs.promises.readFile(zipPath);
  const zip = await JSZip.loadAsync(data);
  const normalized = normalizeZipEntryName(entryPath);
  let file = zip.file(entryPath) || zip.file(normalized);
  if (!file) {
    zip.forEach((name, zipFile) => {
      if (!file && !zipFile.dir && namesMatch(name, normalized)) {
        file = zipFile;
      }
    });
  }
  if (!file) {
    throw new Error(`Zip entry not found: ${entryPath}`);
  }
  return Buffer.from(await file.async('nodebuffer'));
}

async function extractWithInMemoryFallback(zipPath, entryPath) {
  const stat = await fs.promises.stat(zipPath);
  if (stat.size > MAX_IN_MEMORY_FALLBACK_BYTES) {
    throw new Error(
      `Zip archive is too large for fallback extraction (${stat.size} bytes)`
    );
  }
  try {
    return await extractWithFflate(zipPath, entryPath);
  } catch (fflateErr) {
    try {
      return await extractWithJszip(zipPath, entryPath);
    } catch (jszipErr) {
      const err = new Error(errorMessage(fflateErr));
      err.cause = jszipErr;
      throw err;
    }
  }
}

async function extractZipEntryBuffer(zipPath, entryPath) {
  if (!zipPath || !entryPath) {
    throw new Error('Zip path and entry path are required');
  }

  return withZipFileLock(zipPath, async () => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await extractWithStreamZip(zipPath, entryPath);
      } catch (error) {
        lastError = error;
        if (!isFragileZipError(error) || attempt === 1) break;
      }
    }

    if (lastError && lastError.code === 'ENOENT') {
      throw lastError;
    }

    try {
      console.warn(
        `node-stream-zip failed for ${zipPath}::${entryPath} (${errorMessage(lastError)}); retrying with fflate/JSZip`
      );
      return await extractWithInMemoryFallback(zipPath, entryPath);
    } catch (fallbackErr) {
      console.error(`Error extracting ${entryPath} from ${zipPath}:`, lastError);
      throw lastError || fallbackErr;
    }
  });
}

module.exports = {
  findZipEntry,
  withZipFileLock,
  extractZipEntryBuffer,
  isFragileZipError,
  extractWithFflate,
  extractWithJszip
};
