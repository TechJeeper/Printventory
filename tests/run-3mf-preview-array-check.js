/**
 * Live WebSocket check for GitHub #72 against a running Docker server.
 * Usage: node tests/run-3mf-preview-array-check.js
 */
const WebSocket = require('ws');

const WS_URL = process.env.PRINTVENTORY_WS_URL || 'ws://127.0.0.1:5000';
const MODEL_PATH =
  process.env.PRINTVENTORY_3MF_PATH ||
  '/mnt/test_files/BOB_Knitted_Short_Wide_Bowl - Copy (2).3mf';

function invoke(ws, channel, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`timeout waiting for ${channel}`));
    }, timeoutMs);

    function onMessage(raw) {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }
      if (data.id !== id) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      if (data.type === 'error') reject(new Error(data.error || 'unknown error'));
      else resolve(data.result);
    }

    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, channel, args }));
  });
}

async function main() {
  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  console.log('connected', WS_URL);

  const requestId = `issue72_${Date.now()}`;
  console.log('calling parse-3mf-preview', MODEL_PATH);
  const json = await invoke(ws, 'parse-3mf-preview', [MODEL_PATH, requestId]);
  ws.close();

  if (!json || !Array.isArray(json.geometries) || !json.geometries.length) {
    console.error('FAIL: no geometries', json && Object.keys(json || {}));
    process.exit(1);
  }

  const position = json.geometries[0].data.attributes.position.array;
  const normal = json.geometries[0].data.attributes.normal.array;
  const index = json.geometries[0].data.index.array;
  const rebuilt = new Float32Array(position);

  const report = {
    positionIsArray: Array.isArray(position),
    positionLength: Array.isArray(position) ? position.length : Object.keys(position || {}).length,
    rebuiltLength: rebuilt.length,
    normalIsArray: Array.isArray(normal),
    indexIsArray: Array.isArray(index),
    indexLength: Array.isArray(index) ? index.length : 0,
    sample: Array.isArray(position) ? position.slice(0, 6) : null
  };
  console.log(JSON.stringify(report, null, 2));

  if (!report.positionIsArray || report.rebuiltLength === 0) {
    console.error('FAIL: typed arrays were mangled (issue #72 still present)');
    process.exit(1);
  }
  if (!report.normalIsArray || !report.indexIsArray || report.indexLength === 0) {
    console.error('FAIL: normal/index arrays missing or mangled');
    process.exit(1);
  }

  console.log('PASS: 3MF preview geometry arrays survived WebSocket JSON transport');
}

main().catch((err) => {
  console.error('FAIL:', err.message || err);
  process.exit(1);
});
