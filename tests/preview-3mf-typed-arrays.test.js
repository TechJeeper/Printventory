/**
 * Regression for GitHub #72:
 * Float32Array/Uint32Array geometry buffers must survive JSON transport
 * (WebSocket bridge in server mode). Plain JSON.stringify mangles them into
 * objects with numeric keys; THREE.ObjectLoader then builds empty buffers.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

function normalizePreview3mfTypedArrays(json) {
  if (!json || !Array.isArray(json.geometries)) return json;
  for (const geometry of json.geometries) {
    const data = geometry && geometry.data;
    if (!data) continue;
    if (data.attributes) {
      for (const key of Object.keys(data.attributes)) {
        const attr = data.attributes[key];
        if (attr && attr.array != null && !Array.isArray(attr.array)) {
          attr.array = ArrayBuffer.isView(attr.array)
            ? Array.from(attr.array)
            : Object.values(attr.array);
        }
      }
    }
    if (data.index && data.index.array != null && !Array.isArray(data.index.array)) {
      data.index.array = ArrayBuffer.isView(data.index.array)
        ? Array.from(data.index.array)
        : Object.values(data.index.array);
    }
  }
  return json;
}

function jsonStringifyForWs(payload) {
  return JSON.stringify(payload, (_key, value) => {
    if (ArrayBuffer.isView(value)) {
      return Array.from(value);
    }
    return value;
  });
}

function samplePreviewJson() {
  return {
    metadata: { type: 'Object', generator: 'Simple3MFLoader' },
    geometries: [{
      uuid: 'g1',
      type: 'BufferGeometry',
      data: {
        attributes: {
          position: {
            itemSize: 3,
            type: 'Float32Array',
            array: new Float32Array([-1.8477, 279.9078, 0.5, 1, 2, 3])
          },
          normal: {
            itemSize: 3,
            type: 'Float32Array',
            array: new Float32Array([0, 1, 0, 0, 1, 0])
          }
        },
        index: { type: 'Uint32Array', array: new Uint32Array([0, 1, 2]) }
      }
    }]
  };
}

describe('3MF preview typed-array JSON transport (#72)', () => {
  test('plain JSON.stringify mangles typed arrays into empty ObjectLoader buffers', () => {
    const mangled = JSON.parse(JSON.stringify(samplePreviewJson()));
    const position = mangled.geometries[0].data.attributes.position.array;

    assert.equal(Array.isArray(position), false);
    assert.equal(new Float32Array(position).length, 0);
  });

  test('jsonStringifyForWs preserves geometry arrays as real arrays', () => {
    const roundTripped = JSON.parse(jsonStringifyForWs({
      type: 'result',
      result: samplePreviewJson()
    }));
    const position = roundTripped.result.geometries[0].data.attributes.position.array;
    const index = roundTripped.result.geometries[0].data.index.array;

    assert.equal(Array.isArray(position), true);
    assert.equal(position.length, 6);
    assert.equal(new Float32Array(position).length, 6);
    assert.equal(Array.isArray(index), true);
    assert.deepEqual(index, [0, 1, 2]);
  });

  test('normalizePreview3mfTypedArrays recovers mangled payloads', () => {
    const mangled = JSON.parse(JSON.stringify(samplePreviewJson()));
    normalizePreview3mfTypedArrays(mangled);

    const position = mangled.geometries[0].data.attributes.position.array;
    const index = mangled.geometries[0].data.index.array;

    assert.equal(Array.isArray(position), true);
    assert.equal(position.length, 6);
    assert.equal(new Float32Array(position).length, 6);
    assert.ok(Math.abs(position[0] - -1.8477) < 1e-4);
    assert.deepEqual(index, [0, 1, 2]);
  });

  test('normalize is a no-op for already-plain arrays', () => {
    const json = samplePreviewJson();
    normalizePreview3mfTypedArrays(json);
    const before = json.geometries[0].data.attributes.position.array.slice();
    normalizePreview3mfTypedArrays(json);
    assert.deepEqual(json.geometries[0].data.attributes.position.array, before);
  });
});
