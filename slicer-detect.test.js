#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectInstalledSlicers, identifySlicer } = require('./slicer-detect');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'printventory-slicers-'));
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

test('identifies known slicer executables and skips console tools', () => {
  assert.strictEqual(identifySlicer('C:\\Program Files\\Bambu Studio\\bambu-studio.exe').name, 'Bambu Studio');
  assert.strictEqual(identifySlicer('/Applications/OrcaSlicer.app').name, 'OrcaSlicer');
  assert.strictEqual(identifySlicer('C:\\Program Files\\Snapmaker Orca\\orca-slicer.exe').name, 'Snapmaker Orca');
  assert.strictEqual(identifySlicer('C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe'), null);
  assert.strictEqual(identifySlicer('C:\\Program Files\\UltiMaker Cura 5.9\\CuraEngine.exe'), null);
  assert.strictEqual(identifySlicer('/usr/bin/not-a-slicer'), null);
});

test('scans install folders and keeps versioned Cura installs distinct', () => {
  const root = makeTempRoot();
  try {
    touch(path.join(root, 'Bambu Studio', 'bambu-studio.exe'));
    touch(path.join(root, 'Bambu Studio', 'resources', 'ignore-me.exe'));
    touch(path.join(root, 'UltiMaker Cura 5.9.1', 'UltiMaker-Cura.exe'));
    touch(path.join(root, 'UltiMaker Cura 5.10.0', 'UltiMaker-Cura.exe'));
    touch(path.join(root, 'Notes', 'readme.txt'));
    touch(path.join(root, 'Creality', 'Creality Print', '5.1.0', 'CrealityPrint.exe'));

    const found = detectInstalledSlicers({
      platform: 'win32',
      scanRoots: [root],
      candidatePaths: []
    });
    const names = found.map((slicer) => slicer.name);
    assert.ok(names.includes('Bambu Studio'), names.join(', '));
    assert.ok(names.some((name) => name.includes('UltiMaker Cura') && name.includes('5.9.1')), names.join(', '));
    assert.ok(names.some((name) => name.includes('UltiMaker Cura') && name.includes('5.10.0')), names.join(', '));
    assert.ok(names.includes('Creality Print'), names.join(', '));
    assert.strictEqual(found.length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('finds macOS app bundles and linux candidate binaries', () => {
  const root = makeTempRoot();
  try {
    fs.mkdirSync(path.join(root, 'PrusaSlicer.app'), { recursive: true });
    const mac = detectInstalledSlicers({
      platform: 'darwin',
      scanRoots: [root],
      candidatePaths: []
    });
    assert.strictEqual(mac.length, 1);
    assert.strictEqual(mac[0].name, 'PrusaSlicer');
    assert.ok(mac[0].path.endsWith('PrusaSlicer.app'));

    const bin = path.join(root, 'prusa-slicer');
    touch(bin);
    const linux = detectInstalledSlicers({
      platform: 'linux',
      scanRoots: [],
      candidatePaths: [bin, path.join(root, 'missing-slicer')]
    });
    assert.strictEqual(linux.length, 1);
    assert.strictEqual(linux[0].name, 'PrusaSlicer');
    assert.strictEqual(linux[0].path, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
