'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalsAreUsable, ensureUsableVertexNormals } = require('../geometry-normals.js');

const THREE = require('../vendor/three.min.js');
global.THREE = THREE;
require('../vendor/STLLoader.js');

function buildBinaryStl({ normals, triangles }) {
  const header = Buffer.alloc(80, 0);
  Buffer.from('zero-normal test').copy(header);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(triangles.length, 0);
  const parts = [header, count];
  for (const tri of triangles) {
    const rec = Buffer.alloc(50);
    const n = normals || [0, 0, 0];
    rec.writeFloatLE(n[0], 0);
    rec.writeFloatLE(n[1], 4);
    rec.writeFloatLE(n[2], 8);
    let o = 12;
    for (const v of tri) {
      rec.writeFloatLE(v[0], o);
      rec.writeFloatLE(v[1], o + 4);
      rec.writeFloatLE(v[2], o + 8);
      o += 12;
    }
    parts.push(rec);
  }
  return Buffer.concat(parts);
}

describe('geometry-normals', () => {
  test('normalsAreUsable rejects missing and all-zero arrays', () => {
    assert.equal(normalsAreUsable(null), false);
    assert.equal(normalsAreUsable(new Float32Array(0)), false);
    assert.equal(normalsAreUsable(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
    assert.equal(normalsAreUsable({ array: new Float32Array(9), count: 3 }), false);
  });

  test('normalsAreUsable accepts a non-zero sample', () => {
    const arr = new Float32Array(9 * 10);
    arr[15] = 1; // one component non-zero
    assert.equal(normalsAreUsable(arr), true);
    assert.equal(normalsAreUsable({ array: arr, count: 10 }), true);
  });

  test('ensureUsableVertexNormals recomputes zeroed STL facet normals', () => {
    const buf = buildBinaryStl({
      normals: [0, 0, 0],
      triangles: [
        [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        [[0, 0, 0], [0, 1, 0], [0, 0, 1]]
      ]
    });
    const geometry = new THREE.STLLoader().parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );

    assert.ok(geometry.attributes.normal, 'STLLoader still writes a normal attribute');
    assert.equal(normalsAreUsable(geometry.attributes.normal), false);

    const recomputed = ensureUsableVertexNormals(geometry);
    assert.equal(recomputed, true);
    assert.equal(normalsAreUsable(geometry.attributes.normal), true);

    const n = geometry.attributes.normal.array;
    // First triangle lies in XY → expected face normal near +Z
    assert.ok(Math.abs(n[2]) > 0.5, `expected +Z normal, got ${n[0]},${n[1]},${n[2]}`);
  });

  test('ensureUsableVertexNormals leaves good STL normals alone', () => {
    const cubePath = path.join(__dirname, 'test-fixtures', 'scan-me', 'cube.stl');
    const text = fs.readFileSync(cubePath);
    const geometry = new THREE.STLLoader().parse(
      text.buffer.slice(text.byteOffset, text.byteOffset + text.byteLength)
    );
    assert.equal(normalsAreUsable(geometry.attributes.normal), true);
    const before = Float32Array.from(geometry.attributes.normal.array);
    const recomputed = ensureUsableVertexNormals(geometry);
    assert.equal(recomputed, false);
    assert.deepEqual(Array.from(geometry.attributes.normal.array), Array.from(before));
  });
});
