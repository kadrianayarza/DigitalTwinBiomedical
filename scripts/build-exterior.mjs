// Builds public/models/exterior.glb, the reference outside body shown when a
// patient has no personal scan, from the Human Atlas packaging of BodyParts3D 4.0.
//
//   git clone --depth 1 https://github.com/ashemag/human-atlas.git ~/.cache/human-atlas
//   node scripts/build-exterior.mjs [path/to/human-atlas]
//
// Meshes: skin, scalp hair, eyebrows, lips. Output is aligned to the skin in
// public/models/anatomy.glb (same source body) so the anatomy layers, hotspots
// and clothing line up without any runtime fitting.
// BodyParts3D © The Database Center for Life Science, CC BY 4.0.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const SRC = process.argv[2] ?? path.join(os.homedir(), '.cache/human-atlas');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = path.join(ROOT, 'public/models');

const PARTS = [
  { id: 'FJ2810', name: 'skin', color: [0.79, 0.56, 0.44], roughness: 0.62 },
  { id: 'FJ2813', name: 'hair', color: [0.09, 0.065, 0.05], roughness: 0.9 },
  { id: 'FJ2812', name: 'eyebrow', color: [0.09, 0.065, 0.05], roughness: 0.9 },
  { id: 'FJ2814', name: 'lip', color: [0.6, 0.33, 0.3], roughness: 0.55 },
];

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const atlasDir = path.join(SRC, 'public/models');
const atlas = JSON.parse(fs.readFileSync(path.join(atlasDir, 'atlas.json'), 'utf8'));
const chunks = new Map();
const chunk = i => {
  if (!chunks.has(i)) {
    const buf = fs.readFileSync(path.join(SRC, 'public', atlas.chunks[i].url));
    chunks.set(i, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return chunks.get(i);
};

function readPart(id) {
  const p = atlas.parts.find(part => part.id === id);
  if (!p) throw new Error(`Human Atlas part ${id} not found`);
  const buf = chunk(p.chunk);
  const position = new Float32Array(buf, p.positions, p.vertexCount * 3).slice();
  const packed = new Int16Array(buf, p.normals, p.vertexCount * 3);
  const normal = new Float32Array(packed.length);
  for (let i = 0; i < packed.length; i += 3) {
    const x = Math.max(-1, packed[i] / 32767);
    const y = Math.max(-1, packed[i + 1] / 32767);
    const z = Math.max(-1, packed[i + 2] / 32767);
    const len = Math.hypot(x, y, z) || 1;
    normal.set([x / len, y / len, z / len], i);
  }
  const indices = new Uint32Array(buf, p.indices, p.indexCount).slice();
  return { position, normal, indices };
}

// Offset that maps the atlas skin onto the anatomy.glb skin (x/z centre, feet).
const anatomy = await io.read(path.join(OUT_DIR, 'anatomy.glb'));
const anatomySkin = anatomy.getRoot().listNodes().find(n => n.getName() === 'skin');
if (!anatomySkin) throw new Error('anatomy.glb has no skin node; run build-anatomy first');
const target = getBounds(anatomySkin);
const src = atlas.parts.find(p => p.id === PARTS[0].id).bounds;
const offset = [
  (target.min[0] + target.max[0]) / 2 - (src[0][0] + src[1][0]) / 2,
  target.min[1] - src[0][1],
  (target.min[2] + target.max[2]) / 2 - (src[0][2] + src[1][2]) / 2,
];

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('exterior');
for (const part of PARTS) {
  const { position, normal, indices } = readPart(part.id);
  for (let i = 0; i < position.length; i += 3) {
    position[i] += offset[0];
    position[i + 1] += offset[1];
    position[i + 2] += offset[2];
  }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(position).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normal).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
    .setMaterial(
      doc.createMaterial(part.name).setBaseColorFactor([...part.color, 1]).setRoughnessFactor(part.roughness).setMetallicFactor(0)
    );
  scene.addChild(doc.createNode(part.name).setMesh(doc.createMesh(part.name).addPrimitive(prim)));
}

doc.createExtension(EXTMeshoptCompression).setRequired(true);
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const out = path.join(OUT_DIR, 'exterior.glb');
await io.write(out, doc);
fs.writeFileSync(
  path.join(OUT_DIR, 'LICENSE-exterior.txt'),
  `exterior.glb: skin, scalp hair, eyebrows and lips from BodyParts3D 4.0,
(c) The Database Center for Life Science (DBCLS), licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/; https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
Geometry as packaged by Human Atlas (https://github.com/ashemag/human-atlas), simplified there
with meshoptimizer. Adapted here: translated to align with anatomy.glb, materials added,
meshopt-compressed.
`
);
console.log(`wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB), offset ${offset.map(v => v.toFixed(4)).join(', ')}`);
