#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { buildSlicerSpawnSpec, buildSlicerShellCommand } = require('./slicer-launch');

function test(name, fn) {
  try {
    fn();
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
