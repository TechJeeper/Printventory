/**
 * Fast regex-based 3MF mesh extraction for large models (HueForge, etc.)
 * Avoids building a full DOM for millions of triangle elements.
 *
 * Important: each <mesh> has its own local vertex indices. Vertices and
 * triangles must be extracted per-mesh and indices rebased before merge.
 *
 * Oversized meshes are simplified with spatial vertex clustering (not
 * triangle stride), so previews stay solid instead of shredded.
 */

const PREVIEW_3MF_TARGET_TRIANGLES = Math.max(
  100000,
  Number.parseInt(process.env.PRINTVENTORY_PREVIEW_3MF_TARGET_TRIANGLES || '1000000', 10) || 1000000
);

const FAST_PATH_XML_BYTES = Math.max(
  512 * 1024,
  Number.parseInt(process.env.PRINTVENTORY_PREVIEW_3MF_FAST_PATH_BYTES || String(2 * 1024 * 1024), 10) || 2 * 1024 * 1024
);

const MESH_BLOCK_RE = /<(?:\w+:)?mesh\b[^>]*>([\s\S]*?)<\/(?:\w+:)?mesh>/gi;
const VERTEX_TAG_RE = /<(?:\w+:)?vertex\s[^>]*\/?>/gi;
const TRIANGLE_TAG_RE = /<(?:\w+:)?triangle\s[^>]*\/?>/gi;

function attrFromTag(tag, name) {
  const re = new RegExp(`\\b${name}="([^"]*)"`, 'i');
  const m = tag.match(re);
  return m ? m[1] : '0';
}

function countTrianglesInXml(xmlText) {
  if (!xmlText) return 0;
  const matches = xmlText.match(TRIANGLE_TAG_RE);
  TRIANGLE_TAG_RE.lastIndex = 0;
  return matches ? matches.length : 0;
}

function parseVerticesFast(xmlText) {
  let positions = new Float32Array(Math.max(1024, Math.floor(xmlText.length / 80)));
  let count = 0;
  let capacity = positions.length;

  const grow = () => {
    capacity *= 2;
    const next = new Float32Array(capacity);
    next.set(positions.subarray(0, count));
    positions = next;
  };

  let match;
  VERTEX_TAG_RE.lastIndex = 0;
  while ((match = VERTEX_TAG_RE.exec(xmlText)) !== null) {
    const tag = match[0];
    if (count + 3 > capacity) grow();
    positions[count++] = parseFloat(attrFromTag(tag, 'x'));
    positions[count++] = parseFloat(attrFromTag(tag, 'y'));
    positions[count++] = parseFloat(attrFromTag(tag, 'z'));
  }

  return positions.subarray(0, count);
}

function mergeMeshBuffers(target, positions, indices, vertexOffset) {
  const basePos = target.positions.length;
  const mergedPos = new Float32Array(basePos + positions.length);
  mergedPos.set(target.positions, 0);
  mergedPos.set(positions, basePos);

  const baseIdx = target.indices.length;
  const mergedIdx = new Uint32Array(baseIdx + indices.length);
  mergedIdx.set(target.indices, 0);
  for (let i = 0; i < indices.length; i++) {
    mergedIdx[baseIdx + i] = indices[i] + vertexOffset;
  }

  target.positions = mergedPos;
  target.indices = mergedIdx;
}

function extractTrianglesFromMeshBody(meshBody) {
  let indices = new Uint32Array(Math.max(12, Math.floor(meshBody.length / 40)));
  let indexLen = 0;
  let sourceTriangles = 0;

  const growIndices = () => {
    const next = new Uint32Array(indices.length * 2);
    next.set(indices.subarray(0, indexLen));
    return next;
  };

  let match;
  TRIANGLE_TAG_RE.lastIndex = 0;
  while ((match = TRIANGLE_TAG_RE.exec(meshBody)) !== null) {
    const tag = match[0];
    if (indexLen + 3 > indices.length) {
      indices = growIndices();
    }
    indices[indexLen++] = parseInt(attrFromTag(tag, 'v1'), 10);
    indices[indexLen++] = parseInt(attrFromTag(tag, 'v2'), 10);
    indices[indexLen++] = parseInt(attrFromTag(tag, 'v3'), 10);
    sourceTriangles++;
  }

  return {
    indices: indices.subarray(0, indexLen),
    sourceTriangles,
    keptTriangles: sourceTriangles
  };
}

function listMeshBodies(xmlText) {
  const bodies = [];
  MESH_BLOCK_RE.lastIndex = 0;
  let match;
  while ((match = MESH_BLOCK_RE.exec(xmlText)) !== null) {
    bodies.push(match[1]);
  }
  if (bodies.length === 0 && countTrianglesInXml(xmlText) > 0) {
    bodies.push(xmlText);
  }
  return bodies;
}

/**
 * Extract full mesh geometry (no sampling). Processes each <mesh> separately.
 */
function extractMeshFromXml(xmlText) {
  const merged = {
    positions: new Float32Array(0),
    indices: new Uint32Array(0)
  };

  let sourceTriangles = 0;

  for (const meshBody of listMeshBodies(xmlText)) {
    const positions = parseVerticesFast(meshBody);
    if (positions.length === 0) continue;

    const tri = extractTrianglesFromMeshBody(meshBody);
    sourceTriangles += tri.sourceTriangles;

    if (tri.keptTriangles > 0) {
      mergeMeshBuffers(merged, positions, tri.indices, merged.positions.length / 3);
    }
  }

  return {
    positions: merged.positions,
    indices: merged.indices,
    sourceTriangles,
    keptTriangles: merged.indices.length / 3
  };
}

function computeBounds(positions) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Spatial vertex clustering — collapses nearby vertices into cell averages,
 * then rebuilds triangles. Looks like a lower-res solid mesh instead of holes.
 */
function clusterMesh(positions, indices, cellSize) {
  const { minX, minY, minZ, maxX, maxY, maxZ } = computeBounds(positions);
  const sx = Math.max(maxX - minX, 1e-6);
  const sy = Math.max(maxY - minY, 1e-6);
  const sz = Math.max(maxZ - minZ, 1e-6);

  // Keep grid axes balanced so thin build plates still cluster well on Z
  const invX = 1 / cellSize;
  const invY = 1 / cellSize;
  const invZ = 1 / Math.max(cellSize * 0.35, Math.min(cellSize, sz / 64));

  const dimX = Math.max(1, Math.ceil(sx * invX) + 1);
  const dimY = Math.max(1, Math.ceil(sy * invY) + 1);

  const vertCount = positions.length / 3;
  const remap = new Int32Array(vertCount);
  const cellIndex = new Map();
  const sums = [];

  for (let i = 0; i < vertCount; i++) {
    const ox = i * 3;
    const x = positions[ox];
    const y = positions[ox + 1];
    const z = positions[ox + 2];
    const cx = Math.min(dimX - 1, Math.max(0, Math.floor((x - minX) * invX)));
    const cy = Math.min(dimY - 1, Math.max(0, Math.floor((y - minY) * invY)));
    const cz = Math.max(0, Math.floor((z - minZ) * invZ));
    const key = cx + cy * dimX + cz * dimX * dimY;

    let newIdx = cellIndex.get(key);
    if (newIdx === undefined) {
      newIdx = sums.length / 4;
      cellIndex.set(key, newIdx);
      sums.push(x, y, z, 1);
    } else {
      const base = newIdx * 4;
      sums[base] += x;
      sums[base + 1] += y;
      sums[base + 2] += z;
      sums[base + 3] += 1;
    }
    remap[i] = newIdx;
  }

  const newVertCount = sums.length / 4;
  const newPositions = new Float32Array(newVertCount * 3);
  for (let i = 0; i < newVertCount; i++) {
    const base = i * 4;
    const n = sums[base + 3] || 1;
    const po = i * 3;
    newPositions[po] = sums[base] / n;
    newPositions[po + 1] = sums[base + 1] / n;
    newPositions[po + 2] = sums[base + 2] / n;
  }

  const triCount = indices.length / 3;
  let out = new Uint32Array(Math.min(indices.length, Math.max(12, Math.floor(triCount * 1.1) * 3)));
  let outLen = 0;
  const seen = new Set();

  const pushTri = (a, b, c) => {
    if (outLen + 3 > out.length) {
      const next = new Uint32Array(out.length * 2);
      next.set(out.subarray(0, outLen));
      out = next;
    }
    out[outLen++] = a;
    out[outLen++] = b;
    out[outLen++] = c;
  };

  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    let a = remap[indices[base]];
    let b = remap[indices[base + 1]];
    let c = remap[indices[base + 2]];
    if (a === b || b === c || a === c) continue;

    // Canonical order for duplicate detection (keep winding via original order)
    let i0 = a;
    let i1 = b;
    let i2 = c;
    if (i0 > i1) { const tmp = i0; i0 = i1; i1 = tmp; }
    if (i1 > i2) { const tmp = i1; i1 = i2; i2 = tmp; }
    if (i0 > i1) { const tmp = i0; i0 = i1; i1 = tmp; }
    const dupKey = i0 + ',' + i1 + ',' + i2;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    pushTri(a, b, c);
  }

  return {
    positions: newPositions,
    indices: out.subarray(0, outLen)
  };
}

/**
 * Reduce mesh to roughly targetTriangles with solid surfaces.
 */
function simplifyForPreview(positions, indices, targetTriangles = PREVIEW_3MF_TARGET_TRIANGLES) {
  const sourceTriangles = indices.length / 3;
  if (sourceTriangles <= targetTriangles || sourceTriangles === 0) {
    return {
      positions,
      indices,
      sourceTriangles,
      keptTriangles: sourceTriangles,
      simplified: false
    };
  }

  const { minX, minY, minZ, maxX, maxY, maxZ } = computeBounds(positions);
  const sx = Math.max(maxX - minX, 1e-6);
  const sy = Math.max(maxY - minY, 1e-6);
  const sz = Math.max(maxZ - minZ, 1e-6);
  const longest = Math.max(sx, sy, sz);

  // Aim a bit under target so one pass usually lands close
  const goal = Math.max(1000, Math.floor(targetTriangles * 0.92));
  let cellSize = longest / Math.cbrt(Math.max(goal * 0.55, 8));

  let best = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const clustered = clusterMesh(positions, indices, cellSize);
    const kept = clustered.indices.length / 3;
    best = clustered;

    if (kept <= targetTriangles && kept >= goal * 0.35) break;
    if (kept === 0) {
      cellSize *= 0.7;
      continue;
    }
    if (kept > targetTriangles) {
      cellSize *= Math.cbrt(kept / goal) * 1.05;
    } else {
      // Too aggressive — refine a bit
      cellSize *= Math.cbrt(kept / goal) * 0.92;
    }
  }

  if (!best || best.indices.length === 0) {
    return {
      positions,
      indices,
      sourceTriangles,
      keptTriangles: sourceTriangles,
      simplified: false
    };
  }

  return {
    positions: best.positions,
    indices: best.indices,
    sourceTriangles,
    keptTriangles: best.indices.length / 3,
    simplified: true
  };
}

/**
 * Extract all mesh geometry from 3MF model XML parts using the fast text path.
 */
function extractAllMeshesFast(modelXmlParts, targetTriangles = PREVIEW_3MF_TARGET_TRIANGLES) {
  let totalSourceTriangles = 0;
  for (const xml of modelXmlParts) {
    totalSourceTriangles += countTrianglesInXml(xml);
  }

  if (totalSourceTriangles === 0) {
    throw new Error('No geometry data found in 3MF model');
  }

  const merged = {
    positions: new Float32Array(0),
    indices: new Uint32Array(0)
  };

  for (const xml of modelXmlParts) {
    const part = extractMeshFromXml(xml);
    if (part.keptTriangles > 0) {
      mergeMeshBuffers(merged, part.positions, part.indices, merged.positions.length / 3);
    }
  }

  if (merged.indices.length === 0) {
    throw new Error('No geometry data found in 3MF model');
  }

  const simplified = simplifyForPreview(merged.positions, merged.indices, targetTriangles);

  return {
    positions: simplified.positions,
    indices: simplified.indices,
    sourceTriangles: totalSourceTriangles,
    keptTriangles: simplified.keptTriangles,
    simplified: simplified.simplified
  };
}

function shouldUseFastPath(modelXmlParts) {
  let totalBytes = 0;
  let totalTriangles = 0;
  for (const xml of modelXmlParts) {
    totalBytes += xml.length;
    totalTriangles += countTrianglesInXml(xml);
    if (totalBytes > FAST_PATH_XML_BYTES || totalTriangles > PREVIEW_3MF_TARGET_TRIANGLES) {
      return true;
    }
  }
  return false;
}

/** True when build items or components carry placement transforms. */
function modelHasPlacementTransforms(modelXmlParts) {
  const itemOrComponent = /<(?:\w+:)?(?:item|component)\b[^>]*\btransform\s*=\s*"/i;
  for (const xml of modelXmlParts) {
    if (xml && itemOrComponent.test(xml)) return true;
  }
  return false;
}

module.exports = {
  PREVIEW_3MF_TARGET_TRIANGLES,
  FAST_PATH_XML_BYTES,
  countTrianglesInXml,
  extractMeshFromXml,
  extractAllMeshesFast,
  simplifyForPreview,
  shouldUseFastPath,
  modelHasPlacementTransforms
};
