/**
 * Simplified 3MF Loader bundled directly in app
 * Uses fflate for ZIP decompression; fast regex path for dense models (HueForge, etc.)
 */

const fflate = require('fflate');
const {
  PREVIEW_3MF_TARGET_TRIANGLES,
  countTrianglesInXml,
  extractAllMeshesFast,
  shouldUseFastPath
} = require('./threemf-mesh-extract.js');

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

      if (shouldUseFastPath(modelXmlParts)) {
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

    let meshNodes = [];
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

    const collectMeshesFromObject = (objId, modelPath, visited = new Set()) => {
      if (!objId || !modelPath) return;
      const key = `${modelPath}::${objId}`;
      if (visited.has(key)) return;
      visited.add(key);
      const entry = objectMap.get(key);
      if (!entry) return;
      const meshesInObj = findByLocalName(entry.node, 'mesh');
      if (meshesInObj && meshesInObj.length > 0) meshNodes.push(...meshesInObj);
      const componentNodes = findByLocalName(entry.node, 'component');
      if (componentNodes && componentNodes.length > 0) {
        for (const comp of componentNodes) {
          let refId = getAttr(comp, 'objectid') || getAttr(comp, 'objectId') || getAttr(comp, 'object');
          if (!refId) refId = getAttr(comp, 'p:objectid') || getAttr(comp, 'p:objectId');
          let refPath = getAttr(comp, 'path') || getAttr(comp, 'p:path');
          const rid = getAttr(comp, 'p:pid') || getAttr(comp, 'pid') || getAttr(comp, 'p:rid') || getAttr(comp, 'rid');
          if (!refPath && rid && relsMap.has(rid)) refPath = relsMap.get(rid);
          const targetPath = refPath ? refPath.replace(/^\//, '') : modelPath;
          if (refId) collectMeshesFromObject(refId, targetPath, visited);
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
      collectMeshesFromObject(targetId, targetPath);
    }

    if (meshNodes.length === 0 && objectMap.size > 0) {
      for (const key of objectMap.keys()) {
        const [modelPath, objId] = key.split('::');
        collectMeshesFromObject(objId, modelPath);
      }
    }

    if (meshNodes.length === 0) {
      for (const { xmlDoc } of modelDocs) {
        let fallbackMeshes = xmlDoc.getElementsByTagName('mesh');
        if (fallbackMeshes && fallbackMeshes.length > 0) { meshNodes.push(...Array.from(fallbackMeshes)); continue; }
        fallbackMeshes = xmlDoc.getElementsByTagNameNS('*', 'mesh');
        if (fallbackMeshes && fallbackMeshes.length > 0) { meshNodes.push(...Array.from(fallbackMeshes)); continue; }
        const byLocal = findByLocalName(xmlDoc.documentElement, 'mesh');
        if (byLocal && byLocal.length > 0) meshNodes.push(...byLocal);
      }
    }

    if (!meshNodes || meshNodes.length === 0) {
      throw new Error('No mesh found in 3MF model');
    }

    let totalSourceTriangles = 0;
    for (let m = 0; m < meshNodes.length; m++) {
      const meshNode = meshNodes[m];
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

    const stride = totalSourceTriangles > this.targetTriangles
      ? Math.ceil(totalSourceTriangles / this.targetTriangles)
      : 1;
    const simplified = stride > 1;

    if (simplified) {
      this.postStatus(
        `Simplifying preview: keeping ~${Math.ceil(totalSourceTriangles / stride).toLocaleString('en-US')} of ` +
        `${totalSourceTriangles.toLocaleString('en-US')} triangles`
      );
    }

    const positions = new GrowableFloat32Array();
    const indices = new GrowableUint32Array();
    let totalVertices = 0;
    let globalTriIndex = 0;

    for (let m = 0; m < meshNodes.length; m++) {
      const meshNode = meshNodes[m];
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
        positions.push3(
          parseFloat(v.getAttribute('x') || 0),
          parseFloat(v.getAttribute('y') || 0),
          parseFloat(v.getAttribute('z') || 0)
        );
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
        if (globalTriIndex % stride === 0) {
          const t = triangleNodes[i];
          indices.push3(
            parseInt(t.getAttribute('v1') || 0, 10) + meshVertexOffset,
            parseInt(t.getAttribute('v2') || 0, 10) + meshVertexOffset,
            parseInt(t.getAttribute('v3') || 0, 10) + meshVertexOffset
          );
        }
        globalTriIndex++;
      }
    }

    if (positions.length === 0 || indices.length === 0) {
      throw new Error('No geometry data found in 3MF model');
    }

    return this.buildThreeObject(positions.toArray(), indices.toArray(), {
      simplified,
      sourceTriangles: totalSourceTriangles,
      keptTriangles: indices.length / 3
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
