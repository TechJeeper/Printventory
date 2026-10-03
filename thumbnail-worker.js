#!/usr/bin/env node
'use strict';

/**
 * Local thumbnail worker for Printventory's MCP endpoint.
 * Models that can never render are passed back as excludeIds so they do not
 * stay at the head of get_models_missing_thumbnails.
 * 3MF files are flattened to STL here. stl-thumb only sees that STL.
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { flatten3mfFileToStl } = require('./flatten-3mf-stl');

function stlThumbInput(filePath, deps) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.3mf') {
    const out = (deps && deps.tempStlPath) || path.join(
      os.tmpdir(),
      `pv-thumb-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.stl`
    );
    flatten3mfFileToStl(filePath, out);
    return { inputPath: out, temporary: true };
  }
  if (ext === '.stl') return { inputPath: filePath, temporary: false };
  throw new Error(`stl-thumb worker does not render ${ext || 'this file type'}`);
}

function runStlThumb(bin, inputPath, pngPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-s', '256', inputPath, pngPath], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(pngPath)) resolve();
      else reject(new Error((stderr || `stl-thumb exited ${code}`).trim()));
    });
  });
}

async function renderWithStlThumb(filePath, deps) {
  const options = deps || {};
  const prepared = stlThumbInput(filePath, options);
  const pngPath = options.pngPath || path.join(
    os.tmpdir(),
    `pv-thumb-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`
  );
  const run = options.runStlThumb || runStlThumb;
  try {
    await run(options.stlThumbBin || 'stl-thumb', prepared.inputPath, pngPath);
    const png = fs.readFileSync(pngPath);
    if (!png.length) throw new Error('stl-thumb wrote an empty image');
    return `data:image/png;base64,${png.toString('base64')}`;
  } finally {
    if (prepared.temporary) {
      try { fs.unlinkSync(prepared.inputPath); } catch (_) { /* already gone */ }
    }
    if (!options.pngPath) {
      try { fs.unlinkSync(pngPath); } catch (_) { /* already gone */ }
    }
  }
}

/**
 * Walk models that still need thumbnails. Failed ids are excluded on the next
 * fetch so a batch of permanent failures does not block the rest of the library.
 */
async function runThumbnailQueue(options) {
  const limit = options.limit || 20;
  const excludeIds = [];
  const known = new Set();
  const done = new Set();
  let rendered = 0;
  let failed = 0;

  for (;;) {
    const batch = await options.fetchBatch({
      limit,
      offset: 0,
      excludeIds: excludeIds.concat([...done])
    });
    const models = Array.isArray(batch) ? batch : [];
    const fresh = models.filter((model) => !done.has(model.id));
    if (!fresh.length) break;
    if (fresh.every((model) => known.has(model.id))) {
      const err = new Error('Thumbnail queue returned only known failures');
      err.code = 'QUEUE_STUCK';
      throw err;
    }
    for (const model of fresh) {
      try {
        const image = await options.render(model);
        await options.setThumbnail(model, image);
        done.add(model.id);
        rendered += 1;
      } catch (err) {
        failed += 1;
        if (!known.has(model.id)) {
          known.add(model.id);
          excludeIds.push(model.id);
        }
      }
    }
  }

  return { rendered, failed, excludeIds };
}

function postJson(urlString, body, headers) {
  const url = new URL(urlString);
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: Object.assign({
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
        'MCP-Protocol-Version': '2025-03-26'
      }, headers || {})
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { /* empty or non-json */ }
        resolve({
          status: res.statusCode,
          sessionId: res.headers['mcp-session-id'] || '',
          json,
          raw
        });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function toolPayload(response) {
  if (!response || !response.json) {
    throw new Error(`MCP call failed (${response && response.status})`);
  }
  if (response.json.error) {
    throw new Error(response.json.error.message || 'MCP error');
  }
  const result = response.json.result;
  if (result && result.isError) {
    const text = result.content && result.content[0] && result.content[0].text;
    throw new Error(text || 'MCP tool error');
  }
  const text = result && result.content && result.content[0] && result.content[0].text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

async function createMcpClient(url) {
  const init = await postJson(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'printventory-thumbnail-worker', version: '1.0.0' }
    }
  });
  if (!init.json || !init.json.result) {
    throw new Error(`MCP initialize failed (${init.status})`);
  }
  const session = init.sessionId ? { 'Mcp-Session-Id': init.sessionId } : {};
  await postJson(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  let nextId = 2;
  return async function callTool(name, args) {
    const response = await postJson(url, {
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name, arguments: args || {} }
    }, session);
    return toolPayload(response);
  };
}

function parseArgs(argv) {
  const out = {
    url: 'http://127.0.0.1:5000/mcp',
    limit: 20,
    stlThumbBin: 'stl-thumb'
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url') out.url = argv[++i];
    else if (arg === '--limit') out.limit = parseInt(argv[++i], 10) || 20;
    else if (arg === '--stl-thumb') out.stlThumbBin = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node thumbnail-worker.js [--url http://127.0.0.1:5000/mcp] [--limit 20] [--stl-thumb stl-thumb]');
    return;
  }
  const callTool = await createMcpClient(args.url);
  const summary = await runThumbnailQueue({
    limit: args.limit,
    fetchBatch: (query) => callTool('get_models_missing_thumbnails', query),
    render: (model) => renderWithStlThumb(model.filePath, { stlThumbBin: args.stlThumbBin }),
    setThumbnail: (model, image) => callTool('set_thumbnail', {
      id: model.id,
      filePath: model.filePath,
      image
    })
  });
  console.log(
    `Rendered ${summary.rendered} thumbnail(s); skipped ${summary.failed} model(s) that could not be rendered.`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = {
  stlThumbInput,
  renderWithStlThumb,
  runThumbnailQueue,
  toolPayload,
  parseArgs
};
