/**
 * Reproduce Docker grid-scroll crash: load library, flood getThumbnail like
 * virtual scroll does when the user scrolls into unloaded rows.
 *
 * Usage: node tests/run-grid-scroll-stress.js [wsUrl] [rounds]
 */
const WebSocket = require('ws');
const { execSync } = require('child_process');

const WS_URL = process.argv[2] || 'ws://127.0.0.1:5000';
const ROUNDS = Number(process.argv[3] || 12);
const VIEWPORT = 48; // ~visible + buffer cells
const STEP = 24; // scroll step in model indices
const TIMEOUT_MS = 45000;

let reqId = 0;
const pending = new Map();
const errors = [];
let disconnects = 0;

function dockerState() {
  try {
    return execSync(
      'docker inspect -f "running={{.State.Running}} oom={{.State.OOMKilled}} status={{.State.Status}} mem={{.HostConfig.Memory}}" printventory-server',
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return 'missing';
  }
}

function dockerMem() {
  try {
    return execSync(
      'docker stats printventory-server --no-stream --format "{{.MemUsage}} ({{.MemPerc}})"',
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return 'n/a';
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => reject(new Error('connect timeout')), 20000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on('close', () => {
      disconnects++;
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
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
  const id = `scrollstress_${++reqId}_${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`TIMEOUT: ${channel}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      ws.send(JSON.stringify({ id, channel, args }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
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

async function hydrateViewport(ws, models, offset) {
  const slice = models.slice(offset, offset + VIEWPORT);
  const start = Date.now();
  const outcomes = await mapPool(slice, 24, async (m) => {
    try {
      const thumb = await ipcCall(ws, 'getThumbnail', [m.filePath]);
      // Mirror createModelItem path for models that may already have multi thumbs
      if (m.hasThumbnail && (!thumb || thumb === '3d.png')) {
        await ipcCall(ws, 'get-model', [m.filePath]);
      }
      return { ok: true, path: m.filePath, len: thumb ? String(thumb).length : 0 };
    } catch (e) {
      errors.push(String(e.message || e));
      return { ok: false, path: m.filePath, error: String(e.message || e) };
    }
  });
  return {
    offset,
    count: slice.length,
    ms: Date.now() - start,
    failed: outcomes.filter((o) => !o.ok).length,
    avgLen: Math.round(
      outcomes.filter((o) => o.ok).reduce((s, o) => s + (o.len || 0), 0) /
        Math.max(1, outcomes.filter((o) => o.ok).length)
    )
  };
}

async function main() {
  console.log('docker before:', dockerState(), dockerMem());
  let ws = await connect();
  console.log('connected', WS_URL);

  // Progressive library load like search.js
  let models = [];
  let offset = 0;
  const INITIAL = 500;
  const CHUNK = 1200;
  while (true) {
    const limit = models.length === 0 ? INITIAL : CHUNK;
    const page = await ipcCall(ws, 'get-models-filtered', [{
      sortOption: 'date-desc',
      search: '',
      limit,
      offset
    }], 120000);
    const list = Array.isArray(page) ? page : (page?.models || []);
    models = models.concat(list);
    console.log(`loaded models: ${models.length} (+${list.length})`);
    if (list.length < limit) break;
    offset = models.length;
    if (models.length > 20000) break;
  }

  const withThumb = models.filter((m) => m.hasThumbnail).length;
  console.log(`total=${models.length} hasThumbnail=${withThumb} missing=${models.length - withThumb}`);
  console.log('mem after list:', dockerMem());

  for (let r = 0; r < ROUNDS; r++) {
    if (ws.readyState !== WebSocket.OPEN) {
      console.log('WS closed — reconnecting...');
      ws = await connect();
    }
    const off = Math.min((r * STEP) % Math.max(1, models.length - VIEWPORT), Math.max(0, models.length - VIEWPORT));
    const result = await hydrateViewport(ws, models, off);
    console.log(
      `round ${r + 1}/${ROUNDS} offset=${result.offset} cells=${result.count} ` +
      `failed=${result.failed} ${result.ms}ms avgThumb=${result.avgLen} mem=${dockerMem()}`
    );
    if (result.failed > result.count / 2) {
      console.error('FAIL: majority of viewport hydrates failed');
      break;
    }
  }

  try { ws.close(); } catch {}

  const state = dockerState();
  console.log('docker after:', state, dockerMem());
  console.log('disconnects:', disconnects);
  console.log('errors sample:', errors.slice(0, 15));
  console.log('error count:', errors.length);

  if (/oom=true/i.test(state) || /running=false/i.test(state)) {
    console.error('FAIL: container died / OOM');
    process.exit(1);
  }
  if (errors.length > VIEWPORT) {
    console.error('FAIL: too many hydrate errors');
    process.exit(1);
  }
  console.log('PASS: scroll-like hydrate completed without container crash');
}

main().catch((e) => {
  console.error('FAIL:', e.message || e);
  console.error('docker:', dockerState(), dockerMem());
  process.exit(1);
});
