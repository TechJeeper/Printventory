#!/usr/bin/env node
'use strict';

const assert = require('assert');
const protocol = require('./slicer-protocol');

function test(name, fn) {
  try {
    fn();
    console.log('ok ' + name);
  } catch (err) {
    console.error('FAIL ' + name + ':', err.message);
    process.exitCode = 1;
  }
}

test('open URL round-trips files, origin, and slicer path', () => {
  const href = protocol.buildPrintventoryOpenUrl({
    origin: 'https://nas.local:8443/library',
    slicerName: 'OrcaSlicer',
    slicerPath: 'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe',
    filePaths: [
      '\\\\server\\library\\benchy.stl',
      '/data/models/box.zip::parts/lid.3mf'
    ]
  });
  const parsed = protocol.parsePrintventoryProtocolUrl(href);
  assert.strictEqual(parsed.origin, 'https://nas.local:8443');
  assert.strictEqual(parsed.slicerName, 'OrcaSlicer');
  assert.strictEqual(parsed.slicerPath, 'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe');
  assert.deepStrictEqual(parsed.filePaths, [
    '\\\\server\\library\\benchy.stl',
    '/data/models/box.zip::parts/lid.3mf'
  ]);
});

test('quoted protocol arguments still parse', () => {
  const href = protocol.buildPrintventoryOpenUrl({
    origin: 'http://127.0.0.1:5000',
    slicerName: 'PrusaSlicer',
    slicerPath: '/Applications/PrusaSlicer.app',
    filePaths: ['/library/My Model.stl']
  });
  const parsed = protocol.parsePrintventoryProtocolUrl('"' + href + '"');
  assert.strictEqual(parsed.filePaths[0], '/library/My Model.stl');
});

test('download URL stays on the allowed origin', () => {
  const url = protocol.buildModelDownloadUrl('https://nas.local:8443', '/library/a b.stl');
  assert.strictEqual(url, 'https://nas.local:8443/api/download/' + encodeURIComponent('/library/a b.stl'));
});

test('unknown servers are rejected', () => {
  assert.throws(
    () => protocol.assertOriginAllowed(['http://nas.local:5000'], 'http://evil.example'),
    /not allowed/
  );
  assert.strictEqual(
    protocol.assertOriginAllowed(['https://nas.local:8443/app'], 'https://nas.local:8443'),
    'https://nas.local:8443'
  );
});

test('shell syntax in a slicer path is rejected', () => {
  assert.throws(() => protocol.assertSafeSlicerPath('/usr/bin/orca;rm -rf /', 'linux'), /shell syntax/);
  assert.strictEqual(
    protocol.assertSafeSlicerPath('flatpak run com.prusa3d.PrusaSlicer', 'linux'),
    'flatpak run com.prusa3d.PrusaSlicer'
  );
  assert.strictEqual(
    protocol.assertSafeSlicerPath('C:\\Program Files\\OrcaSlicer\\orca-slicer.exe', 'win32'),
    'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe'
  );
  assert.throws(
    () => protocol.assertSafeSlicerPath('C:\\Program Files\\OrcaSlicer\\orca-slicer.exe', 'linux'),
    /Windows slicer path/
  );
});

test('a local slicer with the same name overrides the server path', () => {
  const resolved = protocol.resolveHelperSlicer(
    [{ name: 'OrcaSlicer', path: '/usr/bin/orca-slicer' }],
    { slicerName: 'OrcaSlicer', slicerPath: '/wrong/path' },
    'linux'
  );
  assert.strictEqual(resolved.path, '/usr/bin/orca-slicer');
  assert.strictEqual(resolved.source, 'local');
});

test('server slicer path is used when this computer has no local match', () => {
  const resolved = protocol.resolveHelperSlicer(
    [],
    { slicerName: 'Bambu Studio', slicerPath: '/Applications/BambuStudio.app' },
    'darwin'
  );
  assert.strictEqual(resolved.path, '/Applications/BambuStudio.app');
  assert.strictEqual(resolved.source, 'server');
});
