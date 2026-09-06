#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  MCP_PROTOCOL_VERSION,
  listToolDefinitions,
  buildMcpClientConfig,
  toDataUrl,
  handleMcpJsonRpc
} = require('./mcp-server');

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log(`ok ${name}`);
      }).catch((err) => {
        console.error(`FAIL ${name}:`, err.message);
        process.exitCode = 1;
      });
    }
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

function mockCtx(overrides) {
  return Object.assign({
    getVersion: () => '2.2.3',
    searchModels: async (filters) => ({ models: [], filters }),
    getModel: async (args) => ({ id: args.id || 1, filePath: args.filePath || '/m.stl' }),
    updateModel: async (args) => ({ ok: true, id: args.id }),
    getLibraryStats: async () => ({ totalModels: 3 }),
    getFolderTree: async () => ({ roots: [] }),
    listTags: async () => [{ id: 1, name: 'benchy' }],
    addTag: async (name) => ({ id: 2, name }),
    listDesigners: async () => ['A'],
    listLicenses: async () => ['CC'],
    getModelsMissingThumbnails: async (limit) => [{ id: 1, limit }],
    getThumbnails: async () => ({ thumbnails: [] }),
    setThumbnail: async () => ({ ok: true }),
    addThumbnail: async () => ({ ok: true })
  }, overrides);
}

test('lists expected tools', () => {
  const names = listToolDefinitions().map((t) => t.name);
  assert.ok(names.includes('search_models'));
  assert.ok(names.includes('get_model'));
  assert.ok(names.includes('set_thumbnail'));
  assert.ok(names.includes('get_models_missing_thumbnails'));
});

test('buildMcpClientConfig uses streamable HTTP url', () => {
  const cfg = buildMcpClientConfig('http://127.0.0.1:5000/mcp');
  assert.strictEqual(cfg.mcpServers.printventory.url, 'http://127.0.0.1:5000/mcp');
});

test('toDataUrl accepts data URLs and raw base64', () => {
  assert.strictEqual(toDataUrl('data:image/png;base64,abc'), 'data:image/png;base64,abc');
  assert.ok(toDataUrl('iVBORw0KGgo').startsWith('data:image/png;base64,'));
  assert.ok(toDataUrl('/9j/xxxx').startsWith('data:image/jpeg;base64,'));
});

async function runAsync() {
  await test('initialize returns protocol and server info', async () => {
    const res = await handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test' } }
    }, mockCtx());
    assert.strictEqual(res.result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.strictEqual(res.result.serverInfo.name, 'printventory');
    assert.strictEqual(res.result.serverInfo.version, '2.2.3');
    assert.ok(res.result.capabilities.tools);
  });

  await test('notifications/initialized returns null', async () => {
    const res = await handleMcpJsonRpc({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }, mockCtx());
    assert.strictEqual(res, null);
  });

  await test('tools/list returns definitions', async () => {
    const res = await handleMcpJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, mockCtx());
    assert.ok(Array.isArray(res.result.tools));
    assert.ok(res.result.tools.length >= 10);
  });

  await test('tools/call search_models', async () => {
    const res = await handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search_models', arguments: { search: 'boat', limit: 10 } }
    }, mockCtx({
      searchModels: async (filters) => {
        assert.strictEqual(filters.search, 'boat');
        assert.strictEqual(filters.limit, 10);
        return [{ id: 1, fileName: 'boat.stl' }];
      }
    }));
    assert.strictEqual(res.result.isError, undefined);
    assert.ok(res.result.content[0].text.includes('boat.stl'));
  });

  await test('tools/call unknown tool is tool error not jsonrpc error', async () => {
    const res = await handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} }
    }, mockCtx());
    assert.strictEqual(res.result.isError, true);
    assert.ok(res.result.content[0].text.includes('Unknown tool'));
  });

  await test('unknown method returns -32601', async () => {
    const res = await handleMcpJsonRpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, mockCtx());
    assert.strictEqual(res.error.code, -32601);
  });

  await test('set_thumbnail converts raw base64', async () => {
    let received;
    const res = await handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'set_thumbnail', arguments: { id: 9, image: 'iVBORw0KGgoAAAANS' } }
    }, mockCtx({
      setThumbnail: async (args) => {
        received = args;
        return { ok: true };
      }
    }));
    assert.ok(received.image.startsWith('data:image/png;base64,'));
    assert.strictEqual(received.id, 9);
    assert.ok(res.result.content[0].text.includes('ok'));
  });
}

runAsync().then(() => {
  if (process.exitCode) process.exit(process.exitCode);
});
