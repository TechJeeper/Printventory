#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { classifyStlBuffer, normalsAreMissing, repairZeroFaceNormals } = require('./stl-sanity');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('a PNG renamed to stl is rejected before a huge allocation', () => {
  const buf = Buffer.alloc(220);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf.writeUInt32LE(909454897, 80);
  assert.throws(() => classifyStlBuffer(buf), /does not match the file size/);
});

test('a one-triangle binary stl is accepted', () => {
  const buf = Buffer.alloc(84 + 50);
  buf.writeUInt32LE(1, 80);
  assert.strictEqual(classifyStlBuffer(buf), 'binary');
});

test('ascii stl is accepted', () => {
  const text = 'solid test\nfacet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test\n';
  assert.strictEqual(classifyStlBuffer(Buffer.from(text)), 'ascii');
});

test('a buffer of only zero normals counts as missing', () => {
  assert.strictEqual(normalsAreMissing(new Float32Array(27)), true);
  const ok = new Float32Array(27);
  ok[0] = 1;
  assert.strictEqual(normalsAreMissing(ok), false);
});

test('zero face normals are rebuilt from vertex winding', () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 0, 1, 0, 0, 0, 1
  ]);
  const normals = new Float32Array(18);
  normals.set([0, 1, 0, 0, 1, 0, 0, 1, 0], 9);
  assert.strictEqual(repairZeroFaceNormals(positions, normals), 1);
  assert.ok(Math.abs(normals[0]) < 1e-6);
  assert.ok(Math.abs(normals[1]) < 1e-6);
  assert.ok(Math.abs(normals[2] - 1) < 1e-6);
  assert.ok(Math.abs(normals[8] - 1) < 1e-6);
  assert.strictEqual(normals[10], 1);
  assert.strictEqual(normals[11], 0);
});
