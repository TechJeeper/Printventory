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
importScripts('threemf-mesh-extract.js');

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

self.onmessage = async function(e) {
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
    } else {
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }
  } catch (error) {
    self.postMessage({ id, success: false, error: workerErrorMessage(error) });
  }
};

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

function processObject(object, id) {
  const geometries = [];
  const transferables = [];

  if (object.isBufferGeometry) {
    object.computeBoundingBox();
    object.center();
    if (!object.attributes.normal) {
      object.computeVertexNormals();
    }
    const geo = extractGeometry(object, null, transferables);
    if (geo) geometries.push(geo);
  } else if (object.isObject3D) {
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      if (child.isMesh && child.geometry) {
        if (!child.geometry.attributes.normal) {
          child.geometry.computeVertexNormals();
        }
        const geo = extractGeometry(child.geometry, child.matrixWorld.elements, transferables);
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

function extractGeometry(geometry, matrix, transferables) {
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
    matrix: matrix
  };
}
