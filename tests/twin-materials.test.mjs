import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroundShadowTexture, createTwinMaterials, setTwinMaterialMode } from '../src/twin/materials.ts';

function materialsFor(t) {
  const materials = createTwinMaterials();
  t.after(() => Object.values(materials).forEach(material => material.dispose()));
  return materials;
}

test('outside skin is opaque and writes depth, including after returning from inside', t => {
  const materials = materialsFor(t);
  for (const inside of [false, true, false]) {
    setTwinMaterialMode(materials, inside, true);
    for (const name of ['skin', 'skinSurgical', 'realSkin']) {
      assert.equal(materials[name].transparent, inside);
      assert.equal(materials[name].depthWrite, !inside);
      assert.equal(materials[name].opacity, inside ? 0.1 : 1);
    }
  }
});

test('transparent layers never occlude deeper anatomy with their depth buffer', t => {
  const materials = materialsFor(t);
  setTwinMaterialMode(materials, true, true);
  assert.equal(materials.muscle.opacity, 0.45);
  assert.equal(materials.muscle.depthWrite, false);
  assert.equal(materials.muscle.transparent, true);
  setTwinMaterialMode(materials, true, false);
  assert.equal(materials.muscle.opacity, 1);
  assert.equal(materials.muscle.depthWrite, true);
  assert.equal(materials.muscle.transparent, false);
});

test('live updates do not repeatedly invalidate unchanged material programs', t => {
  const materials = materialsFor(t);
  setTwinMaterialMode(materials, true, true);
  const versions = Object.values(materials).map(material => material.version);
  for (let i = 0; i < 120; i++) setTwinMaterialMode(materials, true, true);
  assert.deepEqual(Object.values(materials).map(material => material.version), versions);
});

test('implant overlays cannot corrupt the depth buffer', t => {
  const materials = materialsFor(t);
  for (const material of [materials.implant, materials.insert]) {
    assert.equal(material.depthTest, false);
    assert.equal(material.depthWrite, false);
  }
});

test('the static ground shadow has transparent edges and a soft center', t => {
  const texture = createGroundShadowTexture();
  t.after(() => texture.dispose());
  const { data, width, height } = texture.image;
  assert.equal(data.length, width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(data[(y * width) * 4 + 3], 0);
    assert.equal(data[(y * width + width - 1) * 4 + 3], 0);
  }
  assert.ok(data[((height / 2) * width + width / 2) * 4 + 3] > 230);
});
