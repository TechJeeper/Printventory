#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const JSZip = require('jszip');
const bundle = require('./install-bundle');

async function test(name, fn) {
  try {
    await fn();
    console.log('ok ' + name);
  } catch (err) {
    console.error('FAIL ' + name + ':', err.message);
    process.exitCode = 1;
  }
}

async function main() {
  await test('origin keeps the host and drops a path', () => {
    assert.strictEqual(bundle.safePublicOrigin('https://nas.local:8443/library'), 'https://nas.local:8443');
  });

  await test('origin rejects anything that is not http(s)', () => {
  assert.throws(() => bundle.safePublicOrigin('file:///tmp/evil'), /http or https/);
});

  await test('request host is the server the bundle connects to', () => {
  const origin = bundle.originFromRequest({
    protocol: 'http',
    get(name) {
      if (name === 'host') return '192.168.1.20:5000';
      return '';
    }
  });
  assert.strictEqual(origin, 'http://192.168.1.20:5000');
});

  await test('forwarded https host is used when a proxy terminates TLS', () => {
  const origin = bundle.originFromRequest({
    protocol: 'http',
    get(name) {
      if (name === 'x-forwarded-proto') return 'https';
      if (name === 'x-forwarded-host') return 'printventory.home:8443';
      if (name === 'host') return '127.0.0.1:5000';
      return '';
    }
  });
  assert.strictEqual(origin, 'https://printventory.home:8443');
});

  await test('zip is stamped with this server and the installer files', async () => {
  const appDir = path.join(__dirname, '..');
  const bytes = await bundle.buildHelperBundle({
    appDir,
    origin: 'http://nas.local:5000',
    insecure: true
  });
  const zip = await JSZip.loadAsync(bytes);
  const config = JSON.parse(await zip.file('helper-config.json').async('string'));
  assert.deepStrictEqual(config.origins, ['http://nas.local:5000']);
  assert.strictEqual(config.tlsInsecure, true);
  assert.ok(zip.file('printventory-helper.js'));
  assert.ok(zip.file('slicer-protocol.js'));
  assert.ok(zip.file('slicer-launch.js'));
  assert.ok(zip.file('install.cmd'));
  assert.ok(zip.file('install.command'));
  const readme = await zip.file('INSTALL.txt').async('string');
  assert.ok(readme.includes('http://nas.local:5000'));
  const cmd = await zip.file('install.cmd').async('string');
  assert.ok(cmd.includes('install --from-bundle'));
  assert.ok(cmd.includes('https://nodejs.org/dist/latest-lts/'));
  assert.ok(!cmd.includes('nas.local'));
  const sh = await zip.file('install.sh').async('string');
  assert.ok(sh.includes('https://nodejs.org/dist/latest-lts/'));
  assert.ok(sh.includes('darwin-arm64'));
  assert.ok(sh.includes('linux-x64'));
  });
}

main();
