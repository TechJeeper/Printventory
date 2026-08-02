/**
 * Stress: flood get3MFImages like scrolling into thumb-less 3MF cells.
 * Usage: node tests/run-3mf-images-scroll-stress.js [wsUrl] [count] [concurrency]
 */
const WebSocket = require('ws');
const { execSync } = require('child_process');

const WS_URL = process.argv[2] || 'ws://127.0.0.1:5000';
const COUNT = Number(process.argv[3] || 40);
const CONCURRENCY = Number(process.argv[4] || 8);
const TIMEOUT_MS = 180000;

let reqId = 0;
const pending = new Map();
let disconnects = 0;

function dockerState() {
  try {
    return execSync(
      'docker inspect -f "running={{.State.Running}} oom={{.State.OOMKilled}}" printventory-server',
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return 'missing';
  }
}

function dockerMem() {
  try {
    return execSync(
      'docker stats printventory-server --no-stream --format "{{.MemUsage}}"',
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return 'n/a';
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { maxPayload: 200 * 1024 * 1024 });
    const timer = setTimeout(() => reject(new Error('connect timeout')), 20000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('close', () => { disconnects++; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg.id || !pending.has(msg.id)) return;
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.type === 'error') p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    });
  });
}

function ipcCall(ws, channel, args = [], timeoutMs = TIMEOUT_MS) {
  const id = `imgstress_${++reqId}_${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`TIMEOUT: ${channel}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, channel, args }));
  });
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function main() {
  console.log('before', dockerState(), dockerMem());
  let ws = await connect();
  const page = await ipcCall(ws, 'get-models-filtered', [{
    sortOption: 'date-desc', search: '', limit: 500
  }]);
  const models = (Array.isArray(page) ? page : page?.models || [])
    .filter((m) => /\.3mf$/i.test(m.filePath || '') && !m.hasThumbnail);
  console.log(`3mf missing thumbs: ${models.length}`);
  const slice = models.slice(0, COUNT);
  const errors = [];
  const start = Date.now();

  const outcomes = await mapPool(slice, CONCURRENCY, async (m, i) => {
    if (ws.readyState !== WebSocket.OPEN) {
      try { ws = await connect(); } catch (e) {
        errors.push(String(e.message || e));
        return { ok: false };
      }
    }
    try {
      const imgs = await ipcCall(ws, 'get3MFImages', [m.filePath, { maxImages: 3, quiet: true }]);
      const bytes = (imgs || []).reduce((s, x) => s + String(x).length, 0);
      if (imgs && imgs.length) {
        await ipcCall(ws, 'add-multiple-thumbnails', [m.filePath, imgs]);
      }
      console.log(`[${i + 1}/${slice.length}] imgs=${imgs ? imgs.length : 0} bytes=${bytes} mem=${dockerMem()}`);
      return { ok: true, imgs: imgs ? imgs.length : 0, bytes };
    } catch (e) {
      errors.push(String(e.message || e));
      console.log(`[${i + 1}/${slice.length}] FAIL ${e.message} mem=${dockerMem()} state=${dockerState()}`);
      return { ok: false };
    }
  });

  console.log('elapsed', Date.now() - start, 'ms');
  console.log('after', dockerState(), dockerMem());
  console.log('ok', outcomes.filter((o) => o.ok).length, 'fail', outcomes.filter((o) => !o.ok).length);
  console.log('disconnects', disconnects);
  console.log('errors', errors.slice(0, 15));

  try { ws.close(); } catch {}
  if (!/running=true/.test(dockerState()) || /oom=true/.test(dockerState())) {
    console.error('FAIL: container died');
    process.exit(1);
  }
  if (errors.length > slice.length / 2) {
    console.error('FAIL: too many errors');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((e) => {
  console.error('FAIL', e.message || e, dockerState(), dockerMem());
  process.exit(1);
});
