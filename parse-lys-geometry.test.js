'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fflate = require('fflate');
const { parseLysGeometries, parseLysGeometryBlob } = require('./parse-lys-geometry');

function writeStride48Blob(triangles) {
  const count = triangles.length;
  const buf = Buffer.alloc(4 + count * 48);
  buf.writeUInt32LE(count, 0);
  for (let t = 0; t < count; t++) {
    const tri = triangles[t];
    let o = 4 + t * 48;
    for (let v = 0; v < 3; v++) {
      buf.writeFloatLE(tri[v][0], o);
      buf.writeFloatLE(tri[v][1], o + 4);
      buf.writeFloatLE(tri[v][2], o + 8);
      o += 12;
    }
    buf.writeFloatLE(0, o);
    buf.writeFloatLE(1, o + 4);
    buf.writeFloatLE(0, o + 8);
  }
  return buf;
}

function writeIndexedBlob(positions, indices) {
  const header = 20;
  const buf = Buffer.alloc(header + indices.length * 4 + positions.length * 4);
  buf.writeUInt32LE(1, 0);
  buf.writeUInt32LE(header, 4);
  buf.writeUInt32LE(indices.length, 8);
  buf.writeUInt32LE(positions.length, 12);
  let o = header;
  for (const i of indices) {
    buf.writeUInt32LE(i, o);
    o += 4;
  }
  for (const c of positions) {
    buf.writeFloatLE(c, o);
    o += 4;
  }
  return buf;
}

function wrapMango(name, blob) {
  const manifest = Buffer.from(JSON.stringify({
    mangoFiles: {
      [name]: { offset: '0', size: String(blob.length) },
      'scene.bin': { offset: String(blob.length), size: '4' }
    }
  }), 'utf8');
  return Buffer.concat([manifest, Buffer.alloc(8, 0), blob, Buffer.from('abcd')]);
}

describe('parse-lys-geometry', () => {
  test('parses stride-48 count header and swaps X/Z', () => {
    const blob = writeStride48Blob([
      [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    ]);
    const mesh = parseLysGeometryBlob(blob);
    assert.equal(mesh.positions.length, 9);
    assert.ok(Math.abs(mesh.positions[0] - 3) < 1e-5);
    assert.ok(Math.abs(mesh.positions[1] - 2) < 1e-5);
    assert.ok(Math.abs(mesh.positions[2] - 1) < 1e-5);
  });

  test('parses indexed mango .lys', () => {
    const blob = writeIndexedBlob(
      [0, 0, 0, 10, 0, 0, 0, 10, 0],
      [0, 1, 2]
    );
    const data = new Uint8Array(wrapMango('mesh.bin', blob));
    const meshes = parseLysGeometries(data);
    assert.equal(meshes.length, 1);
    assert.equal(meshes[0].positions.length, 9);
    assert.equal(meshes[0].indices.length, 3);
  });

  test('parses ZIP .lys geometry', () => {
    const blob = writeIndexedBlob(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [0, 1, 2]
    );
    const zip = fflate.zipSync({
      'o1.bin': new Uint8Array(blob),
      'scene.bin': new Uint8Array([1, 2, 3, 4])
    });
    const meshes = parseLysGeometries(zip);
    assert.equal(meshes.length, 1);
    assert.equal(meshes[0].indices[2], 2);
  });

  test('parses LYS_Black_Rose_Supported.lys when present', () => {
    const rose = 'C:/Users/cld/Downloads/LYS_Black_Rose_Supported.lys';
    if (!fs.existsSync(rose)) {
      return;
    }
    const data = new Uint8Array(fs.readFileSync(rose));
    const meshes = parseLysGeometries(data);
    assert.ok(meshes[0].positions.length >= 9);
    assert.equal(meshes[0].positions.length % 9, 0);
    assert.equal(meshes[0].positions.length / 9, 759594);
  });
});
