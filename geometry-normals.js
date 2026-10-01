/**
 * Detect missing / all-zero mesh normals and recompute from vertex winding.
 *
 * Some STL exporters (e.g. certain Dungeon Blocks files) write valid binary
 * STLs with facet normals of (0,0,0). Loaders still create a normal attribute,
 * so code that only checks "normals present?" keeps the zeros and lit
 * materials shade to a flat silhouette.
 *
 * Works in Node (module.exports) and in browser / parse-worker (self.GeometryNormals).
 */

(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.GeometryNormals = exported;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ZERO_LEN_SQ = 1e-12;
  const MAX_SAMPLES = 64;

  /**
   * @param {object|TypedArray|null|undefined} normalAttr
   *   THREE.BufferAttribute-like `{ array, count }` or a flat float TypedArray.
   * @returns {boolean}
   */
  function normalsAreUsable(normalAttr) {
    if (!normalAttr) return false;

    let arr;
    let count;
    if (normalAttr.array) {
      arr = normalAttr.array;
      count = normalAttr.count != null
        ? normalAttr.count
        : Math.floor(arr.length / 3);
    } else if (typeof normalAttr.length === 'number') {
      arr = normalAttr;
      count = Math.floor(arr.length / 3);
    } else {
      return false;
    }

    if (!arr || count <= 0) return false;

    const sampleCount = Math.min(count, MAX_SAMPLES);
    const step = Math.max(1, Math.floor(count / sampleCount));
    for (let i = 0; i < count; i += step) {
      const o = i * 3;
      const x = arr[o];
      const y = arr[o + 1];
      const z = arr[o + 2];
      if ((x * x + y * y + z * z) > ZERO_LEN_SQ) return true;
    }
    return false;
  }

  /**
   * Ensure geometry has usable vertex normals for lit materials.
   * @param {object} geometry THREE.BufferGeometry
   * @returns {boolean} true if normals were recomputed
   */
  function ensureUsableVertexNormals(geometry) {
    if (!geometry || !geometry.attributes || !geometry.attributes.position) {
      return false;
    }
    if (normalsAreUsable(geometry.attributes.normal)) {
      return false;
    }
    if (typeof geometry.computeVertexNormals !== 'function') {
      return false;
    }
    geometry.computeVertexNormals();
    return true;
  }

  return {
    normalsAreUsable,
    ensureUsableVertexNormals
  };
});
