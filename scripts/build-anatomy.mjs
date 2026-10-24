// Builds public/models/anatomy.glb from BodyParts3D OBJ files.
//
//   node scripts/build-anatomy.mjs [path/to/bp3d]
//
// The source directory needs isa_element_parts.txt and the unzipped
// isa_BP3D_4.0_obj_99/ folder from https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
// Positions and indices only; the client computes smooth normals on load.
// Output meshes are derived from BodyParts3D, (c) The Database Center for Life
// Science, CC BY-SA 2.1 Japan, and are redistributed under the same license.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, quantize, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const SRC = process.argv[2] ?? path.join(os.homedir(), '.cache/bp3d');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = path.join(ROOT, 'public/models');

// BodyParts3D: millimetres, Z up, front is -Y, patient's right is -X.
// Twin frame: metres, Y up, front is +Z, feet at y=0, knees near z=0.
const FEET_MM = 78.1;
const KNEE_DEPTH_MM = 81;
const toTwin = (x, y, z) => [x / 1000, (z + FEET_MM) / 1000, (-y - KNEE_DEPTH_MM) / 1000];

const LAYERS = [
  // error is relative to the mesh extent (~1.7 m), so 0.002 ≈ 3 mm.
  { name: 'skin', concepts: ['FMA7163'], ratio: 0.5, error: 0.0015 },
  { name: 'muscle', concepts: ['FMA5022'], ratio: 0.12, error: 0.004 },
  { name: 'bone', concepts: ['FMA5018'], ratio: 0.35, error: 0.002 },
  { name: 'artery', concepts: ['FMA50720'], ratio: 0.12, error: 0.004 },
  { name: 'vein', concepts: ['FMA50723'], ratio: 0.12, error: 0.004 },
];

const LANDMARKS = [
  'right patella',
  'left patella',
  'right femur',
  'left femur',
  'right tibia',
  'left tibia',
  'right soleus',
  'left soleus',
  'right popliteal vein',
  'left popliteal vein',
  'body of sternum',
];

function findObjDir() {
  for (const d of ['isa/isa_BP3D_4.0_obj_99', 'isa_BP3D_4.0_obj_99', 'isa']) {
    const p = path.join(SRC, d);
    if (fs.existsSync(p) && fs.readdirSync(p).some(f => f.endsWith('.obj'))) return p;
  }
  throw new Error(`No isa OBJ folder under ${SRC}`);
}

const objDir = findObjDir();
const conceptFiles = new Map();
const nameFiles = new Map();
for (const line of fs.readFileSync(path.join(SRC, 'isa_element_parts.txt'), 'utf8').split('\n').slice(1)) {
  const [concept, name, file] = line.trim().split('\t');
  if (!file) continue;
  if (!conceptFiles.has(concept)) conceptFiles.set(concept, new Set());
  conceptFiles.get(concept).add(file);
  if (!nameFiles.has(name)) nameFiles.set(name, new Set());
  nameFiles.get(name).add(file);
}

function readObj(file) {
  const p = path.join(objDir, `${file}.obj`);
  if (!fs.existsSync(p)) return null;
  const v = [];
  const idx = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/);
      v.push(toTwin(+x, +y, +z));
    } else if (line.startsWith('f ')) {
      const ids = line.trim().split(/\s+/).slice(1).map(t => parseInt(t, 10) - 1);
      for (let i = 1; i + 1 < ids.length; i++) idx.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  return { v, idx };
}

function merge(files) {
  const pos = [];
  const idx = [];
  let used = 0;
  for (const f of files) {
    const m = readObj(f);
    if (!m) continue;
    used++;
    const base = pos.length / 3;
    for (const p of m.v) pos.push(...p);
    for (const i of m.idx) idx.push(base + i);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), used };
}

function bounds(files) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const f of files) {
    const m = readObj(f);
    if (!m) continue;
    for (const p of m.v)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
  }
  if (!Number.isFinite(min[0])) return null;
  const r = n => Math.round(n * 10000) / 10000;
  return { min: min.map(r), max: max.map(r), center: min.map((m, k) => r((m + max[k]) / 2)) };
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('anatomy');
const claimed = new Set();

for (const layer of LAYERS) {
  const files = new Set();
  for (const c of layer.concepts) for (const f of conceptFiles.get(c) ?? []) if (!claimed.has(f)) files.add(f);
  for (const f of files) claimed.add(f);
  const { pos, idx, used } = merge(files);
  console.log(`${layer.name}: ${used} meshes, ${pos.length / 3} vertices, ${idx.length / 3} triangles`);
  if (!used) continue;
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
    .setExtras({ ratio: layer.ratio, error: layer.error });
  const mesh = doc.createMesh(layer.name).addPrimitive(prim);
  scene.addChild(doc.createNode(layer.name).setMesh(mesh));
}

await doc.transform(weld());
for (const mesh of doc.getRoot().listMeshes()) {
  const prim = mesh.listPrimitives()[0];
  const { ratio = 0.5, error = 0.002 } = prim.getExtras();
  simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error });
  prim.setExtras({});
  console.log(`  ${mesh.getName()} after simplify: ${prim.getAttribute('POSITION').getCount()} vertices`);
}
doc.createExtension(KHRMeshQuantization).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: 'filter' });
await doc.transform(quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));

fs.mkdirSync(OUT_DIR, { recursive: true });
const glbPath = path.join(OUT_DIR, 'anatomy.glb');
await new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  .write(glbPath, doc);
console.log(`wrote ${glbPath} (${(fs.statSync(glbPath).size / 1024).toFixed(0)} KB)`);

const landmarks = {};
for (const name of LANDMARKS) {
  const files = nameFiles.get(name);
  const b = files && bounds(files);
  if (b) landmarks[name.replace(/ /g, '_')] = b;
  else console.warn(`landmark missing: ${name}`);
}
const lmPath = path.join(ROOT, 'src/twin/anatomy-landmarks.json');
fs.writeFileSync(lmPath, JSON.stringify(landmarks, null, 2) + '\n');
console.log(`wrote ${lmPath}`);
