'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const THREE = require('../vendor/three.min.js');
global.THREE = THREE;
require('../vendor/OBJLoader.js');
require('../vendor/PLYLoader.js');

const TRI_OBJ = path.join(__dirname, 'fixtures', 'triangle.obj');
const TRI_PLY = path.join(__dirname, 'fixtures', 'triangle.ply');

describe('OBJ and PLY mesh parse', () => {
  test('OBJLoader parses a one-triangle OBJ', () => {
    const text = fs.readFileSync(TRI_OBJ, 'utf8');
    const object = new THREE.OBJLoader().parse(text);
    let positions = 0;
    object.traverse((child) => {
      if (child.isMesh && child.geometry && child.geometry.attributes.position) {
        positions += child.geometry.attributes.position.count;
      }
    });
    assert.ok(positions >= 3);
  });

  test('PLYLoader parses a one-triangle ASCII PLY', () => {
    const buffer = fs.readFileSync(TRI_PLY);
    const geometry = new THREE.PLYLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    assert.ok(geometry.attributes.position.count >= 3);
    assert.ok(geometry.index && geometry.index.count >= 3);
  });
});
