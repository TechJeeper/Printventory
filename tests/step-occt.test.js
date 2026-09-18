'use strict';

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const occtimportjs = require('occt-import-js');

const CUBE_STEP = path.join(__dirname, 'fixtures', 'step-cube.stp');
const CUBE_IGES = path.join(__dirname, 'fixtures', 'iges-cube.igs');

let occt;

describe('STEP tessellation', () => {
  before(async () => {
    occt = await occtimportjs();
  });

  test('tessellates a simple STEP cube into mesh triangles', () => {
    const bytes = fs.readFileSync(CUBE_STEP);
    const result = occt.ReadStepFile(new Uint8Array(bytes), {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.01,
      angularDeflection: 0.5
    });
    assert.equal(result.success, true);
    assert.ok(result.meshes && result.meshes.length >= 1);
    const mesh = result.meshes[0];
    assert.ok(mesh.attributes.position.array.length >= 9);
    assert.ok(mesh.index.array.length >= 3);
  });

  test('tessellates a simple IGES cube into mesh triangles', () => {
    const bytes = fs.readFileSync(CUBE_IGES);
    const result = occt.ReadIgesFile(new Uint8Array(bytes), {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.01,
      angularDeflection: 0.5
    });
    assert.equal(result.success, true);
    assert.ok(result.meshes && result.meshes.length >= 1);
    const mesh = result.meshes[0];
    assert.ok(mesh.attributes.position.array.length >= 9);
    assert.ok(mesh.index.array.length >= 3);
  });
});
