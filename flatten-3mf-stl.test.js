'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fflate = require('fflate');
const { flatten3mfBufferToStl } = require('./flatten-3mf-stl');

function triangleXml(verts) {
  const [a, b, c] = verts;
  return `<mesh>
    <vertices>
      <vertex x="${a[0]}" y="${a[1]}" z="${a[2]}"/>
      <vertex x="${b[0]}" y="${b[1]}" z="${b[2]}"/>
      <vertex x="${c[0]}" y="${c[1]}" z="${c[2]}"/>
    </vertices>
    <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
  </mesh>`;
}

function modelXml(objects, items) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>${objects}</resources>
  <build>${items}</build>
</model>`;
}

function readTriangles(stl) {
  const count = stl.readUInt32LE(80);
  const triangles = [];
  let offset = 84;
  for (let i = 0; i < count; i++) {
    offset += 12;
    const verts = [];
    for (let v = 0; v < 3; v++) {
      verts.push([stl.readFloatLE(offset), stl.readFloatLE(offset + 4), stl.readFloatLE(offset + 8)]);
      offset += 12;
    }
    offset += 2;
    triangles.push(verts);
  }
  return triangles;
}

function closeTo(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < 1e-4, `${actual[i]} ~= ${expected[i]}`);
  }
}

describe('flatten 3mf to stl', () => {
  test('bakes a build-item translation into the STL', () => {
    const xml = modelXml(
      `<object id="1" type="model">${triangleXml([[0, 0, 0], [1, 0, 0], [0, 1, 0]])}</object>`,
      `<item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/>`
    );
    const zipped = fflate.zipSync({ '3D/3dmodel.model': Buffer.from(xml) });
    const triangles = readTriangles(flatten3mfBufferToStl(zipped));
    assert.equal(triangles.length, 1);
    closeTo(triangles[0][0], [10, 0, 0]);
    closeTo(triangles[0][1], [11, 0, 0]);
    closeTo(triangles[0][2], [10, 1, 0]);
  });

  test('follows a component in another model part and applies both transforms', () => {
    const part = modelXml(
      `<object id="1" type="model">${triangleXml([[0, 0, 0], [1, 0, 0], [0, 1, 0]])}</object>`,
      ''
    );
    const root = modelXml(
      `<object id="2" type="model">
        <components>
          <component objectid="1" p:path="/3D/Objects/part.model" transform="1 0 0 0 1 0 0 0 1 5 0 0"/>
        </components>
      </object>`,
      `<item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 3"/>`
    );
    const zipped = fflate.zipSync({
      '3D/3dmodel.model': Buffer.from(root),
      '3D/Objects/part.model': Buffer.from(part)
    });
    const triangles = readTriangles(flatten3mfBufferToStl(zipped));
    assert.equal(triangles.length, 1);
    closeTo(triangles[0][0], [5, 0, 3]);
    closeTo(triangles[0][1], [6, 0, 3]);
    closeTo(triangles[0][2], [5, 1, 3]);
  });

  test('skips support objects', () => {
    const xml = modelXml(
      `<object id="1" type="support">${triangleXml([[0, 0, 0], [1, 0, 0], [0, 1, 0]])}</object>
       <object id="2" type="model">${triangleXml([[0, 0, 1], [1, 0, 1], [0, 1, 1]])}</object>`,
      `<item objectid="1"/><item objectid="2"/>`
    );
    const zipped = fflate.zipSync({ '3D/3dmodel.model': Buffer.from(xml) });
    const triangles = readTriangles(flatten3mfBufferToStl(zipped));
    assert.equal(triangles.length, 1);
    closeTo(triangles[0][0], [0, 0, 1]);
  });
});
