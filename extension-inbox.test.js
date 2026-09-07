#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const inbox = require('./extension-inbox');

function test(name, fn) {
  const run = async () => {
    try {
      await fn();
      console.log('ok ' + name);
    } catch (err) {
      console.error('FAIL ' + name + ':', err.message);
      process.exitCode = 1;
    }
  };
  return run();
}

function memFs(files) {
  const store = Object.assign({}, files || {});
  return {
    existsSync(p) { return Object.prototype.hasOwnProperty.call(store, p) || Object.keys(store).some((k) => k.startsWith(p + path.sep) || k.startsWith(p + '/')); },
    mkdirSync() { /* no-op */ },
    readdirSync(dir) {
      const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
      const names = new Set();
      Object.keys(store).forEach((k) => {
        if (k === dir) return;
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          names.add(rest.split(/[/\\]/)[0]);
        }
      });
      return Array.from(names);
    },
    readFileSync(p) { return store[p]; },
    writeFileSync(p, data) { store[p] = data; },
    renameSync(from, to) {
      store[to] = store[from];
      delete store[from];
    },
    statSync(p) {
      const data = store[p];
      if (data == null) throw new Error('ENOENT');
      return { isFile: () => true, size: String(data).length, mtimeMs: Date.now() - 2000 };
    },
    _store: store
  };
}

(async () => {
  await test('default inbox is Downloads/PrintventoryInbox', () => {
    const dir = inbox.defaultInboxDirectory('/home/sam');
    assert.ok(dir.replace(/\\/g, '/').endsWith('/Downloads/PrintventoryInbox'));
  });

  await test('resolveInboxDirectory prefers custom path', () => {
    assert.strictEqual(inbox.resolveInboxDirectory('  D:\\inbox  ', { homedir: '/x' }), 'D:\\inbox');
    assert.ok(inbox.resolveInboxDirectory('', { homedir: '/x' }).includes('PrintventoryInbox'));
  });

  await test('inbox beside database and unique dirs', () => {
    const beside = inbox.inboxDirectoryBesideDatabase(path.join('/app', 'data', 'printventory.db'));
    assert.ok(beside.replace(/\\/g, '/').endsWith('/data/PrintventoryInbox'));
    const uniq = inbox.uniqueInboxDirectories([beside, beside, '']);
    assert.strictEqual(uniq.length, 1);
  });

  await test('parseInboxPayload url-only', () => {
    const item = inbox.parseInboxPayload({
      version: 1,
      source: 'https://makerworld.com/en/models/1',
      parentModel: 'Clip',
      designer: 'Pat'
    });
    assert.strictEqual(item.filePath, 'url::https://makerworld.com/en/models/1');
    assert.strictEqual(item.fileName, 'Clip');
  });

  await test('importInbox saves ready files and moves to processed', async () => {
    const dir = path.join(os.tmpdir(), 'pv-inbox-test');
    const file = path.join(dir, 'a.pvimport.json');
    const stl = path.join(dir, 'part.stl');
    const fsApi = memFs({
      [dir]: '',
      [file]: JSON.stringify({
        version: 1,
        filePath: stl,
        parentModel: 'Part',
        source: 'https://example.com/m'
      }),
      [stl]: 'solid'
    });
    const saved = [];
    const result = await inbox.importInbox({
      inboxDir: dir,
      fs: fsApi,
      path,
      saveModel: async (model) => { saved.push(model); return { ok: true }; },
      nowMs: Date.now()
    });
    assert.strictEqual(result.imported, 1);
    assert.strictEqual(saved[0].parentModel, 'Part');
    assert.strictEqual(saved[0].filePath, stl);
    assert.strictEqual(saved[0].markAsNew, true);
    const processed = path.join(dir, 'processed', 'a.pvimport.json');
    assert.ok(fsApi._store[processed]);
  });

  await test('importInbox missing model file goes to failed', async () => {
    const dir = path.join(os.tmpdir(), 'pv-inbox-fail');
    const file = path.join(dir, 'b.pvimport.json');
    const fsApi = memFs({
      [dir]: '',
      [file]: JSON.stringify({
        version: 1,
        filePath: '/no/such/model.stl',
        parentModel: 'Gone'
      })
    });
    const result = await inbox.importInbox({
      inboxDir: dir,
      fs: fsApi,
      path,
      saveModel: async () => { throw new Error('should not save'); },
      nowMs: Date.now()
    });
    assert.strictEqual(result.failed, 1);
    assert.ok(fsApi._store[path.join(dir, 'failed', 'b.pvimport.json')]);
  });

  if (process.exitCode) process.exit(process.exitCode);
})();
