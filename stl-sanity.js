'use strict';

const MAX_STL_TRIANGLES = 10000000;

function stlBytes(buffer) {
  if (!buffer) return null;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  return null;
}

function looksLikeAsciiStl(buffer) {
  const bytesAll = stlBytes(buffer);
  if (!bytesAll || bytesAll.byteLength < 15) return false;
  const n = Math.min(bytesAll.byteLength, 512);
  const bytes = bytesAll.subarray(0, n);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return false;
  let printable = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
  }
  if (printable / bytes.length < 0.9) return false;
  const head = new TextDecoder('utf-8').decode(bytes).trimStart().toLowerCase();
  return head.startsWith('solid') || head.includes('facet') || head.includes('vertex');
}

/**
 * Reject buffers whose binary STL header would allocate far more memory than the file holds.
 * PNG previews misnamed as .stl fail here instead of inside the loader.
 * Returns 'binary', 'ascii', or throws.
 */
function classifyStlBuffer(buffer) {
  const bytes = stlBytes(buffer);
  if (!bytes || bytes.byteLength < 15) {
    throw new Error('STL file too small to be valid');
  }
  if (bytes.byteLength >= 84) {
    const triangleCount = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    const expectedBinarySize = 84 + triangleCount * 50;
    const fitsFile = triangleCount > 0
      && triangleCount <= MAX_STL_TRIANGLES
      && expectedBinarySize <= bytes.byteLength + 4096
      && bytes.byteLength - expectedBinarySize <= 4096
      && bytes.byteLength - expectedBinarySize >= 0;
    if (fitsFile) return 'binary';
    const claimsMoreThanFile = triangleCount > MAX_STL_TRIANGLES
      || expectedBinarySize > bytes.byteLength + 64;
    if (claimsMoreThanFile && !looksLikeAsciiStl(bytes)) {
      throw new Error('STL header does not match the file size');
    }
  }
  if (!looksLikeAsciiStl(bytes) && bytes.byteLength < 84) {
    throw new Error('STL file too small to be valid');
  }
  return 'ascii';
}

/**
 * Force path: a lying triangle count must not allocate a huge mesh.
 * When the byte length is an exact binary STL, rewrite the count to match the file.
 * Otherwise return the original buffer so the loader can try ASCII.
 */
function stlBufferIgnoringHeaderMismatch(buffer) {
  const bytes = stlBytes(buffer);
  if (!bytes) return buffer;
  try {
    if (classifyStlBuffer(bytes) === 'binary') {
      const triangleCount = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
      const expected = 84 + triangleCount * 50;
      if (bytes.byteLength === expected) return buffer;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + expected);
    }
    return buffer;
  } catch (err) {
    if (!/does not match the file size/i.test(err && err.message)) throw err;
    const body = bytes.byteLength - 84;
    if (bytes.byteLength >= 84 && body > 0 && body % 50 === 0) {
      const faces = body / 50;
      if (faces > 0 && faces <= MAX_STL_TRIANGLES) {
        const copy = new Uint8Array(bytes);
        new DataView(copy.buffer).setUint32(80, faces, true);
        return copy.buffer;
      }
    }
    return buffer;
  }
}

/**
 * True when every sampled vertex normal is missing or zero.
 * Lit materials then shade the whole mesh as one flat color (a silhouette).
 */
function normalsAreMissing(normals) {
  if (!normals || normals.length < 3) return true;
  const count = (normals.length / 3) | 0;
  const samples = count < 64 ? count : 64;
  const step = Math.max(1, Math.floor(count / samples));
  for (let i = 0; i < count; i += step) {
    const o = i * 3;
    const x = normals[o];
    const y = normals[o + 1];
    const z = normals[o + 2];
    if (x * x + y * y + z * z > 1e-20) return false;
  }
  return true;
}

/**
 * Some exporters write (0,0,0) face normals into binary and ASCII STLs.
 * Recompute only those faces from the vertex winding and leave real normals alone.
 * `positions` and `normals` are non-indexed triangles (9 floats per face).
 * Returns how many faces were repaired.
 */
function repairZeroFaceNormals(positions, normals) {
  if (!positions || !normals || positions.length < 9 || normals.length < positions.length) return 0;
  const faceCount = (positions.length / 9) | 0;
  let repaired = 0;
  for (let face = 0; face < faceCount; face++) {
    const base = face * 9;
    const nx = normals[base];
    const ny = normals[base + 1];
    const nz = normals[base + 2];
    if (nx * nx + ny * ny + nz * nz > 1e-20) continue;

    const e1x = positions[base + 3] - positions[base];
    const e1y = positions[base + 4] - positions[base + 1];
    const e1z = positions[base + 5] - positions[base + 2];
    const e2x = positions[base + 6] - positions[base];
    const e2y = positions[base + 7] - positions[base + 1];
    const e2z = positions[base + 8] - positions[base + 2];
    let cx = e1y * e2z - e1z * e2y;
    let cy = e1z * e2x - e1x * e2z;
    let cz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (len < 1e-20) continue;
    cx /= len;
    cy /= len;
    cz /= len;
    for (let v = 0; v < 3; v++) {
      const o = base + v * 3;
      normals[o] = cx;
      normals[o + 1] = cy;
      normals[o + 2] = cz;
    }
    repaired++;
  }
  return repaired;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAX_STL_TRIANGLES,
    looksLikeAsciiStl,
    classifyStlBuffer,
    stlBufferIgnoringHeaderMismatch,
    normalsAreMissing,
    repairZeroFaceNormals
  };
}
