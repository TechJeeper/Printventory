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
    getVersion: () => '2.2.8',
    searchModels: async (filters) => ({ models: [], filters }),
    getModel: async (args) => ({ id: args.id || 1, filePath: args.filePath || '/m.stl' }),
    updateModel: async (args) => ({ ok: true, id: args.id }),
    getLibraryStats: async () => ({ totalModels: 3 }),
    getFolderTree: async () => ({ roots: [] }),
    listTags: async () => [{ id: 1, name: 'benchy' }],
    addTag: async (name) => ({ id: 2, name }),
    renameTag: async (args) => ({ ok: true, name: args.newName }),
    deleteTag: async (args) => ({ ok: true, id: args.id, name: args.name }),
    addModelTags: async (args) => ({ ok: true, tags: args.tags }),
    removeModelTags: async (args) => ({ ok: true, tags: args.tags }),
    listFilaments: async () => [{ id: 1, name: 'PLA' }],
    saveFilament: async (filament) => filament,
    deleteFilament: async (id) => ({ ok: true, id }),
    setModelFilaments: async (args) => ({ ok: true, filaments: args.filaments }),
    getPrintEvents: async () => ({ events: [] }),
    logPrintEvent: async (args) => ({ eventId: 1, outcome: args.outcome }),
    deletePrintEvent: async (eventId) => ({ deleted: true, eventId }),
    listParentModels: async () => ['kit'],
    renameMetadata: async (args) => ({ success: true, type: args.type }),
    deleteMetadata: async (args) => ({ success: true, type: args.type }),
    listDesigners: async () => ['A'],
    listLicenses: async () => ['CC'],
    getModelsMissingThumbnails: async (limit) => [{ id: 1, limit }],
    getThumbnails: async () => ({ thumbnails: [] }),
    setThumbnail: async () => ({ ok: true }),
    addThumbnail: async () => ({ ok: true }),
    setDefaultThumbnail: async (args) => ({ ok: true, index: args.index }),
    deleteThumbnail: async (args) => ({ ok: true, index: args.index }),
    findDuplicates: async (args) => ({ groupCount: 0, groups: [], includeZip: args.includeZip }),
    getHashStatus: async () => ({ generating: false, missingHash: 0 }),
    calculateMissingHashes: async () => ({ started: true, total: 0 }),
    checkFilesExist: async () => ({ checked: 0, missingCount: 0, results: [] }),
    getAllMetadata: async () => [],
    pull3mfMetadata: async () => ({ success: true }),
    generateTags: async () => ({ tags: [] }),
    updateModelsBatch: async (models) => ({ success: true, count: models.length }),
    logPrintEventsBatch: async () => [],
    getModelsByDirectory: async (args) => ({ count: 0, directory: args.directory, models: [] }),
    scanDirectory: async (args) => ({ success: true, directory: args.directory }),
    removeModel: async (args) => ({ success: true, confirm: args.confirm }),
    trashFile: async (args) => ({ success: true, confirm: args.confirm }),
    listSlicers: async () => [],
    openInSlicer: async () => ({ success: true }),
    moveFiles: async () => ({ success: true }),
    exportLibrary: async () => ({ success: true }),
    backupDatabase: async () => ({ success: true }),
    syncSpoolmanFilaments: async () => ({ success: true, created: 0, updated: 0 })
  }, overrides);
}

test('lists expected tools', () => {
  const names = listToolDefinitions().map((t) => t.name);
  assert.ok(names.includes('search_models'));
  assert.ok(names.includes('get_model'));
  assert.ok(names.includes('set_thumbnail'));
  assert.ok(names.includes('get_models_missing_thumbnails'));
  assert.ok(names.includes('delete_tag'));
  assert.ok(names.includes('rename_tag'));
  assert.ok(names.includes('add_model_tags'));
  assert.ok(names.includes('delete_filament'));
  assert.ok(names.includes('delete_print_event'));
  assert.ok(names.includes('delete_thumbnail'));
  assert.ok(names.includes('find_duplicates'));
  assert.ok(names.includes('calculate_missing_hashes'));
  assert.ok(names.includes('remove_model'));
  assert.ok(names.includes('trash_file'));
  assert.ok(names.includes('scan_directory'));
  assert.ok(names.includes('pull_3mf_metadata'));
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
    assert.strictEqual(res.result.serverInfo.version, '2.2.8');
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

  await test('tools/call delete_tag', async () => {
    let received;
    const res = await handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'delete_tag', arguments: { name: 'obsolete' } }
    }, mockCtx({
      deleteTag: async (args) => {
        received = args;
        return { success: true, name: args.name };
      }
    }));
    assert.strictEqual(received.name, 'obsolete');
    assert.strictEqual(res.result.isError, undefined);
    assert.ok(res.result.content[0].text.includes('obsolete'));
  });

  await test('tools/call rename_tag', async () => {
    const res = await handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'rename_tag', arguments: { id: 3, newName: 'boat' } }
    }, mockCtx({
      renameTag: async (args) => {
        assert.strictEqual(args.id, 3);
        assert.strictEqual(args.newName, 'boat');
        return { success: true, name: args.newName };
      }
    }));
    assert.ok(res.result.content[0].text.includes('boat'));
  });

  await test('tools/call find_duplicates', async () => {
    const res = await handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'find_duplicates', arguments: { includeZip: true, limit: 10 } }
    }, mockCtx({
      findDuplicates: async (args) => {
        assert.strictEqual(args.includeZip, true);
        assert.strictEqual(args.limit, 10);
        return { groupCount: 1, groups: [{ hash: 'abc', files: [] }] };
      }
    }));
    assert.ok(res.result.content[0].text.includes('abc'));
  });
}

runAsync().then(() => {
  if (process.exitCode) process.exit(process.exitCode);
});
