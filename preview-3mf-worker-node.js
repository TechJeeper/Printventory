const { parentPort } = require('worker_threads');
const fs = require('fs');
const { Simple3MFLoader } = require('./threemf-loader-simple.js');

function postStatus(message) {
  parentPort.postMessage({ ok: true, type: 'status', message });
}

parentPort.on('message', async (message) => {
  const { filePath } = message || {};
  let arrayBuffer = null;

  try {
    postStatus('Reading 3MF file...');
    const data = await fs.promises.readFile(filePath);
    arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

    postStatus('Parsing 3MF data...');
    const loader = new Simple3MFLoader({ onStatus: postStatus });
    const jsonData = loader.parse(arrayBuffer);
    arrayBuffer = null;

    if (!jsonData) {
      parentPort.postMessage({ ok: false, error: 'Failed to parse 3MF file' });
      return;
    }

    if (jsonData.geometries && jsonData.geometries[0]) {
      jsonData.object.geometry = jsonData.geometries[0].uuid;
    }
    if (jsonData.materials && jsonData.materials[0]) {
      jsonData.object.material = jsonData.materials[0].uuid;
    }

    postStatus('Building preview...');
    parentPort.postMessage({ ok: true, json: jsonData });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
});
