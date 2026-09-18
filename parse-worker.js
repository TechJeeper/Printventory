// Worker script to parse 3D models off the main thread

importScripts('vendor/three.min.js');
importScripts('vendor/STLLoader.js');
importScripts('vendor/fflate.min.js');
// Dedicated Web Workers have no DOMParser; THREE.3MFLoader needs it for XML.
importScripts('vendor/xmldom-worker-bundle.js');
if (typeof DOMParser === 'undefined') {
  self.DOMParser = __xmldom.DOMParser;
}
importScripts('vendor/worker-xmldom-queryselector-polyfill.js');
importScripts('vendor/3MFLoader.js');
importScripts('vendor/OBJLoader.js');
importScripts('vendor/PLYLoader.js');
importScripts('threemf-mesh-extract.js');
importScripts('parse-lys-geometry.js');

function workerErrorMessage(error) {
  if (!error) return 'Unknown worker parse error';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  try {
    return String(error);
  } catch {
    return 'Unknown worker parse error';
  }
}

async function fetchArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to read model (${res.status})`);
  return res.arrayBuffer();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to read model (${res.status})`);
  return res.text();
}

function tightArrayBuffer(data) {
  if (!data) return null;
  let view = null;
  if (data instanceof ArrayBuffer) {
    view = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    return null;
  }
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

let parseQueue = Promise.resolve();

self.onmessage = function(e) {
  parseQueue = parseQueue.then(() => handleParseMessage(e)).catch((error) => {
    const id = e && e.data && e.data.id;
    self.postMessage({ id, success: false, error: workerErrorMessage(error) });
  });
};

async function handleParseMessage(e) {
  const { fileExtension, url, id, arrayBuffer: modelBuffer } = e.data;

  try {
    if (fileExtension === 'stl') {
      const loader = new THREE.STLLoader();
      const MAX_STL_TRIANGLES = 10000000;

      const buffer = tightArrayBuffer(modelBuffer) || await fetchArrayBuffer(url);

      if (buffer.byteLength < 15) {
        throw new Error('STL file too small to be valid');
      }
      if (buffer.byteLength >= 84) {
        const triangleCount = new DataView(buffer).getUint32(80, true);
        const expectedBinarySize = 84 + triangleCount * 50;
        const leftover = buffer.byteLength - expectedBinarySize;
        if (triangleCount > 0 && triangleCount <= MAX_STL_TRIANGLES && leftover >= 0 && leftover <= 4096) {
          const exact = leftover === 0 ? buffer : buffer.slice(0, expectedBinarySize);
          const object = loader.parse(exact);
          processObject(object, id);
          return;
        }
      }

      const object = loader.parse(buffer);
      processObject(object, id);
    } else if (fileExtension === '3mf') {
      THREE.ThreeMFLoader.fflate = fflate;
      const buffer = tightArrayBuffer(modelBuffer) || await fetchArrayBuffer(url);
      const object = parse3mfDocument(buffer);
      processObject(object, id);
    } else if (fileExtension === 'obj') {
      const loader = new THREE.OBJLoader();
      const objBuffer = tightArrayBuffer(modelBuffer);
      const text = objBuffer
        ? new TextDecoder().decode(objBuffer)
        : await fetchText(url);
      const object = loader.parse(text);
      processObject(object, id);
    } else if (fileExtension === 'ply') {
      const loader = new THREE.PLYLoader();
      const buffer = tightArrayBuffer(modelBuffer) || await fetchArrayBuffer(url);
      const object = loader.parse(buffer);
      processObject(object, id);
    } else if (fileExtension === 'step' || fileExtension === 'stp' || fileExtension === 'igs' || fileExtension === 'iges') {
      const buffer = tightArrayBuffer(modelBuffer) || await fetchArrayBuffer(url);
      const extra = Array.isArray(e.data.extraBuffers) ? e.data.extraBuffers : [];
      const format = (fileExtension === 'igs' || fileExtension === 'iges') ? 'iges' : 'step';
      const object = await parseCadDocument(
        buffer,
        extra.map((buf) => tightArrayBuffer(buf)).filter(Boolean),
        format
      );
      processObject(object, id);
    } else if (fileExtension === 'lys') {
      const buffer = tightArrayBuffer(modelBuffer) || await fetchArrayBuffer(url);
      const object = parseLysDocument(buffer);
      processObject(object, id);
    } else {
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }
  } catch (error) {
    self.postMessage({ id, success: false, error: workerErrorMessage(error) });
  }
}

const THUMBNAIL_3MF_TARGET_TRIANGLES = 200000;
const FAST_3MF_XML_BYTES = 2 * 1024 * 1024;

function decodeZipText(bytes) {
  if (typeof THREE !== 'undefined' && THREE.LoaderUtils && typeof THREE.LoaderUtils.decodeText === 'function') {
    return THREE.LoaderUtils.decodeText(bytes);
  }
  return new TextDecoder().decode(bytes);
}

function zipKeys(zip) {
  return zip ? Object.keys(zip) : [];
}

function shouldUseFast3mfExtract(zip) {
  const names = zipKeys(zip);
  const extract = self.ThreeMFMeshExtract;
  if (extract && typeof extract.zipHasSplitModelParts === 'function' && extract.zipHasSplitModelParts(names)) {
    return true;
  }
  let modelBytes = 0;
  for (let i = 0; i < names.length; i++) {
    if (!names[i].toLowerCase().endsWith('.model')) continue;
    const part = zip[names[i]];
    modelBytes += part && part.length ? part.length : 0;
    if (modelBytes > FAST_3MF_XML_BYTES) return true;
  }
  return false;
}

function parse3mfFastFromZip(zip) {
  const extract = self.ThreeMFMeshExtract;
  if (!extract || typeof extract.extractAllMeshesFast !== 'function') {
    throw new Error('3MF fast extractor is not available');
  }
  const names = zipKeys(zip);
  const xmlParts = [];
  for (let i = 0; i < names.length; i++) {
    if (!names[i].toLowerCase().endsWith('.model')) continue;
    xmlParts.push(decodeZipText(zip[names[i]]));
  }
  if (xmlParts.length === 0) {
    throw new Error('No .model parts found in 3MF file');
  }
  const mesh = extract.extractAllMeshesFast(xmlParts, THUMBNAIL_3MF_TARGET_TRIANGLES);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  if (mesh.indices && mesh.indices.length >= 3) {
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function parse3mfWithThreeLoader(buffer) {
  const loader = new THREE.ThreeMFLoader();
  return loader.parse(buffer);
}

function parse3mfDocument(buffer) {
  let zip = null;
  try {
    zip = fflate.unzipSync(new Uint8Array(buffer));
  } catch (e) {
    zip = null;
  }

  if (zip && shouldUseFast3mfExtract(zip)) {
    return parse3mfFastFromZip(zip);
  }

  try {
    return parse3mfWithThreeLoader(buffer);
  } catch (error) {
    if (zip) {
      return parse3mfFastFromZip(zip);
    }
    throw error;
  }
}

let occtModulePromise = null;

function getOcctModule() {
  if (!occtModulePromise) {
    importScripts('vendor/occt-import-js/occt-import-js.js');
    occtModulePromise = occtimportjs({
      locateFile: function (assetPath) {
        if (String(assetPath).endsWith('.wasm')) {
          return 'vendor/occt-import-js/occt-import-js.wasm';
        }
        return assetPath;
      }
    });
  }
  return occtModulePromise;
}

function toFloat32(values) {
  return values instanceof Float32Array ? values : Float32Array.from(values || []);
}

function toIndexArray(values) {
  if (!values || !values.length) return null;
  if (values instanceof Uint32Array || values instanceof Uint16Array) return values;
  return values.length > 65535 ? Uint32Array.from(values) : Uint16Array.from(values);
}

const STEP_TESS_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.01,
  angularDeflection: 0.5
};

function appendStepMeshes(group, result) {
  const meshes = result && result.meshes ? result.meshes : [];
  let added = 0;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const attrs = mesh && mesh.attributes;
    const positions = attrs && attrs.position && (attrs.position.array || attrs.position);
    if (!positions || positions.length < 9) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(toFloat32(positions), 3));
    const normals = attrs.normal && (attrs.normal.array || attrs.normal);
    if (normals && normals.length >= positions.length) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(toFloat32(normals), 3));
    }
    const indexValues = mesh.index && (mesh.index.array || mesh.index);
    const index = toIndexArray(indexValues);
    if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
    if (Array.isArray(mesh.color) && mesh.color.length >= 3) {
      geometry.userData.color = [mesh.color[0], mesh.color[1], mesh.color[2]];
    }
    group.add(new THREE.Mesh(geometry));
    added++;
  }
  return added;
}

function tessellateCadBuffer(occt, buffer, format) {
  const bytes = new Uint8Array(buffer);
  if (format === 'iges') return occt.ReadIgesFile(bytes, STEP_TESS_PARAMS);
  return occt.ReadStepFile(bytes, STEP_TESS_PARAMS);
}

async function parseCadDocument(buffer, extraBuffers, format) {
  const occt = await getOcctModule();
  const group = new THREE.Group();
  const label = format === 'iges' ? 'IGES' : 'STEP';
  const primary = tessellateCadBuffer(occt, buffer, format);
  if (!primary || primary.success === false) {
    if (format === 'iges' || !extraBuffers || extraBuffers.length === 0) {
      throw new Error((primary && (primary.error || primary.message)) || `${label} import failed`);
    }
  } else {
    appendStepMeshes(group, primary);
  }

  if (group.children.length === 0 && format === 'step' && extraBuffers && extraBuffers.length) {
    for (let i = 0; i < extraBuffers.length; i++) {
      const part = tessellateCadBuffer(occt, extraBuffers[i], 'step');
      if (part && part.success !== false) {
        appendStepMeshes(group, part);
      }
    }
  }

  if (group.children.length === 0) {
    throw new Error(`No mesh geometry found in ${label} file`);
  }
  return group;
}

function parseLysDocument(buffer) {
  const api = self.parseLysGeometry;
  if (!api || typeof api.parseLysGeometries !== 'function') {
    throw new Error('LYS geometry parser is not available');
  }
  const meshes = api.parseLysGeometries(new Uint8Array(buffer));
  const group = new THREE.Group();
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    if (mesh.indices && mesh.indices.length >= 3) {
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      const flat = geometry.toNonIndexed();
      flat.computeVertexNormals();
      group.add(new THREE.Mesh(flat));
    } else {
      geometry.computeVertexNormals();
      group.add(new THREE.Mesh(geometry));
    }
  }
  if (group.children.length === 0) {
    throw new Error('No mesh geometry found in LYS file');
  }
  return group;
}

function processObject(object, id) {
  const geometries = [];
  const transferables = [];

  if (object.isBufferGeometry) {
    object.computeBoundingBox();
    object.center();
    if (!object.attributes.normal) {
      object.computeVertexNormals();
    }
    const geo = extractGeometry(object, null, transferables, object.userData && object.userData.color);
    if (geo) geometries.push(geo);
  } else if (object.isObject3D) {
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      if (child.isMesh && child.geometry) {
        if (!child.geometry.attributes.normal) {
          child.geometry.computeVertexNormals();
        }
        const meshColor = (child.geometry.userData && child.geometry.userData.color)
          || (child.userData && child.userData.color);
        const geo = extractGeometry(child.geometry, child.matrixWorld.elements, transferables, meshColor);
        if (geo) geometries.push(geo);
      }
    });
  }

  if (geometries.length === 0) {
    self.postMessage({ id, success: false, error: 'No mesh geometry found in model' });
    return;
  }

  self.postMessage({ id, success: true, geometries }, transferables);
}

function extractGeometry(geometry, matrix, transferables, color) {
  const posArray = geometry.attributes.position ? geometry.attributes.position.array : null;
  if (!posArray || posArray.length < 9) return null;
  const normArray = geometry.attributes.normal ? geometry.attributes.normal.array : null;
  const uvArray = geometry.attributes.uv ? geometry.attributes.uv.array : null;
  const indexArray = geometry.index ? geometry.index.array : null;

  if (posArray) transferables.push(posArray.buffer);
  if (normArray) transferables.push(normArray.buffer);
  if (uvArray) transferables.push(uvArray.buffer);
  if (indexArray) transferables.push(indexArray.buffer);

  return {
    position: posArray,
    normal: normArray,
    uv: uvArray,
    index: indexArray,
    matrix: matrix,
    color: Array.isArray(color) && color.length >= 3 ? color : null
  };
}
