#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  normalizeDir,
  ancestorChain,
  toDirectoryFilter,
  buildFolderForest
} = require('./folder-tree-lib');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

function findNode(nodes, path) {
  const want = String(path).replace(/\\/g, '/').toLowerCase();
  const stack = [...(nodes || [])];
  while (stack.length) {
    const n = stack.pop();
    if (String(n.path).replace(/\\/g, '/').toLowerCase() === want) return n;
    if (n.children) stack.push(...n.children);
  }
  return null;
}

test('normalizeDir strips trailing slashes and backslashes', () => {
  assert.strictEqual(normalizeDir('C:\\Models\\'), 'C:/Models');
  assert.strictEqual(normalizeDir('//nas/share/lib/'), '//nas/share/lib');
});

test('ancestorChain skips url-only models', () => {
  assert.deepStrictEqual(ancestorChain('url::https://example.com/m'), []);
});

test('ancestorChain walks folders and zip entries', () => {
  const chain = ancestorChain('C:\\Models\\Patreon\\Dragons\\foo.stl');
  assert.ok(chain.some((c) => c.path === 'C:/Models/Patreon/Dragons'));
  const zip = ancestorChain('C:/Models/pack.zip::inner/dir/part.stl');
  const zipNode = zip.find((c) => c.isBundle);
  assert.ok(zipNode);
  assert.strictEqual(zipNode.path, 'C:/Models/pack.zip');
  assert.ok(zip.some((c) => c.path === 'C:/Models/pack.zip::inner/dir'));
});

test('toDirectoryFilter suffixes zip bundles with ::', () => {
  assert.strictEqual(toDirectoryFilter('C:/Models/pack.zip', true), 'C:/Models/pack.zip::');
  assert.strictEqual(toDirectoryFilter('C:/Models/Patreon', false), 'C:/Models/Patreon');
});

test('STL Home is labeled and nested counts include children', () => {
  const forest = buildFolderForest([
    'C:/Models/Patreon/Dragons/a.stl',
    'C:/Models/Patreon/Dragons/b.3mf',
    'C:/Models/Prints/box.stl'
  ], { stlHome: 'C:/Models' });
  assert.strictEqual(forest.roots.length, 1);
  assert.strictEqual(forest.roots[0].label, 'STL Home');
  assert.strictEqual(forest.roots[0].count, 3);
  const patreon = findNode(forest.roots, 'C:/Models/Patreon');
  assert.ok(patreon);
  assert.strictEqual(patreon.count, 2);
  const dragons = findNode(forest.roots, 'C:/Models/Patreon/Dragons');
  assert.strictEqual(dragons.count, 2);
  const prints = findNode(forest.roots, 'C:/Models/Prints');
  assert.strictEqual(prints.count, 1);
});

test('does not emit a drive-letter root above STL Home', () => {
  const forest = buildFolderForest([
    'C:/Models/a.stl'
  ], { stlHome: 'C:/Models' });
  assert.strictEqual(forest.roots.length, 1);
  assert.strictEqual(forest.roots[0].path, 'C:/Models');
});

test('zip bundles are marked and counted', () => {
  const forest = buildFolderForest([
    'C:/Models/pack.zip::folder/part.stl',
    'C:/Models/pack.zip::folder/other.3mf'
  ], { stlHome: 'C:/Models' });
  const zip = findNode(forest.roots, 'C:/Models/pack.zip');
  assert.ok(zip);
  assert.strictEqual(zip.isBundle, true);
  assert.strictEqual(zip.count, 2);
  const inner = findNode(forest.roots, 'C:/Models/pack.zip::folder');
  assert.ok(inner);
  assert.strictEqual(inner.count, 2);
});

test('orphan scans cluster by shared prefix, not the whole drive', () => {
  const forest = buildFolderForest([
    'D:/USB/Dragons/a.stl',
    'D:/USB/Cats/b.stl',
    'E:/Prints/foo.stl'
  ], { stlHome: 'C:/Models' });
  const labels = forest.roots.map((r) => r.path).sort();
  assert.ok(labels.includes('D:/USB'), labels.join(','));
  assert.ok(labels.includes('E:/Prints'), labels.join(','));
  assert.ok(!labels.includes('D:'), labels.join(','));
  assert.ok(!labels.includes('C:/Models'), labels.join(','));
});

test('UNC paths keep the share as a root when that is the scan dir', () => {
  const forest = buildFolderForest([
    '//nas/share/lib/Patreon/a.stl',
    '//nas/share/lib/Prints/b.stl'
  ], { stlHome: '//nas/share/lib' });
  assert.strictEqual(forest.roots.length, 1);
  assert.strictEqual(forest.roots[0].label, 'STL Home');
  assert.strictEqual(forest.roots[0].count, 2);
});

test('case-insensitive matching against STL Home', () => {
  const forest = buildFolderForest([
    'c:\\models\\patreon\\a.stl'
  ], { stlHome: 'C:/Models' });
  assert.strictEqual(forest.roots.length, 1);
  assert.strictEqual(forest.roots[0].label, 'STL Home');
  assert.strictEqual(forest.roots[0].count, 1);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
