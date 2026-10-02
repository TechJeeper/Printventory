#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSlicerSpawnSpec, buildSlicerShellCommand, invalidSlicerPathError, launchSlicerProcess } = require('./slicer-launch');

const pending = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result.then(
        () => console.log(`ok ${name}`),
        (err) => {
          console.error(`FAIL ${name}:`, err.message);
          process.exitCode = 1;
        }
      ));
      return;
    }
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('flatpak PrusaSlicer is split and gets a new instance flag', () => {
  const spec = buildSlicerSpawnSpec(
    'flatpak run com.prusa3d.PrusaSlicer',
    ['/home/user/model.stl'],
    'linux'
  );
  assert.strictEqual(spec.command, 'flatpak');
  assert.deepStrictEqual(spec.args, [
    'run',
    'com.prusa3d.PrusaSlicer',
    '--single-instance=0',
    '/home/user/model.stl'
  ]);
  assert.strictEqual(
    buildSlicerShellCommand('flatpak run com.prusa3d.PrusaSlicer', ['/home/user/My Model.stl'], 'linux'),
    'flatpak run com.prusa3d.PrusaSlicer --single-instance=0 "/home/user/My Model.stl"'
  );
});

test('flatpak OrcaSlicer is split without the Prusa-only flag', () => {
  const spec = buildSlicerSpawnSpec(
    'flatpak run com.softfever3d.OrcaSlicer',
    ['/tmp/model.3mf'],
    'linux'
  );
  assert.deepStrictEqual(spec.args, ['run', 'com.softfever3d.OrcaSlicer', '/tmp/model.3mf']);
});

test('a Windows slicer path with spaces stays one executable', () => {
  const spec = buildSlicerSpawnSpec(
    'C:\\Program Files\\Bambu Studio\\bambu-studio.exe',
    ['\\\\server\\PrintLibrary\\Figures\\Shoe\\model.3mf'],
    'win32'
  );
  assert.strictEqual(spec.command, 'C:\\Program Files\\Bambu Studio\\bambu-studio.exe');
  assert.deepStrictEqual(spec.args, ['\\\\server\\PrintLibrary\\Figures\\Shoe\\model.3mf']);
});

test('a missing slicer exe is rejected before launch', () => {
  const missing = 'F:\\Program Files\\LycheeSlicer\\LycheeSlicer.exe';
  const invalid = invalidSlicerPathError(missing, 'Lychee Slicer');
  assert.ok(invalid);
  assert.strictEqual(invalid.code, 'INVALID_SLICER');
  assert.match(invalid.message, /Lychee Slicer/);
  assert.match(invalid.message, /F:\\Program Files\\LycheeSlicer\\LycheeSlicer.exe/);

  return launchSlicerProcess(
    { command: missing, args: ['model.stl'] },
    { name: 'Lychee Slicer', slicerPath: missing }
  ).then(
    () => {
      throw new Error('launch should reject a missing slicer');
    },
    (error) => {
      assert.strictEqual(error.code, 'INVALID_SLICER');
    }
  );
});

test('an existing program file is a valid slicer path', () => {
  const file = path.join(os.tmpdir(), 'printventory-slicer-ok.exe');
  fs.writeFileSync(file, '');
  try {
    assert.strictEqual(invalidSlicerPathError(file, 'Lychee Slicer'), null);
  } finally {
    fs.unlinkSync(file);
  }
});

test('a folder is not a valid slicer program', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printventory-slicer-dir-'));
  try {
    const invalid = invalidSlicerPathError(dir, 'Lychee Slicer');
    assert.ok(invalid);
    assert.match(invalid.message, /folder/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flatpak commands are not checked as local files', () => {
  assert.strictEqual(invalidSlicerPathError('flatpak run com.prusa3d.PrusaSlicer', 'PrusaSlicer'), null);
});

test('macOS app bundles open a new instance', () => {
  const spec = buildSlicerSpawnSpec(
    '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
    ['/Users/me/model.stl'],
    'darwin'
  );
  assert.strictEqual(spec.command, 'open');
  assert.deepStrictEqual(spec.args, [
    '-n',
    '-a',
    '/Applications/PrusaSlicer.app',
    '--args',
    '/Users/me/model.stl'
  ]);
});

Promise.all(pending).then(() => {
  if (process.exitCode) process.exit(process.exitCode);
});
