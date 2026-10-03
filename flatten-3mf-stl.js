'use strict';

/**
 * Turn a 3MF into one binary STL.
 * stl-thumb's 3MF reader fails with "failed to fill whole buffer" on many
 * ordinary packages (zip data descriptors). fflate reads those zips, and this
 * bakes build/component transforms into a single mesh stl-thumb can render.
 */

const fs = require('fs');
const fflate = require('fflate');
const { extractMeshFromXml } = require('./threemf-mesh-extract');

const OBJECT_RE = /<(?:\w+:)?object\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?object>/gi;
const COMPONENT_RE = /<(?:\w+:)?component\b([^>]*?)\/?>/gi;
const ITEM_RE = /<(?:\w+:)?item\b([^>]*?)\/?>/gi;
const SKIP_TYPES = new Set(['support', 'solidsupport']);

function attr(tag, name) {
  const re = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*"([^"]*)"`, 'i');
  const match = String(tag || '').match(re);
  return match ? match[1] : '';
}

function normalizeZipPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);
}

function parseTransformAttr(transform) {
  if (!transform || typeof transform !== 'string') return null;
  const t = transform.trim().split(/\s+/).map(parseFloat);
  if (t.length < 12 || t.some((n) => Number.isNaN(n))) return null;
  return new Float32Array([
    t[0], t[1], t[2], 0,
    t[3], t[4], t[5], 0,
    t[6], t[7], t[8], 0,
    t[9], t[10], t[11], 1
  ]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function applyPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

class TriangleBuffer {
  constructor() {
    this.capacity = 256 * 9;
    this.data = new Float32Array(this.capacity);
    this.length = 0;
  }

  push3(x, y, z) {
    if (this.length + 3 > this.capacity) {
      this.capacity *= 2;
      const next = new Float32Array(this.capacity);
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    this.data[this.length++] = x;
    this.data[this.length++] = y;
    this.data[this.length++] = z;
  }

  toArray() {
    return this.data.subarray(0, this.length);
  }
}

function encodeBinaryStl(verts) {
  const triCount = verts.length / 9;
  if (!Number.isInteger(triCount) || triCount < 1) {
    throw new Error('No mesh found in 3MF model');
  }
  if (triCount > 0xffffffff) {
    throw new Error('3MF mesh is too large to flatten to STL');
  }
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write('printventory flattened 3mf', 0, 80, 'ascii');
  buf.writeUInt32LE(triCount, 80);
  let offset = 84;
  for (let i = 0; i < verts.length; i += 9) {
    const ax = verts[i];
    const ay = verts[i + 1];
    const az = verts[i + 2];
    const bx = verts[i + 3];
    const by = verts[i + 4];
    const bz = verts[i + 5];
    const cx = verts[i + 6];
    const cy = verts[i + 7];
    const cz = verts[i + 8];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz) || 1;
    buf.writeFloatLE(nx / len, offset);
    buf.writeFloatLE(ny / len, offset + 4);
    buf.writeFloatLE(nz / len, offset + 8);
    offset += 12;
    buf.writeFloatLE(ax, offset);
    buf.writeFloatLE(ay, offset + 4);
    buf.writeFloatLE(az, offset + 8);
    buf.writeFloatLE(bx, offset + 12);
    buf.writeFloatLE(by, offset + 16);
    buf.writeFloatLE(bz, offset + 20);
    buf.writeFloatLE(cx, offset + 24);
    buf.writeFloatLE(cy, offset + 28);
    buf.writeFloatLE(cz, offset + 32);
    offset += 36;
    buf.writeUInt16LE(0, offset);
    offset += 2;
  }
  return buf;
}

function parseComponents(innerXml) {
  const components = [];
  COMPONENT_RE.lastIndex = 0;
  let match;
  while ((match = COMPONENT_RE.exec(innerXml)) !== null) {
    const tag = match[1];
    const objectId = attr(tag, 'objectid') || attr(tag, 'object');
    if (!objectId) continue;
    const pathAttr = attr(tag, 'path');
    components.push({
      objectId: String(objectId),
      path: pathAttr ? normalizeZipPath(pathAttr) : '',
      transform: parseTransformAttr(attr(tag, 'transform'))
    });
  }
  return components;
}

function parseObjects(xml) {
  const objects = new Map();
  OBJECT_RE.lastIndex = 0;
  let match;
  while ((match = OBJECT_RE.exec(xml)) !== null) {
    const tag = match[1];
    const id = attr(tag, 'id');
    if (!id) continue;
    const type = (attr(tag, 'type') || 'model').toLowerCase();
    const inner = match[2];
    const mesh = extractMeshFromXml(inner);
    objects.set(String(id), {
      type,
      positions: mesh.positions,
      indices: mesh.indices,
      components: parseComponents(inner)
    });
  }
  return objects;
}

function parseBuildItems(xml) {
  const items = [];
  ITEM_RE.lastIndex = 0;
  let match;
  while ((match = ITEM_RE.exec(xml)) !== null) {
    const tag = match[1];
    if (attr(tag, 'printable') === '0') continue;
    const objectId = attr(tag, 'objectid') || attr(tag, 'object');
    if (!objectId) continue;
    const pathAttr = attr(tag, 'path');
    items.push({
      objectId: String(objectId),
      path: pathAttr ? normalizeZipPath(pathAttr) : '',
      transform: parseTransformAttr(attr(tag, 'transform'))
    });
  }
  return items;
}

function filesByPath(unzipped) {
  const files = new Map();
  for (const key of Object.keys(unzipped)) {
    if (!key.toLowerCase().endsWith('.model')) continue;
    files.set(normalizeZipPath(key), key);
  }
  return files;
}

function lookupFileKey(files, wanted) {
  const norm = normalizeZipPath(wanted);
  if (files.has(norm)) return files.get(norm);
  const lower = norm.toLowerCase();
  for (const [key, original] of files) {
    if (key.toLowerCase() === lower) return original;
  }
  return null;
}

function emitMesh(positions, indices, matrix, out) {
  const vertCount = positions.length / 3;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];
    if (ia >= vertCount || ib >= vertCount || ic >= vertCount) continue;
    const a = applyPoint(matrix, positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]);
    const b = applyPoint(matrix, positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]);
    const c = applyPoint(matrix, positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]);
    out.push3(a[0], a[1], a[2]);
    out.push3(b[0], b[1], b[2]);
    out.push3(c[0], c[1], c[2]);
  }
}

function emitObject(files, decoded, fileKey, objectId, matrix, stack, out) {
  const visitKey = `${fileKey}::${objectId}`;
  if (stack.has(visitKey)) return;
  const xml = decoded.get(fileKey);
  if (!xml) return;
  const objects = xml.objects;
  const obj = objects.get(String(objectId));
  if (!obj || SKIP_TYPES.has(obj.type)) return;
  stack.add(visitKey);
  if (obj.indices && obj.indices.length) {
    emitMesh(obj.positions, obj.indices, matrix, out);
  }
  for (const comp of obj.components) {
    const childFile = comp.path ? (lookupFileKey(files, comp.path) || fileKey) : fileKey;
    const childMatrix = comp.transform ? mat4Multiply(matrix, comp.transform) : matrix;
    emitObject(files, decoded, childFile, comp.objectId, childMatrix, stack, out);
  }
  stack.delete(visitKey);
}

function flatten3mfBufferToStl(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let unzipped;
  try {
    unzipped = fflate.unzipSync(bytes);
  } catch (err) {
    throw new Error(`Failed to read 3MF zip: ${err.message || err}`);
  }
  const files = filesByPath(unzipped);
  if (!files.size) throw new Error('No .model parts found in 3MF file');

  const decoder = new TextDecoder();
  const decoded = new Map();
  for (const original of files.values()) {
    const xml = decoder.decode(unzipped[original]);
    decoded.set(original, {
      xml,
      objects: parseObjects(xml),
      items: parseBuildItems(xml)
    });
  }

  const out = new TriangleBuffer();
  const stack = new Set();
  let placed = false;
  for (const fileKey of decoded.keys()) {
    const entry = decoded.get(fileKey);
    for (const item of entry.items) {
      placed = true;
      const targetFile = item.path ? (lookupFileKey(files, item.path) || fileKey) : fileKey;
      const matrix = item.transform || mat4Identity();
      emitObject(files, decoded, targetFile, item.objectId, matrix, stack, out);
    }
  }

  if (!placed) {
    const referenced = new Set();
    for (const fileKey of decoded.keys()) {
      for (const obj of decoded.get(fileKey).objects.values()) {
        for (const comp of obj.components) {
          const childFile = comp.path ? (lookupFileKey(files, comp.path) || fileKey) : fileKey;
          referenced.add(`${childFile}::${comp.objectId}`);
        }
      }
    }
    for (const fileKey of decoded.keys()) {
      for (const objectId of decoded.get(fileKey).objects.keys()) {
        if (referenced.has(`${fileKey}::${objectId}`)) continue;
        emitObject(files, decoded, fileKey, objectId, mat4Identity(), stack, out);
      }
    }
  }

  return encodeBinaryStl(out.toArray());
}

function flatten3mfFileToStl(filePath, destPath) {
  const stl = flatten3mfBufferToStl(fs.readFileSync(filePath));
  fs.writeFileSync(destPath, stl);
  return destPath;
}

module.exports = {
  flatten3mfBufferToStl,
  flatten3mfFileToStl,
  encodeBinaryStl
};
