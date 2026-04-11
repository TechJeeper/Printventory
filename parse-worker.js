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

self.onmessage = async function(e) {
  const { fileExtension, url, id } = e.data;

  try {
    let loader;
    if (fileExtension === 'stl') {
      loader = new THREE.STLLoader();

      const MAX_STL_TRIANGLES = 10000000; // 10M triangles (~500MB)

      // Fetch and validate binary header
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();

      if (buffer.byteLength < 84) {
        throw new Error('STL file too small to be valid');
      }
      const dv = new DataView(buffer);
      const triangleCount = dv.getUint32(80, true);
      const expectedBinarySize = 84 + triangleCount * 50;
      if (expectedBinarySize === buffer.byteLength) {
        if (triangleCount > MAX_STL_TRIANGLES) {
          throw new Error(
            `STL has too many triangles (${triangleCount.toLocaleString()}). Max ${MAX_STL_TRIANGLES.toLocaleString()}. File may be corrupted.`
          );
        }
      }

      const object = loader.parse(buffer);
      processObject(object, id);

    } else if (fileExtension === '3mf') {
      THREE.ThreeMFLoader.fflate = fflate;
      loader = new THREE.ThreeMFLoader();
      const object = await new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
      processObject(object, id);
    } else if (fileExtension === 'obj') {
      loader = new THREE.OBJLoader();
      const object = await new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
      processObject(object, id);
    } else {
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }

  } catch (error) {
    self.postMessage({ id, success: false, error: error.message });
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
