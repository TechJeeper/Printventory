/**
 * Simplified 3MF Loader bundled directly in app
 * Uses fflate for ZIP decompression; fast regex path for dense models (HueForge, etc.)
 */

const fflate = require('fflate');
const {
  PREVIEW_3MF_TARGET_TRIANGLES,
  extractAllMeshesFast,
  countMeshesInXmlParts,
  simplifyForPreview,
  shouldUseFastPath,
  modelHasPlacementTransforms
} = require('./threemf-mesh-extract.js');

const SKIP_PART_SUBTYPES = new Set([
  'negative_volume',
  'negativevolume',
  'negative_part',
  'negativepart',
  'negative',
  'modifier',
  'parameter_modifier',
  'support',
  'support_enforcer',
  'support_blocker',
  'fuzzy_skin_block'
]);

const SKIP_OBJECT_TYPES = new Set([
  'solidsupport',
  'support'
]);

function normalizeSubtype(value) {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function isSkippedSubtype(value) {
  const normalized = normalizeSubtype(value);
  return SKIP_PART_SUBTYPES.has(normalized) || SKIP_PART_SUBTYPES.has(String(value || '').toLowerCase());
}

function isNegativeObjectName(name) {
  return /negative(\s|_|-)*volume|negative(\s|_|-)*part|^negative$/i.test(String(name || ''));
}

function normalizeModelPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\//, '');
}

function collectSlicerSkipIds(unzipped) {
  const skip = new Set();
  if (!unzipped) return skip;
  const decoder = new TextDecoder();
  for (const key of Object.keys(unzipped)) {
    if (!/(model_settings|slice_info)\.config$/i.test(key)) continue;
    let xml = '';
    try {
      xml = decoder.decode(unzipped[key]);
    } catch (_) {
      continue;
    }
    const tagRe = /<(?:part|object|metadata)\b[^>]*>/gi;
    let match;
    while ((match = tagRe.exec(xml))) {
      const tag = match[0];
      const id = /\bid\s*=\s*"([^"]+)"/i.exec(tag);
      const subtype = /\bsubtype\s*=\s*"([^"]+)"/i.exec(tag);
      const volumeType = /\b(?:volume_type|volume-type)\s*=\s*"([^"]+)"/i.exec(tag)
        || /\bkey\s*=\s*"volume_type"[^>]*\bvalue\s*=\s*"([^"]+)"/i.exec(tag)
        || /\bvalue\s*=\s*"([^"]+)"[^>]*\bkey\s*=\s*"volume_type"/i.exec(tag);
      const name = /\b(?:name|key)\s*=\s*"name"[^>]*\bvalue\s*=\s*"([^"]+)"/i.exec(tag)
        || /\bname\s*=\s*"([^"]+)"/i.exec(tag);
      const shouldSkip = (subtype && isSkippedSubtype(subtype[1]))
        || (volumeType && isSkippedSubtype(volumeType[1]))
        || (name && isNegativeObjectName(name[1]));
      if (shouldSkip && id) skip.add(String(id[1]));
    }
  }
  return skip;
}

function objectTypeOf(node) {
  if (!node || !node.attributes) return 'model';
  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes[i];
    if (attr.localName === 'type' || attr.name === 'type') {
      return String(attr.value || 'model').toLowerCase();
    }
  }
  return 'model';
}

/** Identity 4x4 matrix, column-major (THREE.Matrix4 layout). */
function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);
}

/**
 * Parse 3MF transform="a b c d e f g h i tx ty tz" into a column-major 4x4
 * matching THREE.3MFLoader / the 3MF spec.
 */
function parseTransformAttr(transform) {
  if (!transform || typeof transform !== 'string') return null;
  const t = transform.trim().split(/\s+/).map(parseFloat);
  if (t.length < 12 || t.some(n => Number.isNaN(n))) return null;
  // THREE.Matrix4.set(n11,n12,n13,n14, n21,...) then .elements is column-major
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

function mat4ApplyPoint(m, x, y, z) {
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14]
  };
}

function isIdentityMatrix(m) {
  if (!m) return true;
  const id = mat4Identity();
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i] - id[i]) > 1e-8) return false;
  }
  return true;
}

class GrowableFloat32Array {
  constructor(initialCapacity = 4096) {
    this.capacity = initialCapacity;
    this.array = new Float32Array(initialCapacity);
    this.length = 0;
  }

  push3(x, y, z) {
    if (this.length + 3 > this.capacity) {
      while (this.length + 3 > this.capacity) this.capacity *= 2;
      const next = new Float32Array(this.capacity);
      next.set(this.array.subarray(0, this.length));
      this.array = next;
    }
    this.array[this.length++] = x;
    this.array[this.length++] = y;
    this.array[this.length++] = z;
  }

  toArray() {
    return this.array.subarray(0, this.length);
  }
}

class GrowableUint32Array {
  constructor(initialCapacity = 4096) {
    this.capacity = initialCapacity;
    this.array = new Uint32Array(initialCapacity);
    this.length = 0;
  }

  push3(a, b, c) {
    if (this.length + 3 > this.capacity) {
      while (this.length + 3 > this.capacity) this.capacity *= 2;
      const next = new Uint32Array(this.capacity);
      next.set(this.array.subarray(0, this.length));
      this.array = next;
    }
    this.array[this.length++] = a;
    this.array[this.length++] = b;
    this.array[this.length++] = c;
  }

  toArray() {
    return this.array.subarray(0, this.length);
  }
}

class Simple3MFLoader {
  constructor(options = {}) {
    this.targetTriangles = options.targetTriangles || PREVIEW_3MF_TARGET_TRIANGLES;
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
  }

  postStatus(message) {
    if (this.onStatus) this.onStatus(message);
  }

  parse(data) {
    try {
      const uint8Array = new Uint8Array(data);
      const unzipped = fflate.unzipSync(uint8Array);
      const zipKeys = Object.keys(unzipped);
      console.log('3MF zip entries:', zipKeys.length);

      const modelEntries = zipKeys.filter(k => k.toLowerCase().endsWith('.model'));
      if (modelEntries.length === 0) {
        throw new Error('No .model parts found in 3MF file');
      }

      const textDecoder = new TextDecoder();
      const modelXmlParts = modelEntries.map(path => textDecoder.decode(unzipped[path]));

      // Fast path skips build/item transforms and object types — only safe for a
      // single dense mesh (HueForge). Multi-part plates and negative volumes
      // must go through the DOM path so helpers are dropped and parts are placed.
      const hasPlacement = modelHasPlacementTransforms(modelXmlParts);
      const meshCount = countMeshesInXmlParts(modelXmlParts);
      if (shouldUseFastPath(modelXmlParts) && !hasPlacement && meshCount <= 1) {
        this.postStatus('Large model detected — building simplified preview...');
        const fast = extractAllMeshesFast(modelXmlParts, this.targetTriangles);
        if (fast.simplified) {
          this.postStatus(
            `Simplified preview: ${fast.keptTriangles.toLocaleString('en-US')} of ` +
            `${fast.sourceTriangles.toLocaleString('en-US')} triangles`
          );
        }
        return this.buildThreeObject(fast.positions, fast.indices, {
          simplified: fast.simplified,
          sourceTriangles: fast.sourceTriangles,
          keptTriangles: fast.keptTriangles
        });
      }

      if (hasPlacement && shouldUseFastPath(modelXmlParts)) {
        this.postStatus('Multi-part model — placing parts for preview...');
      }

      return this.parseWithDom(modelXmlParts, modelEntries, unzipped);
    } catch (error) {
      if (error && error.message && (
        error.message.includes('No geometry') ||
        error.message.includes('No mesh') ||
        error.message.includes('No .model')
      )) {
        throw error;
      }
      throw new Error(`Failed to parse 3MF: ${error.message}`);
    }
  }

  parseWithDom(modelXmlParts, modelEntries, unzipped) {
    const parser = new (require('xmldom').DOMParser)();
    const textDecoder = new TextDecoder();
    const modelDocs = modelEntries.map((path, i) => {
      const xmlDoc = parser.parseFromString(modelXmlParts[i], 'text/xml');
      return { path, xmlDoc };
    });

    const skipIds = collectSlicerSkipIds(unzipped);

    const relsPath = '3D/_rels/3dmodel.model.rels';
    let relsMap = new Map();
    if (unzipped[relsPath]) {
      try {
        const relsDoc = parser.parseFromString(textDecoder.decode(unzipped[relsPath]), 'text/xml');
        const relNodes = relsDoc.getElementsByTagName('Relationship') || [];
        for (let i = 0; i < relNodes.length; i++) {
          const rel = relNodes[i];
          const id = rel.getAttribute('Id') || rel.getAttribute('id');
          const target = rel.getAttribute('Target') || rel.getAttribute('target');
          if (id && target) {
            relsMap.set(id, target.replace(/^\//, ''));
          }
        }
      } catch (e) {
        console.log('Failed to parse rels:', e.message);
      }
    }

    const findByLocalName = (root, localName) => {
      const results = [];
      const stack = [root];
      while (stack.length) {
        const node = stack.pop();
        if (node && node.nodeType === 1) {
          if (node.localName === localName) results.push(node);
          if (node.childNodes) {
            for (let i = 0; i < node.childNodes.length; i++) stack.push(node.childNodes[i]);
          }
        }
      }
      return results;
    };

    let meshInstances = [];
    const objectMap = new Map();
    const buildItemsAll = [];

    for (const { path, xmlDoc } of modelDocs) {
      let resourcesNode = xmlDoc.getElementsByTagName('resources')[0];
      if (!resourcesNode) resourcesNode = xmlDoc.getElementsByTagNameNS('*', 'resources')[0];
      if (!resourcesNode) {
        const resByLocalName = findByLocalName(xmlDoc.documentElement, 'resources');
        if (resByLocalName && resByLocalName.length > 0) resourcesNode = resByLocalName[0];
      }
      if (!resourcesNode) continue;

      let objectNodes = resourcesNode.getElementsByTagName('object');
      if (!objectNodes || objectNodes.length === 0) objectNodes = resourcesNode.getElementsByTagNameNS('*', 'object');
      if (!objectNodes || objectNodes.length === 0) objectNodes = findByLocalName(resourcesNode, 'object');
      if (objectNodes && objectNodes.length > 0) {
        for (let i = 0; i < objectNodes.length; i++) {
          const objNode = objectNodes[i];
          const objId = objNode.getAttribute('id');
          if (objId) {
            const normalizedPath = normalizeModelPath(path);
            objectMap.set(`${normalizedPath}::${objId}`, { node: objNode, path: normalizedPath });
          }
        }
      }
      const items = findByLocalName(xmlDoc.documentElement, 'item') || [];
      for (const item of items) buildItemsAll.push({ item, path });
    }

    const getAttr = (node, name) => {
      if (!node || !node.attributes) return null;
      for (let i = 0; i < node.attributes.length; i++) {
        const a = node.attributes[i];
        if (a.name === name || a.localName === name) return a.value;
      }
      return null;
    };

    const resolveObjectEntry = (objId, modelPath) => {
      const wantedId = String(objId);
      const exact = objectMap.get(`${normalizeModelPath(modelPath)}::${wantedId}`);
      if (exact) return exact;
      const wantedPath = normalizeModelPath(modelPath).toLowerCase();
      const wantedBase = wantedPath.split('/').pop();
      let idOnly = null;
      let idOnlyCount = 0;
      for (const [key, entry] of objectMap.entries()) {
        const sep = key.lastIndexOf('::');
        const path = sep >= 0 ? key.slice(0, sep) : key;
        const id = sep >= 0 ? key.slice(sep + 2) : '';
        if (id !== wantedId) continue;
        const normalized = normalizeModelPath(path).toLowerCase();
        if (normalized === wantedPath || normalized.endsWith(`/${wantedBase}`) || normalized === wantedBase) {
          return entry;
        }
        idOnly = entry;
        idOnlyCount += 1;
      }
      return idOnlyCount === 1 ? idOnly : null;
    };

    const shouldSkipObject = (objId, node) => {
      if (skipIds.has(String(objId))) return true;
      if (SKIP_OBJECT_TYPES.has(objectTypeOf(node))) return true;
      const name = getAttr(node, 'name') || getAttr(node, 'partnumber');
      return isNegativeObjectName(name);
    };

    const collectMeshesFromObject = (objId, modelPath, parentMatrix, visited = new Set(), partInfo = null) => {
      if (!objId || !modelPath) return;
      const entry = resolveObjectEntry(objId, modelPath);
      if (!entry) return;
      const key = `${entry.path}::${objId}`;
      if (visited.has(key)) return;
      visited.add(key);
      if (shouldSkipObject(objId, entry.node)) return;

      const meshesInObj = findByLocalName(entry.node, 'mesh');
      // Prefer leaf mesh objects; composites are usually component-only.
      if (meshesInObj && meshesInObj.length > 0) {
        const objectName = getAttr(entry.node, 'name') || getAttr(entry.node, 'partnumber');
        for (let i = 0; i < meshesInObj.length; i++) {
          meshInstances.push({
            meshNode: meshesInObj[i],
            matrix: parentMatrix,
            partId: partInfo && partInfo.partId,
            objectId: objId,
            name: (partInfo && partInfo.name) || objectName
          });
        }
        return;
      }

      const componentNodes = findByLocalName(entry.node, 'component');
      if (componentNodes && componentNodes.length > 0) {
        for (const comp of componentNodes) {
          let refId = getAttr(comp, 'objectid') || getAttr(comp, 'objectId') || getAttr(comp, 'object');
          if (!refId) refId = getAttr(comp, 'p:objectid') || getAttr(comp, 'p:objectId');
          let refPath = getAttr(comp, 'path') || getAttr(comp, 'p:path');
          const rid = getAttr(comp, 'p:pid') || getAttr(comp, 'pid') || getAttr(comp, 'p:rid') || getAttr(comp, 'rid');
          if (!refPath && rid && relsMap.has(rid)) refPath = relsMap.get(rid);
          const targetPath = refPath ? normalizeModelPath(refPath) : entry.path;
          const compTransform = parseTransformAttr(getAttr(comp, 'transform'));
          const childMatrix = compTransform ? mat4Multiply(parentMatrix, compTransform) : parentMatrix;
          if (refId) collectMeshesFromObject(refId, targetPath, childMatrix, new Set(visited), partInfo);
        }
      }
    };

    for (let itemIndex = 0; itemIndex < buildItemsAll.length; itemIndex++) {
      const { item, path } = buildItemsAll[itemIndex];
      if (getAttr(item, 'printable') === '0') continue;
      const targetId = getAttr(item, 'objectid') || getAttr(item, 'objectId') || getAttr(item, 'pid') || getAttr(item, 'object');
      let targetPath = getAttr(item, 'path') || getAttr(item, 'p:path');
      if (!targetPath) {
        const rid = getAttr(item, 'p:pid') || getAttr(item, 'pid');
        if (rid && relsMap.has(rid)) targetPath = relsMap.get(rid);
      }
      targetPath = targetPath ? normalizeModelPath(targetPath) : path;
      const itemTransform = parseTransformAttr(getAttr(item, 'transform'));
      const itemMatrix = itemTransform || mat4Identity();
      const itemName = getAttr(item, 'partnumber') || getAttr(item, 'name');
      collectMeshesFromObject(targetId, targetPath, itemMatrix, new Set(), {
        partId: `item-${itemIndex}`,
        name: itemName
      });
    }

    if (meshInstances.length === 0 && objectMap.size > 0) {
      let objectIndex = 0;
      for (const key of objectMap.keys()) {
        const sep = key.lastIndexOf('::');
        const modelPath = sep >= 0 ? key.slice(0, sep) : key;
        const objId = sep >= 0 ? key.slice(sep + 2) : '';
        collectMeshesFromObject(objId, modelPath, mat4Identity(), new Set(), {
          partId: `object-${objectIndex++}`
        });
      }
    }

    if (!meshInstances || meshInstances.length === 0) {
      throw new Error('No mesh found in 3MF model');
    }

    let totalSourceTriangles = 0;
    for (let m = 0; m < meshInstances.length; m++) {
      const meshNode = meshInstances[m].meshNode;
      let trianglesNode = meshNode.getElementsByTagName('triangles')[0];
      if (!trianglesNode) trianglesNode = meshNode.getElementsByTagNameNS('*', 'triangles')[0];
      if (trianglesNode) {
        let triangleNodes = trianglesNode.getElementsByTagName('triangle');
        if (!triangleNodes || triangleNodes.length === 0) {
          triangleNodes = trianglesNode.getElementsByTagNameNS('*', 'triangle');
        }
        totalSourceTriangles += triangleNodes ? triangleNodes.length : 0;
      }
    }

    const needsSimplify = totalSourceTriangles > this.targetTriangles;
    if (needsSimplify) {
      this.postStatus(
        `Simplifying preview: ${totalSourceTriangles.toLocaleString('en-US')} triangles → solid LOD`
      );
    }

    const partBuffers = new Map();
    for (let m = 0; m < meshInstances.length; m++) {
      const extracted = this.extractTransformedMesh(meshInstances[m]);
      if (!extracted) continue;
      const partId = meshInstances[m].partId || `mesh-${m}`;
      const name = meshInstances[m].name || '';
      if (!partBuffers.has(partId)) {
        partBuffers.set(partId, {
          id: partId,
          name,
          positions: new GrowableFloat32Array(),
          indices: new GrowableUint32Array(),
          vertices: 0
        });
      }
      const part = partBuffers.get(partId);
      if (!part.name && name) part.name = name;
      const offset = part.vertices;
      for (let i = 0; i < extracted.positions.length; i += 3) {
        part.positions.push3(
          extracted.positions[i],
          extracted.positions[i + 1],
          extracted.positions[i + 2]
        );
      }
      for (let i = 0; i < extracted.indices.length; i += 3) {
        part.indices.push3(
          extracted.indices[i] + offset,
          extracted.indices[i + 1] + offset,
          extracted.indices[i + 2] + offset
        );
      }
      part.vertices += extracted.positions.length / 3;
    }

    const parts = [];
    const usedNames = new Map();
    let partIndex = 0;
    for (const part of partBuffers.values()) {
      if (part.positions.length === 0 || part.indices.length === 0) continue;
      partIndex += 1;
      const simplified = simplifyForPreview(
        part.positions.toArray(),
        part.indices.toArray(),
        this.targetTriangles
      );
      let name = part.name || `Part ${partIndex}`;
      const seen = (usedNames.get(name) || 0) + 1;
      usedNames.set(name, seen);
      if (seen > 1) name = `${name} ${seen}`;
      parts.push({
        id: part.id,
        name,
        positions: simplified.positions,
        indices: simplified.indices,
        simplified: simplified.simplified,
        sourceTriangles: simplified.sourceTriangles,
        keptTriangles: simplified.keptTriangles
      });
    }

    if (!parts.length) {
      throw new Error('No geometry data found in 3MF model');
    }

    const sourceTriangles = parts.reduce((sum, part) => sum + (part.sourceTriangles || 0), 0);
    const keptTriangles = parts.reduce((sum, part) => sum + (part.keptTriangles || 0), 0);
    const simplified = parts.some((part) => part.simplified);
    if (simplified) {
      this.postStatus(
        `Simplified preview: ${keptTriangles.toLocaleString('en-US')} of ` +
        `${sourceTriangles.toLocaleString('en-US')} triangles`
      );
    }

    return this.buildFromParts(parts, {
      simplified,
      sourceTriangles,
      keptTriangles
    });
  }

  extractTransformedMesh(instance) {
    const { meshNode, matrix } = instance || {};
    if (!meshNode) return null;
    const applyTransform = !isIdentityMatrix(matrix);
    let verticesNode = meshNode.getElementsByTagName('vertices')[0];
    if (!verticesNode) verticesNode = meshNode.getElementsByTagNameNS('*', 'vertices')[0];
    if (!verticesNode) return null;
    let vertexNodes = verticesNode.getElementsByTagName('vertex');
    if (!vertexNodes || vertexNodes.length === 0) {
      vertexNodes = verticesNode.getElementsByTagNameNS('*', 'vertex');
    }
    if (!vertexNodes.length) return null;

    const positions = new Float32Array(vertexNodes.length * 3);
    for (let i = 0; i < vertexNodes.length; i++) {
      const v = vertexNodes[i];
      const x = parseFloat(v.getAttribute('x') || 0);
      const y = parseFloat(v.getAttribute('y') || 0);
      const z = parseFloat(v.getAttribute('z') || 0);
      if (applyTransform) {
        const p = mat4ApplyPoint(matrix, x, y, z);
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;
      } else {
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
      }
    }

    let trianglesNode = meshNode.getElementsByTagName('triangles')[0];
    if (!trianglesNode) trianglesNode = meshNode.getElementsByTagNameNS('*', 'triangles')[0];
    if (!trianglesNode) return null;
    let triangleNodes = trianglesNode.getElementsByTagName('triangle');
    if (!triangleNodes || triangleNodes.length === 0) {
      triangleNodes = trianglesNode.getElementsByTagNameNS('*', 'triangle');
    }
    const indices = new Uint32Array(triangleNodes.length * 3);
    for (let i = 0; i < triangleNodes.length; i++) {
      const t = triangleNodes[i];
      indices[i * 3] = parseInt(t.getAttribute('v1') || 0, 10);
      indices[i * 3 + 1] = parseInt(t.getAttribute('v2') || 0, 10);
      indices[i * 3 + 2] = parseInt(t.getAttribute('v3') || 0, 10);
    }
    return { positions, indices };
  }

  makeGeometryJson(positions, indices) {
    const vertexCount = positions.length / 3;
    const triangleCount = indices.length / 3;
    const normals = new Float32Array(vertexCount * 3);

    for (let i = 0; i < triangleCount; i++) {
      const base = i * 3;
      const i1 = indices[base];
      const i2 = indices[base + 1];
      const i3 = indices[base + 2];
      const p1 = i1 * 3;
      const p2 = i2 * 3;
      const p3 = i3 * 3;
      const e1x = positions[p2] - positions[p1];
      const e1y = positions[p2 + 1] - positions[p1 + 1];
      const e1z = positions[p2 + 2] - positions[p1 + 2];
      const e2x = positions[p3] - positions[p1];
      const e2y = positions[p3 + 1] - positions[p1 + 1];
      const e2z = positions[p3 + 2] - positions[p1 + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      normals[p1] += nx;
      normals[p1 + 1] += ny;
      normals[p1 + 2] += nz;
      normals[p2] += nx;
      normals[p2 + 1] += ny;
      normals[p2 + 2] += nz;
      normals[p3] += nx;
      normals[p3 + 1] += ny;
      normals[p3 + 2] += nz;
    }
    for (let i = 0; i < vertexCount; i++) {
      const idx = i * 3;
      const length = Math.sqrt(
        normals[idx] * normals[idx] +
        normals[idx + 1] * normals[idx + 1] +
        normals[idx + 2] * normals[idx + 2]
      );
      if (length > 0) {
        normals[idx] /= length;
        normals[idx + 1] /= length;
        normals[idx + 2] /= length;
      }
    }

    const uuid = this.generateUUID();
    return {
      triangleCount,
      geometry: {
        uuid,
        type: 'BufferGeometry',
        data: {
          attributes: {
            position: { itemSize: 3, type: 'Float32Array', array: positions },
            normal: { itemSize: 3, type: 'Float32Array', array: normals }
          },
          index: { type: 'Uint32Array', array: indices }
        }
      }
    };
  }

  buildFromParts(parts, previewMeta = {}) {
    if (parts.length === 1) {
      return this.buildThreeObject(parts[0].positions, parts[0].indices, {
        ...previewMeta,
        sourceTriangles: parts[0].sourceTriangles,
        keptTriangles: parts[0].keptTriangles,
        simplified: parts[0].simplified
      });
    }

    const matUuid = this.generateUUID();
    const geometries = [];
    const children = [];
    parts.forEach((part, index) => {
      const built = this.makeGeometryJson(part.positions, part.indices);
      geometries.push(built.geometry);
      children.push({
        uuid: this.generateUUID(),
        type: 'Mesh',
        name: part.name || `Part ${index + 1}`,
        geometry: built.geometry.uuid,
        material: matUuid,
        userData: {
          previewPart: true,
          previewPartId: String(part.id || index)
        }
      });
    });

    return {
      metadata: {
        version: 4.5,
        type: 'Object',
        generator: 'Simple3MFLoader',
        previewSimplified: Boolean(previewMeta.simplified),
        sourceTriangles: previewMeta.sourceTriangles || 0,
        keptTriangles: previewMeta.keptTriangles || 0,
        previewPartCount: parts.length
      },
      geometries,
      materials: [{
        uuid: matUuid,
        type: 'MeshStandardMaterial',
        color: 0xcccccc,
        metalness: 0.2,
        roughness: 0.7,
        side: 2
      }],
      object: {
        uuid: this.generateUUID(),
        type: 'Group',
        name: '3MF',
        children
      }
    };
  }

  buildThreeObject(positions, indices, previewMeta = {}) {
    const vertexCount = positions.length / 3;
    const triangleCount = indices.length / 3;
    const normals = new Float32Array(vertexCount * 3);

    for (let i = 0; i < triangleCount; i++) {
      const base = i * 3;
      const i1 = indices[base];
      const i2 = indices[base + 1];
      const i3 = indices[base + 2];
      const p1 = i1 * 3;
      const p2 = i2 * 3;
      const p3 = i3 * 3;

      const v1x = positions[p1];
      const v1y = positions[p1 + 1];
      const v1z = positions[p1 + 2];
      const v2x = positions[p2];
      const v2y = positions[p2 + 1];
      const v2z = positions[p2 + 2];
      const v3x = positions[p3];
      const v3y = positions[p3 + 1];
      const v3z = positions[p3 + 2];

      const e1x = v2x - v1x;
      const e1y = v2y - v1y;
      const e1z = v2z - v1z;
      const e2x = v3x - v1x;
      const e2y = v3y - v1y;
      const e2z = v3z - v1z;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      normals[p1] += nx;
      normals[p1 + 1] += ny;
      normals[p1 + 2] += nz;
      normals[p2] += nx;
      normals[p2 + 1] += ny;
      normals[p2 + 2] += nz;
      normals[p3] += nx;
      normals[p3 + 1] += ny;
      normals[p3 + 2] += nz;
    }

    for (let i = 0; i < vertexCount; i++) {
      const idx = i * 3;
      const nx = normals[idx];
      const ny = normals[idx + 1];
      const nz = normals[idx + 2];
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (length > 0) {
        normals[idx] = nx / length;
        normals[idx + 1] = ny / length;
        normals[idx + 2] = nz / length;
      }
    }

    const geomUuid = this.generateUUID();
    const matUuid = this.generateUUID();
    const objUuid = this.generateUUID();

    return {
      metadata: {
        version: 4.5,
        type: 'Object',
        generator: 'Simple3MFLoader',
        previewSimplified: Boolean(previewMeta.simplified),
        sourceTriangles: previewMeta.sourceTriangles || triangleCount,
        keptTriangles: previewMeta.keptTriangles || triangleCount
      },
      geometries: [{
        uuid: geomUuid,
        type: 'BufferGeometry',
        data: {
          attributes: {
            position: { itemSize: 3, type: 'Float32Array', array: positions },
            normal: { itemSize: 3, type: 'Float32Array', array: normals }
          },
          index: { type: 'Uint32Array', array: indices }
        }
      }],
      materials: [{
        uuid: matUuid,
        type: 'MeshStandardMaterial',
        color: 0xcccccc,
        metalness: 0.2,
        roughness: 0.7,
        side: 2
      }],
      object: {
        uuid: objUuid,
        type: 'Mesh',
        geometry: geomUuid,
        material: matUuid
      }
    };
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

module.exports = { Simple3MFLoader, PREVIEW_3MF_TARGET_TRIANGLES, collectSlicerSkipIds };
