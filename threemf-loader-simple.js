/**
 * Simplified 3MF Loader bundled directly in app
 * Uses fflate for ZIP decompression; fast regex path for dense models (HueForge, etc.)
 */

const fflate = require('fflate');
const {
  PREVIEW_3MF_TARGET_TRIANGLES,
  extractAllMeshesFast,
  simplifyForPreview,
  shouldUseFastPath,
  modelHasPlacementTransforms
} = require('./threemf-mesh-extract.js');

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

      // Fast path skips build/item transforms — keep it for dense single-object
      // models (HueForge). Multi-part plate layouts need the DOM path.
      const hasPlacement = modelHasPlacementTransforms(modelXmlParts);
      if (shouldUseFastPath(modelXmlParts) && !hasPlacement) {
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
          if (objId) objectMap.set(`${path}::${objId}`, { node: objNode, path });
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

    const collectMeshesFromObject = (objId, modelPath, parentMatrix, visited = new Set()) => {
      if (!objId || !modelPath) return;
      const key = `${modelPath}::${objId}`;
      if (visited.has(key)) return;
      visited.add(key);
      const entry = objectMap.get(key);
      if (!entry) return;

      const meshesInObj = findByLocalName(entry.node, 'mesh');
      // Prefer leaf mesh objects; composites are usually component-only.
      if (meshesInObj && meshesInObj.length > 0) {
        for (let i = 0; i < meshesInObj.length; i++) {
          meshInstances.push({ meshNode: meshesInObj[i], matrix: parentMatrix });
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
          const targetPath = refPath ? refPath.replace(/^\//, '') : modelPath;
          const compTransform = parseTransformAttr(getAttr(comp, 'transform'));
          const childMatrix = compTransform ? mat4Multiply(parentMatrix, compTransform) : parentMatrix;
          if (refId) collectMeshesFromObject(refId, targetPath, childMatrix, new Set(visited));
        }
      }
    };

    for (const { item, path } of buildItemsAll) {
      const targetId = getAttr(item, 'objectid') || getAttr(item, 'objectId') || getAttr(item, 'pid') || getAttr(item, 'object');
      let targetPath = getAttr(item, 'path') || getAttr(item, 'p:path');
      if (!targetPath) {
        const rid = getAttr(item, 'p:pid') || getAttr(item, 'pid');
        if (rid && relsMap.has(rid)) targetPath = relsMap.get(rid);
      }
      targetPath = targetPath ? targetPath.replace(/^\//, '') : path;
      const itemTransform = parseTransformAttr(getAttr(item, 'transform'));
      const itemMatrix = itemTransform || mat4Identity();
      collectMeshesFromObject(targetId, targetPath, itemMatrix);
    }

    if (meshInstances.length === 0 && objectMap.size > 0) {
      for (const key of objectMap.keys()) {
        const [modelPath, objId] = key.split('::');
        collectMeshesFromObject(objId, modelPath, mat4Identity());
      }
    }

    if (meshInstances.length === 0) {
      for (const { xmlDoc } of modelDocs) {
        let fallbackMeshes = xmlDoc.getElementsByTagName('mesh');
        if (!fallbackMeshes || fallbackMeshes.length === 0) {
          fallbackMeshes = xmlDoc.getElementsByTagNameNS('*', 'mesh');
        }
        if (!fallbackMeshes || fallbackMeshes.length === 0) {
          fallbackMeshes = findByLocalName(xmlDoc.documentElement, 'mesh');
        }
        if (fallbackMeshes && fallbackMeshes.length > 0) {
          for (let i = 0; i < fallbackMeshes.length; i++) {
            meshInstances.push({ meshNode: fallbackMeshes[i], matrix: mat4Identity() });
          }
        }
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

    const positions = new GrowableFloat32Array();
    const indices = new GrowableUint32Array();
    let totalVertices = 0;

    for (let m = 0; m < meshInstances.length; m++) {
      const { meshNode, matrix } = meshInstances[m];
      const applyTransform = !isIdentityMatrix(matrix);

      let verticesNode = meshNode.getElementsByTagName('vertices')[0];
      if (!verticesNode) verticesNode = meshNode.getElementsByTagNameNS('*', 'vertices')[0];
      if (!verticesNode) continue;

      let vertexNodes = verticesNode.getElementsByTagName('vertex');
      if (!vertexNodes || vertexNodes.length === 0) {
        vertexNodes = verticesNode.getElementsByTagNameNS('*', 'vertex');
      }

      const meshVertexOffset = totalVertices;
      for (let i = 0; i < vertexNodes.length; i++) {
        const v = vertexNodes[i];
        const x = parseFloat(v.getAttribute('x') || 0);
        const y = parseFloat(v.getAttribute('y') || 0);
        const z = parseFloat(v.getAttribute('z') || 0);
        if (applyTransform) {
          const p = mat4ApplyPoint(matrix, x, y, z);
          positions.push3(p.x, p.y, p.z);
        } else {
          positions.push3(x, y, z);
        }
      }
      totalVertices += vertexNodes.length;

      let trianglesNode = meshNode.getElementsByTagName('triangles')[0];
      if (!trianglesNode) trianglesNode = meshNode.getElementsByTagNameNS('*', 'triangles')[0];
      if (!trianglesNode) continue;

      let triangleNodes = trianglesNode.getElementsByTagName('triangle');
      if (!triangleNodes || triangleNodes.length === 0) {
        triangleNodes = trianglesNode.getElementsByTagNameNS('*', 'triangle');
      }

      for (let i = 0; i < triangleNodes.length; i++) {
        const t = triangleNodes[i];
        indices.push3(
          parseInt(t.getAttribute('v1') || 0, 10) + meshVertexOffset,
          parseInt(t.getAttribute('v2') || 0, 10) + meshVertexOffset,
          parseInt(t.getAttribute('v3') || 0, 10) + meshVertexOffset
        );
      }
    }

    if (positions.length === 0 || indices.length === 0) {
      throw new Error('No geometry data found in 3MF model');
    }

    const simplified = simplifyForPreview(positions.toArray(), indices.toArray(), this.targetTriangles);
    if (simplified.simplified) {
      this.postStatus(
        `Simplified preview: ${simplified.keptTriangles.toLocaleString('en-US')} of ` +
        `${simplified.sourceTriangles.toLocaleString('en-US')} triangles`
      );
    }

    return this.buildThreeObject(simplified.positions, simplified.indices, {
      simplified: simplified.simplified,
      sourceTriangles: simplified.sourceTriangles,
      keptTriangles: simplified.keptTriangles
    });
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

module.exports = { Simple3MFLoader, PREVIEW_3MF_TARGET_TRIANGLES };
