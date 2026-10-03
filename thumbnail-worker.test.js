'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fflate = require('fflate');
const { renderWithStlThumb, runThumbnailQueue } = require('./thumbnail-worker');

function writeSample3mf(dest) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="0" y="1" z="0"/>
        </vertices>
        <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;
  fs.writeFileSync(dest, Buffer.from(fflate.zipSync({
    '3D/3dmodel.model': Buffer.from(xml)
  })));
}

describe('thumbnail worker', () => {
  test('3MF is flattened to STL before stl-thumb runs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-thumb-'));
    const src = path.join(dir, 'part.3mf');
    const stl = path.join(dir, 'flat.stl');
    const png = path.join(dir, 'flat.png');
    writeSample3mf(src);
    const seen = [];
    const image = await renderWithStlThumb(src, {
      tempStlPath: stl,
      pngPath: png,
      runStlThumb: async (_bin, inputPath, outputPath) => {
        seen.push(inputPath);
        assert.equal(path.extname(inputPath).toLowerCase(), '.stl');
        assert.notEqual(path.resolve(inputPath), path.resolve(src));
        assert.ok(fs.statSync(inputPath).size > 84);
        fs.writeFileSync(outputPath, Buffer.from([1, 2, 3, 4]));
      }
    });
    assert.deepEqual(seen, [stl]);
    assert.equal(image, 'data:image/png;base64,AQIDBA==');
  });

  test('a batch of known failures is excluded so later models are rendered', async () => {
    const library = [
      { id: 1, filePath: 'bad.3mf' },
      { id: 2, filePath: 'also-bad.3mf' },
      { id: 3, filePath: 'ok.stl' }
    ];
    const fetches = [];
    const saved = [];
    const summary = await runThumbnailQueue({
      limit: 2,
      fetchBatch: async (query) => {
        fetches.push(query.excludeIds.slice());
        const excluded = new Set(query.excludeIds);
        return library.filter((model) => !excluded.has(model.id)).slice(0, query.limit);
      },
      render: async (model) => {
        if (model.filePath.endsWith('.3mf')) throw new Error('failed to fill whole buffer');
        return 'data:image/png;base64,ok';
      },
      setThumbnail: async (model, image) => {
        saved.push({ id: model.id, image });
      }
    });
    assert.deepEqual(saved, [{ id: 3, image: 'data:image/png;base64,ok' }]);
    assert.deepEqual(summary.excludeIds, [1, 2]);
    assert.equal(summary.rendered, 1);
    assert.equal(summary.failed, 2);
    assert.deepEqual(fetches[0], []);
    assert.ok(fetches.some((ids) => ids.includes(1) && ids.includes(2)));
  });

  test('stops when the server keeps returning only known failures', async () => {
    await assert.rejects(
      () => runThumbnailQueue({
        limit: 1,
        fetchBatch: async () => [{ id: 7, filePath: 'stuck.stl' }],
        render: async () => {
          throw new Error('cannot render');
        },
        setThumbnail: async () => {}
      }),
      (err) => err.code === 'QUEUE_STUCK'
    );
  });
});
