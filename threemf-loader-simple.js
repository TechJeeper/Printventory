/**
 * Simplified 3MF Loader bundled directly in app
 * Uses fflate for ZIP decompression and Three.js for geometry
 * No external loader package needed - avoids build/packaging issues
 */

const fflate = require('fflate');

class Simple3MFLoader {
  parse(data) {
    try {
      // Decompress the 3MF ZIP archive
      const uint8Array = new Uint8Array(data);
      const unzipped = fflate.unzipSync(uint8Array);
      const zipKeys = Object.keys(unzipped);
      console.log('3MF zip entries:', zipKeys);
      
      // Locate all .model parts (main and referenced)
      const modelEntries = zipKeys.filter(k => k.toLowerCase().endsWith('.model'));
      if (modelEntries.length === 0) {
        throw new Error('No .model parts found in 3MF file');
      }
      
      const parser = new (require('xmldom').DOMParser)();
      const textDecoder = new TextDecoder();
      const modelDocs = modelEntries.map(path => {
        const buf = unzipped[path];
        const xmlText = textDecoder.decode(buf);
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        console.log('Parsed model part:', path, 'root:', xmlDoc.documentElement.tagName, 'ns:', xmlDoc.documentElement.namespaceURI);
        return { path, xmlDoc, xmlText };
      });
      
      // Relationships from main model to other parts (production extension)
      const relsPath = '3D/_rels/3dmodel.model.rels';
      let relsMap = new Map();
      if (unzipped[relsPath]) {
        try {
          const relsXml = textDecoder.decode(unzipped[relsPath]);
          const relsDoc = parser.parseFromString(relsXml, 'text/xml');
          const relNodes = relsDoc.getElementsByTagName('Relationship') || [];
          for (let i = 0; i < relNodes.length; i++) {
            const rel = relNodes[i];
            const id = rel.getAttribute('Id') || rel.getAttribute('id');
            const target = rel.getAttribute('Target') || rel.getAttribute('target');
            if (id && target) {
              relsMap.set(id, target.replace(/^\//, ''));
            }
          }
          console.log('Relationships mapped:', Array.from(relsMap.entries()));
        } catch (e) {
          console.log('Failed to parse rels:', e.message);
        }
      }
      
      // Helper to find elements by localName (handles namespaces/prefixes)
      
      // Helper to find elements by localName (handles namespaces/prefixes)
      const findByLocalName = (root, localName) => {
        const results = [];
        const stack = [root];
        while (stack.length) {
          const node = stack.pop();
          if (node && node.nodeType === 1) {
            if (node.localName === localName) {
              results.push(node);
            }
            if (node.childNodes) {
              for (let i = 0; i < node.childNodes.length; i++) {
                stack.push(node.childNodes[i]);
              }
            }
          }
        }
        return results;
      };
      
      // Extract vertices and triangles from all objects/meshes
      const vertices = [];
      const triangles = [];
      let meshNodes = [];
      const objectMap = new Map(); // key: path::id
      const buildItemsAll = [];
      
      // Build object map across all model parts
      for (const { path, xmlDoc, xmlText } of modelDocs) {
        let resourcesNode = xmlDoc.getElementsByTagName('resources')[0];
        if (!resourcesNode) resourcesNode = xmlDoc.getElementsByTagNameNS('*', 'resources')[0];
        if (!resourcesNode) {
          const resByLocalName = findByLocalName(xmlDoc.documentElement, 'resources');
          if (resByLocalName && resByLocalName.length > 0) resourcesNode = resByLocalName[0];
        }
        console.log(`[${path}] resources present:`, !!resourcesNode);
        if (!resourcesNode) continue;
        
        let objectNodes = resourcesNode.getElementsByTagName('object');
        if (!objectNodes || objectNodes.length === 0) objectNodes = resourcesNode.getElementsByTagNameNS('*', 'object');
        if (!objectNodes || objectNodes.length === 0) objectNodes = findByLocalName(resourcesNode, 'object');
        console.log(`[${path}] object count:`, objectNodes ? objectNodes.length : 0);
        if (objectNodes && objectNodes.length > 0) {
          for (let i = 0; i < objectNodes.length; i++) {
            const objNode = objectNodes[i];
            const objId = objNode.getAttribute('id');
            if (objId) {
              objectMap.set(`${path}::${objId}`, { node: objNode, path });
            }
          }
        }
        // collect build items from this doc
        const items = findByLocalName(xmlDoc.documentElement, 'item') || [];
        for (const item of items) {
          buildItemsAll.push({ item, path });
        }
      }
      console.log('Indexed objects total:', objectMap.size);
      console.log('Build items total:', buildItemsAll.length);
      
      // Helper to get attribute by localName
      const getAttr = (node, name) => {
        if (!node || !node.attributes) return null;
        for (let i = 0; i < node.attributes.length; i++) {
          const a = node.attributes[i];
          if (a.name === name || a.localName === name) return a.value;
        }
        return null;
      };
      
      // Helper: collect meshes from an object id within a model path
      const collectMeshesFromObject = (objId, modelPath, visited = new Set()) => {
        if (!objId || !modelPath) return;
        const key = `${modelPath}::${objId}`;
        if (visited.has(key)) return;
        visited.add(key);
        const entry = objectMap.get(key);
        if (!entry) return;
        const objNode = entry.node;
        const meshesInObj = findByLocalName(objNode, 'mesh');
        if (meshesInObj && meshesInObj.length > 0) {
          console.log(`Object ${key} has meshes:`, meshesInObj.length);
          meshNodes.push(...meshesInObj);
        }
        const componentNodes = findByLocalName(objNode, 'component');
        if (componentNodes && componentNodes.length > 0) {
          console.log(`Object ${key} has components:`, componentNodes.length);
          for (const comp of componentNodes) {
            let refId = getAttr(comp, 'objectid') || getAttr(comp, 'objectId') || getAttr(comp, 'object');
            // Production extension: p:objectid
            if (!refId) refId = getAttr(comp, 'p:objectid') || getAttr(comp, 'p:objectId');
            let refPath = getAttr(comp, 'path') || getAttr(comp, 'p:path');
            // Production extension via relationship id
            const rid = getAttr(comp, 'p:pid') || getAttr(comp, 'pid') || getAttr(comp, 'p:rid') || getAttr(comp, 'rid');
            if (!refPath && rid && relsMap.has(rid)) {
              refPath = relsMap.get(rid);
            }
            const targetPath = refPath ? refPath.replace(/^\//, '') : modelPath;
            if (refId) collectMeshesFromObject(refId, targetPath, visited);
          }
        }
      };
      
      // Prefer meshes referenced by build items (across all docs)
      for (const { item, path } of buildItemsAll) {
        const targetId = getAttr(item, 'objectid') || getAttr(item, 'objectId') || getAttr(item, 'pid') || getAttr(item, 'object');
        let targetPath = getAttr(item, 'path') || getAttr(item, 'p:path');
        if (!targetPath) {
          const rid = getAttr(item, 'p:pid') || getAttr(item, 'pid');
          if (rid && relsMap.has(rid)) targetPath = relsMap.get(rid);
        }
        targetPath = targetPath ? targetPath.replace(/^\//, '') : path;
        console.log('Build item target:', { targetId, targetPath });
        collectMeshesFromObject(targetId, targetPath);
      }
      
      // If no meshes yet, collect from all objects
      if (meshNodes.length === 0 && objectMap.size > 0) {
        console.log('No meshes from build items, scanning all objects');
        for (const key of objectMap.keys()) {
          const [modelPath, objId] = key.split('::');
          collectMeshesFromObject(objId, modelPath);
        }
      }
      
      // Final fallback: direct mesh scan anywhere in all docs
      if (meshNodes.length === 0) {
        console.log('No meshes via objects/components, trying direct mesh lookup across docs');
        for (const { xmlDoc } of modelDocs) {
          let fallbackMeshes = xmlDoc.getElementsByTagName('mesh');
          if (fallbackMeshes && fallbackMeshes.length > 0) { meshNodes.push(...Array.from(fallbackMeshes)); continue; }
          fallbackMeshes = xmlDoc.getElementsByTagNameNS('*', 'mesh');
          if (fallbackMeshes && fallbackMeshes.length > 0) { meshNodes.push(...Array.from(fallbackMeshes)); continue; }
          const byLocal = findByLocalName(xmlDoc.documentElement, 'mesh');
          if (byLocal && byLocal.length > 0) { meshNodes.push(...byLocal); }
        }
      }
      console.log('Total mesh nodes collected:', meshNodes.length);
      
      if (!meshNodes || meshNodes.length === 0) {
        throw new Error('No mesh found in 3MF model');
      }
      
      let totalVertices = 0;
      
      // Process all meshes in the file
      for (let m = 0; m < meshNodes.length; m++) {
        const meshNode = meshNodes[m];
        
        // Parse vertices
        let verticesNode = meshNode.getElementsByTagName('vertices')[0];
        if (!verticesNode) {
          verticesNode = meshNode.getElementsByTagNameNS('*', 'vertices')[0];
        }
        
        if (verticesNode) {
          let vertexNodes = verticesNode.getElementsByTagName('vertex');
          if (!vertexNodes || vertexNodes.length === 0) {
            vertexNodes = verticesNode.getElementsByTagNameNS('*', 'vertex');
          }
          
          const meshVertexOffset = totalVertices;
          for (let i = 0; i < vertexNodes.length; i++) {
            const v = vertexNodes[i];
            vertices.push({
              x: parseFloat(v.getAttribute('x') || 0),
              y: parseFloat(v.getAttribute('y') || 0),
              z: parseFloat(v.getAttribute('z') || 0)
            });
          }
          totalVertices = vertices.length;
          
          // Parse triangles
          let trianglesNode = meshNode.getElementsByTagName('triangles')[0];
          if (!trianglesNode) {
            trianglesNode = meshNode.getElementsByTagNameNS('*', 'triangles')[0];
          }
          
          if (trianglesNode) {
            let triangleNodes = trianglesNode.getElementsByTagName('triangle');
            if (!triangleNodes || triangleNodes.length === 0) {
              triangleNodes = trianglesNode.getElementsByTagNameNS('*', 'triangle');
            }
            
            for (let i = 0; i < triangleNodes.length; i++) {
              const t = triangleNodes[i];
              triangles.push({
                v1: parseInt(t.getAttribute('v1') || 0) + meshVertexOffset,
                v2: parseInt(t.getAttribute('v2') || 0) + meshVertexOffset,
                v3: parseInt(t.getAttribute('v3') || 0) + meshVertexOffset
              });
            }
          }
        }
      }
      
      if (vertices.length === 0 || triangles.length === 0) {
        throw new Error('No geometry data found in 3MF model');
      }
      
      // Convert to Three.js compatible format
      return this.buildThreeObject(vertices, triangles);
      
    } catch (error) {
      throw new Error(`Failed to parse 3MF: ${error.message}`);
    }
  }
  
  buildThreeObject(vertices, triangles) {
    // Build flat arrays for positions
    const positions = [];
    const indices = [];
    
    // Build position array
    for (let i = 0; i < vertices.length; i++) {
      positions.push(vertices[i].x, vertices[i].y, vertices[i].z);
    }
    
    // Build index array
    for (let i = 0; i < triangles.length; i++) {
      indices.push(triangles[i].v1, triangles[i].v2, triangles[i].v3);
    }
    
    // Compute normals manually (flat shading approach)
    const normals = new Array(vertices.length * 3).fill(0);
    
    // Calculate face normals and accumulate to vertex normals
    for (let i = 0; i < triangles.length; i++) {
      const t = triangles[i];
      const v1 = vertices[t.v1];
      const v2 = vertices[t.v2];
      const v3 = vertices[t.v3];
      
      // Calculate two edge vectors
      const e1x = v2.x - v1.x;
      const e1y = v2.y - v1.y;
      const e1z = v2.z - v1.z;
      
      const e2x = v3.x - v1.x;
      const e2y = v3.y - v1.y;
      const e2z = v3.z - v1.z;
      
      // Cross product for face normal
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      
      // Accumulate to all three vertices
      normals[t.v1 * 3] += nx;
      normals[t.v1 * 3 + 1] += ny;
      normals[t.v1 * 3 + 2] += nz;
      
      normals[t.v2 * 3] += nx;
      normals[t.v2 * 3 + 1] += ny;
      normals[t.v2 * 3 + 2] += nz;
      
      normals[t.v3 * 3] += nx;
      normals[t.v3 * 3 + 1] += ny;
      normals[t.v3 * 3 + 2] += nz;
    }
    
    // Normalize all vertex normals
    for (let i = 0; i < vertices.length; i++) {
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
    
    // Generate UUIDs for the JSON structure
    const geomUuid = this.generateUUID();
    const matUuid = this.generateUUID();
    const objUuid = this.generateUUID();
    
    // Return Three.js JSON format with normals
    return {
      metadata: { version: 4.5, type: 'Object', generator: 'Simple3MFLoader' },
      geometries: [{
        uuid: geomUuid,
        type: 'BufferGeometry',
        data: {
          attributes: {
            position: {
              itemSize: 3,
              type: 'Float32Array',
              array: positions
            },
            normal: {
              itemSize: 3,
              type: 'Float32Array',
              array: normals
            }
          },
          index: {
            type: 'Uint32Array',
            array: indices
          }
        }
      }],
      materials: [{
        uuid: matUuid,
        type: 'MeshStandardMaterial',
        color: 0xcccccc,
        metalness: 0.2,
        roughness: 0.7,
        side: 2  // DoubleSide
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

module.exports = { Simple3MFLoader };
