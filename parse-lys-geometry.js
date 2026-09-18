'use strict';

/**
 * Parse Lychee .lys geometry blobs into triangle meshes.
 *
 * Container: mango JSON (`mangoFiles`) or ZIP. Geometry lives in `.bin` payloads
 * other than `scene.bin`. Modern blobs are indexed (20-byte header). Older
 * files are an unindexed triangle soup with a 4-byte count and stride-48
 * [V0, V1, V2, Attr] records.
 */

const IMAGE_RE = /\.(png|jpe?g|webp|bmp|gif)$/i;
const MAX_MANIFEST_SCAN = 2_000_000;

function unzipSyncFn() {
  if (typeof require === 'function') {
    try {
      return require('fflate').unzipSync;
    } catch {
      /* worker / no fflate module */
    }
  }
  if (typeof fflate !== 'undefined' && typeof fflate.unzipSync === 'function') {
    return fflate.unzipSync;
  }
  return null;
}

function isZip(data) {
  return !!(data && data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b);
}

function matchBrace(data, start, limit) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < limit; i++) {
    const c = data[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === 0x5c) esc = true;
      else if (c === 0x22) inStr = false;
      continue;
    }
    if (c === 0x22) inStr = true;
    else if (c === 0x7b) depth++;
    else if (c === 0x7d) {
      depth--;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function indexOfBytes(data, needle, from, limit) {
  outer: for (let i = from; i <= limit - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (data[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function readLysManifest(data) {
  const limit = Math.min(data.length, MAX_MANIFEST_SCAN);
  const marker = new TextEncoder().encode('"mangoFiles"');
  const decoder = new TextDecoder('utf-8');

  for (let m = indexOfBytes(data, marker, 0, limit); m >= 0; m = indexOfBytes(data, marker, m + 1, limit)) {
    for (let s = m; s >= Math.max(0, m - 200_000); s--) {
      if (data[s] !== 0x7b) continue;
      const end = matchBrace(data, s, limit);
      if (end < 0) continue;
      try {
        const manifest = JSON.parse(decoder.decode(data.subarray(s, end)));
        if (manifest && typeof manifest === 'object' && manifest.mangoFiles) return { manifest, end };
      } catch {
        /* keep walking back */
      }
    }
  }
  throw new Error('LYS manifest not found');
}

function copyBlob(bytes) {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out.buffer;
}

function collectMangoGeometryBlobs(data) {
  const { manifest, end } = readLysManifest(data);
  let dataStart = end;
  while (dataStart < data.length && data[dataStart] === 0) dataStart++;
  const files = manifest.mangoFiles || {};
  const blobs = [];
  for (const [fname, info] of Object.entries(files)) {
    const name = String(fname || '').toLowerCase();
    if (!name.endsWith('.bin') || name === 'scene.bin' || name.endsWith('_hollowing.bin')) continue;
    const offset = Number(info.offset || 0);
    const size = Number(info.size || 0);
    if (!(size > 0)) continue;
    const start = dataStart + offset;
    if (start < 0 || start + size > data.length) continue;
    blobs.push({ name: fname, buffer: copyBlob(data.subarray(start, start + size)) });
  }
  return blobs;
}

function collectZipGeometryBlobs(data) {
  const unzip = unzipSyncFn();
  if (!unzip) return [];
  let zip;
  try {
    zip = unzip(data instanceof Uint8Array ? data : new Uint8Array(data));
  } catch {
    return [];
  }
  const blobs = [];
  for (const [name, bytes] of Object.entries(zip)) {
    const lower = String(name || '').toLowerCase();
    if (IMAGE_RE.test(lower)) continue;
    if (!lower.endsWith('.bin') || /(^|[\\/])scene\.bin$/i.test(lower) || lower.endsWith('_hollowing.bin')) continue;
    if (!bytes || !bytes.length) continue;
    blobs.push({ name, buffer: copyBlob(bytes) });
  }
  return blobs;
}

function collectGeometryBlobs(data) {
  if (isZip(data)) {
    const zipBlobs = collectZipGeometryBlobs(data);
    if (zipBlobs.length) return zipBlobs;
  }
  try {
    return collectMangoGeometryBlobs(data);
  } catch (error) {
    if (isZip(data)) return [];
    throw error;
  }
}

function parseIndexedGeometry(buffer) {
  const MIN_HEADER = 20;
  if (buffer.byteLength < MIN_HEADER) throw new Error('Geometry file too short');
  const view = new DataView(buffer);
  const declaredHeader = view.getUint32(4, true);
  const dataOffset = Number.isFinite(declaredHeader) && declaredHeader >= MIN_HEADER && declaredHeader <= buffer.byteLength
    ? declaredHeader
    : MIN_HEADER;
  const nIndices = view.getUint32(8, true);
  const nCoords = view.getUint32(12, true);
  if (!nIndices || !nCoords || nCoords % 3 !== 0) {
    throw new Error(`Invalid indexed counts (indices=${nIndices}, coords=${nCoords})`);
  }
  const indicesByteLen = nIndices * 4;
  const coordsByteLen = nCoords * 4;
  if (dataOffset + indicesByteLen + coordsByteLen > buffer.byteLength) {
    throw new Error('Indexed geometry payload exceeds blob size');
  }
  const indices = new Uint32Array(buffer.slice(dataOffset, dataOffset + indicesByteLen));
  const positions = new Float32Array(buffer.slice(dataOffset + indicesByteLen, dataOffset + indicesByteLen + coordsByteLen));
  if (indices.length < 3 || positions.length < 9) throw new Error('Indexed geometry is empty');
  return { positions, indices };
}

function legacyAttrStrideScore(view, dataOffset, totalBytes) {
  const sample = Math.min(40, Math.floor((totalBytes - dataOffset) / 12));
  if (sample < 8) return 0;
  let attrXYSum = 0;
  let attrCount = 0;
  let vertXYSum = 0;
  let vertCount = 0;
  for (let i = 0; i < sample; i++) {
    const off = dataOffset + i * 12;
    if (off + 12 > totalBytes) break;
    const x = view.getFloat32(off, true);
    const y = view.getFloat32(off + 4, true);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    const xyMag = Math.hypot(x, y);
    if (i % 4 === 3) {
      attrXYSum += xyMag;
      attrCount++;
    } else {
      vertXYSum += xyMag;
      vertCount++;
    }
  }
  if (!attrCount || !vertCount) return 0;
  const avgAttr = attrXYSum / attrCount;
  const avgVert = vertXYSum / vertCount;
  if (avgAttr < 2 && avgVert > 5 && avgVert > avgAttr * 5) {
    return avgVert / Math.max(avgAttr, 0.001);
  }
  return 0;
}

function readVertexXzSwap(view, base, positions, idx) {
  positions[idx] = view.getFloat32(base + 8, true);
  positions[idx + 1] = view.getFloat32(base + 4, true);
  positions[idx + 2] = view.getFloat32(base, true);
}

function parseStride48(buffer, dataOffset) {
  const view = new DataView(buffer);
  const stride = 48;
  const available = buffer.byteLength - dataOffset;
  const nWholeTris = Math.floor(available / stride);
  const remainder = available - nWholeTris * stride;
  const extraVerts = Math.min(3, Math.floor(remainder / 12));
  const totalVerts = Math.floor((nWholeTris * 3 + extraVerts) / 3) * 3;
  if (totalVerts < 3) throw new Error('Legacy geometry: not enough triangles');
  const positions = new Float32Array(totalVerts * 3);
  let idx = 0;
  const triCount = totalVerts / 3;
  for (let t = 0; t < Math.min(nWholeTris, triCount); t++) {
    const tBase = dataOffset + t * stride;
    readVertexXzSwap(view, tBase, positions, idx);
    readVertexXzSwap(view, tBase + 12, positions, idx + 3);
    readVertexXzSwap(view, tBase + 24, positions, idx + 6);
    idx += 9;
  }
  return { positions };
}

function parseLegacySoup(buffer) {
  const view = new DataView(buffer);
  const candidates = [0, 4, 8, 9, 10, 11, 12, 16, 20, 24, 28, 32];
  let dataOffset = -1;
  let bestScore = 0;
  let firstValid = -1;

  for (const H of candidates) {
    if (H + 36 > buffer.byteLength) continue;
    let valid = true;
    let significant = false;
    for (let i = 0; i < 10; i++) {
      const off = H + i * 12;
      if (off + 12 > buffer.byteLength) break;
      const x = view.getFloat32(off, true);
      const y = view.getFloat32(off + 4, true);
      const z = view.getFloat32(off + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)
        || Math.abs(x) > 10000 || Math.abs(y) > 10000 || Math.abs(z) > 10000) {
        valid = false;
        break;
      }
      if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01 || Math.abs(z) > 0.01) significant = true;
    }
    if (!valid || !significant) continue;
    if (firstValid < 0) firstValid = H;
    const score = legacyAttrStrideScore(view, H, buffer.byteLength);
    if (score > bestScore) {
      bestScore = score;
      dataOffset = H;
    }
  }
  if (dataOffset < 0) dataOffset = firstValid;
  if (dataOffset < 0) throw new Error('Legacy geometry: no vertex data');
  if (bestScore >= 5) return parseStride48(buffer, dataOffset);

  const nVerts = Math.floor((buffer.byteLength - dataOffset) / 12 / 3) * 3;
  if (nVerts < 3) throw new Error('Legacy geometry: empty soup');
  return { positions: new Float32Array(buffer.slice(dataOffset, dataOffset + nVerts * 12)) };
}

function parseLysGeometryBlob(buffer) {
  if (buffer instanceof Uint8Array) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 16) {
    throw new Error('Geometry blob is empty');
  }
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  if (count > 0 && count * 48 + 4 === buffer.byteLength) {
    return parseStride48(buffer, 4);
  }
  try {
    return parseIndexedGeometry(buffer);
  } catch (indexedError) {
    try {
      return parseLegacySoup(buffer);
    } catch (legacyError) {
      throw new Error(indexedError.message || legacyError.message);
    }
  }
}

function parseLysGeometries(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const blobs = collectGeometryBlobs(bytes);
  const meshes = [];
  for (const blob of blobs) {
    try {
      const mesh = parseLysGeometryBlob(blob.buffer);
      if (mesh && mesh.positions && mesh.positions.length >= 9) {
        meshes.push({ name: blob.name, ...mesh });
      }
    } catch {
      /* skip non-geometry bins */
    }
  }
  if (!meshes.length) throw new Error('No parseable LYS geometry');
  meshes.sort((a, b) => b.positions.length - a.positions.length);
  return meshes;
}

const api = {
  readLysManifest,
  collectGeometryBlobs,
  parseLysGeometryBlob,
  parseLysGeometries
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof self !== 'undefined') {
  self.parseLysGeometry = api;
}
