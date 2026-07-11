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

self.onmessage = async function(e) {
  const { fileExtension, url, id, arrayBuffer: modelBuffer } = e.data;

  try {
    if (fileExtension === 'stl') {
      const loader = new THREE.STLLoader();
      const MAX_STL_TRIANGLES = 10000000;

      const buffer = modelBuffer instanceof ArrayBuffer ? modelBuffer : await fetchArrayBuffer(url);

      if (buffer.byteLength < 84) {
        throw new Error('STL file too small to be valid');
      }
      const dv = new DataView(buffer);
      const triangleCount = dv.getUint32(80, true);
      const expectedBinarySize = 84 + triangleCount * 50;
      if (expectedBinarySize === buffer.byteLength && triangleCount > MAX_STL_TRIANGLES) {
        throw new Error(
          `STL has too many triangles (${triangleCount.toLocaleString()}). Max ${MAX_STL_TRIANGLES.toLocaleString()}.`
        );
      }

      const object = loader.parse(buffer);
      processObject(object, id);
    } else if (fileExtension === '3mf') {
      THREE.ThreeMFLoader.fflate = fflate;
      const loader = new THREE.ThreeMFLoader();
      const buffer = modelBuffer instanceof ArrayBuffer ? modelBuffer : await fetchArrayBuffer(url);
      const object = loader.parse(buffer);
      processObject(object, id);
    } else if (fileExtension === 'obj') {
      const loader = new THREE.OBJLoader();
      const text = modelBuffer instanceof ArrayBuffer
        ? new TextDecoder().decode(modelBuffer)
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
