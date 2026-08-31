/**
 * MeshyAI / Bambu Studio 3MF uses the Production Extension:
 * 3D/3dmodel.model is a component that points at 3D/Objects/object_1.model.
 * THREE.3MFLoader used to crash: Cannot read properties of undefined (reading 'mesh').
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fflate = require('fflate');
const {
  zipHasSplitModelParts,
  modelHasPlacementTransforms,
  extractAllMeshesFast,
  shouldUseFastPath
} = require('../threemf-mesh-extract.js');
const { Simple3MFLoader } = require('../threemf-loader-simple.js');

function cubeModelXml(objectId = '1') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <resources>
  <object id="${objectId}" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/>
     <vertex x="10" y="0" z="0"/>
     <vertex x="10" y="10" z="0"/>
     <vertex x="0" y="10" z="0"/>
     <vertex x="0" y="0" z="10"/>
     <vertex x="10" y="0" z="10"/>
     <vertex x="10" y="10" z="10"/>
     <vertex x="0" y="10" z="10"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2"/>
     <triangle v1="0" v2="2" v3="3"/>
     <triangle v1="4" v2="6" v3="5"/>
     <triangle v1="4" v2="7" v3="6"/>
     <triangle v1="0" v2="4" v3="5"/>
     <triangle v1="0" v2="5" v3="1"/>
     <triangle v1="1" v2="5" v3="6"/>
     <triangle v1="1" v2="6" v3="2"/>
     <triangle v1="2" v2="6" v3="7"/>
     <triangle v1="2" v2="7" v3="3"/>
     <triangle v1="3" v2="7" v3="4"/>
     <triangle v1="3" v2="4" v3="0"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>`;
}

function rootModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <resources>
  <object id="2" p:UUID="00000001-61cb-4c03-9d28-80fed5dfa1dc" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 125 125 0" printable="1"/>
 </build>
</model>`;
}

function makeProduction3mfBuffer() {
  const enc = new TextEncoder();
  const files = {
    '[Content_Types].xml': enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`),
    '_rels/.rels': enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`),
    '3D/_rels/3dmodel.model.rels': enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`),
    '3D/3dmodel.model': enc.encode(rootModelXml()),
    '3D/Objects/object_1.model': enc.encode(cubeModelXml('1'))
  };
  return fflate.zipSync(files).buffer;
}

describe('3MF Production Extension (MeshyAI / Bambu)', () => {
  test('zipHasSplitModelParts detects 3D/Objects/*.model', () => {
    assert.equal(zipHasSplitModelParts(['3D/3dmodel.model', '3D/Objects/object_1.model']), true);
    assert.equal(zipHasSplitModelParts(['3D/3dmodel.model']), false);
  });

  test('single mesh with plate-centering transform does not force DOM path', () => {
    const parts = [rootModelXml(), cubeModelXml('1')];
    assert.equal(modelHasPlacementTransforms(parts), false);
    assert.equal(shouldUseFastPath(parts), false);
  });

  test('extractAllMeshesFast finds the split-out object mesh', () => {
    const mesh = extractAllMeshesFast([rootModelXml(), cubeModelXml('1')], 100000);
    assert.ok(mesh.positions.length >= 9);
    assert.equal(mesh.sourceTriangles, 12);
    assert.equal(mesh.indices.length, 36);
  });

  test('Simple3MFLoader parses a Meshy-style split 3MF', () => {
    const loader = new Simple3MFLoader({ targetTriangles: 100000 });
    const json = loader.parse(makeProduction3mfBuffer());
    assert.ok(json);
    assert.ok(json.geometries && json.geometries[0]);
    const pos = json.geometries[0].data.attributes.position.array;
    assert.ok(pos.length >= 9);
    const idx = json.geometries[0].data.index.array;
    assert.equal(idx.length, 36);
  });
});
