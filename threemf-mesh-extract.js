/**
 * Fast regex-based 3MF mesh extraction for large models (HueForge, etc.)
 * Avoids building a full DOM for millions of triangle elements.
 */

const PREVIEW_3MF_TARGET_TRIANGLES = Math.max(
  100000,
  Number.parseInt(process.env.PRINTVENTORY_PREVIEW_3MF_TARGET_TRIANGLES || '1000000', 10) || 1000000
);

const FAST_PATH_XML_BYTES = Math.max(
  512 * 1024,
  Number.parseInt(process.env.PRINTVENTORY_PREVIEW_3MF_FAST_PATH_BYTES || String(2 * 1024 * 1024), 10) || 2 * 1024 * 1024
);

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

/**
 * Extract mesh geometry with optional uniform triangle stride sampling.
 * @returns {{ positions: Float32Array, indices: Uint32Array, sourceTriangles: number, keptTriangles: number }}
 */
function extractMeshFromXml(xmlText, options = {}) {
  const stride = Math.max(1, options.stride || 1);
  const triangleStartIndex = options.triangleStartIndex || 0;

  const positions = parseVerticesFast(xmlText);
  let indices = new Uint32Array(Math.max(12, Math.floor(positions.length / 3)));
  let indexLen = 0;
  let sourceTriangles = 0;
  let keptTriangles = 0;
  let globalTri = triangleStartIndex;

  const growIndices = () => {
    const next = new Uint32Array(indices.length * 2);
    next.set(indices.subarray(0, indexLen));
    return next;
  };

  let match;
  TRIANGLE_TAG_RE.lastIndex = 0;
  while ((match = TRIANGLE_TAG_RE.exec(xmlText)) !== null) {
    if (globalTri % stride === 0) {
      const tag = match[0];
      if (indexLen + 3 > indices.length) {
        indices = growIndices();
      }
      indices[indexLen++] = parseInt(attrFromTag(tag, 'v1'), 10);
      indices[indexLen++] = parseInt(attrFromTag(tag, 'v2'), 10);
      indices[indexLen++] = parseInt(attrFromTag(tag, 'v3'), 10);
      keptTriangles++;
    }
    sourceTriangles++;
    globalTri++;
  }

  return {
    positions,
    indices: indices.subarray(0, indexLen),
    sourceTriangles,
    keptTriangles,
    nextTriangleIndex: globalTri
  };
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

  const stride = totalSourceTriangles > targetTriangles
    ? Math.ceil(totalSourceTriangles / targetTriangles)
    : 1;

  const merged = {
    positions: new Float32Array(0),
    indices: new Uint32Array(0)
  };

  let triangleStartIndex = 0;
  for (const xml of modelXmlParts) {
    const part = extractMeshFromXml(xml, { stride, triangleStartIndex });
    triangleStartIndex = part.nextTriangleIndex;
    if (part.keptTriangles > 0) {
      mergeMeshBuffers(merged, part.positions, part.indices, merged.positions.length / 3);
    }
  }

  if (merged.indices.length === 0) {
    throw new Error('No geometry data found in 3MF model');
  }

  return {
    positions: merged.positions,
    indices: merged.indices,
    sourceTriangles: totalSourceTriangles,
    keptTriangles: merged.indices.length / 3,
    simplified: stride > 1,
    stride
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

module.exports = {
  PREVIEW_3MF_TARGET_TRIANGLES,
  FAST_PATH_XML_BYTES,
  countTrianglesInXml,
  extractMeshFromXml,
  extractAllMeshesFast,
  shouldUseFastPath
};
