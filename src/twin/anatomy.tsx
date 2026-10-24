import { Component, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import landmarkData from './anatomy-landmarks.json';
import { SKIN, regionForHit, type HotspotId, type Part } from './bodyModel';

export const ANATOMY_URL = '/models/anatomy.glb';
export const ANATOMY_CREDIT = 'BodyParts3D © DBCLS · CC BY-SA 2.1 JP';

/** Provider asset hosts send no CORS headers; load their GLBs through the same-origin proxy. */
export function proxiedTwinUrl(url: string): string {
  return /^https:\/\/([\w-]+\.)*meshy\.ai\//i.test(url) ? `/twin-proxy?url=${encodeURIComponent(url)}` : url;
}

export type AnatomyLayer = 'skin' | 'muscle' | 'bone' | 'artery' | 'vein';
type Vec3 = [number, number, number];
type Box = { min: Vec3; max: Vec3; center: Vec3 };
const LM = landmarkData as unknown as Record<string, Box>;

/** Loads anatomy.glb and returns plain float geometries in twin space, one per layer. */
export function useAnatomy(side: 'l' | 'r') {
  const gltf = useGLTF(ANATOMY_URL);
  return useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const out: Partial<Record<AnatomyLayer, THREE.BufferGeometry>> = {};
    gltf.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      out[mesh.name as AnatomyLayer] = toFloatGeometry(mesh.geometry, mesh.matrixWorld);
    });
    if (out.skin) paintSkin(out.skin, side);
    return out;
  }, [gltf, side]);
}

// Quantized glTF attributes are normalized ints with the scale on the node; bake to float.
function toFloatGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const attr = src.getAttribute(name);
    if (!attr) continue;
    const arr = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) arr.set([attr.getX(i), attr.getY(i), attr.getZ(i)], i * 3);
    g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
  g.applyMatrix4(matrix);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const SKIN_BASE = new THREE.Color('#e6c4a9');
const SKIN_SURGICAL = new THREE.Color('#f2a98d');
const TOP = new THREE.Color('#b9cfe6');
const SHORTS = new THREE.Color('#4b5f7a');

const ramp = (v: number, a: number, b: number) => THREE.MathUtils.smoothstep(v, a, b);
const band = (v: number, lo: number, hi: number, soft: number) =>
  ramp(v, lo - soft, lo + soft) * (1 - ramp(v, hi - soft, hi + soft));

/** Vertex colors keep the reference body covered beneath its clothing. */
function paintSkin(g: THREE.BufferGeometry, side: 'l' | 'r') {
  const sx = side === 'r' ? -1 : 1;
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const ax = Math.abs(x);
    const surgical = ramp(x * sx, 0.01, 0.035) * band(y, 0.24, 0.7, 0.04);
    const top = band(y, 0.99, 1.4, 0.01) * (1 - ramp(ax, 0.145, 0.17));
    const shorts = band(y, 0.69, 0.99, 0.004) * (1 - ramp(ax, 0.18, 0.21));
    c.copy(SKIN_BASE).lerp(SKIN_SURGICAL, surgical).lerp(TOP, top).lerp(SHORTS, shorts);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

type LoadResult = { gltf: THREE.Group } | { failed: true };
type LoadState = { status: 'pending'; promise: Promise<LoadResult> } | { status: 'done'; result: LoadResult };
const gltfCache = new Map<string, { current: LoadState }>();

function readGltf(url: string): LoadState {
  let cell = gltfCache.get(url);
  if (!cell) {
    const promise = new Promise<LoadResult>(resolve => {
      // Always resolve: a loader failure must never escape as an uncaught async
      // error, which would break the R3F render loop for the whole scene.
      new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .load(url, gltf => resolve({ gltf: gltf.scene }), undefined, () => resolve({ failed: true }));
    });
    const created: { current: LoadState } = { current: { status: 'pending', promise } };
    promise.then(result => {
      created.current = { status: 'done', result };
    });
    gltfCache.set(url, created);
    cell = created;
  }
  return cell.current;
}

/** Starts loading a GLB without suspending and re-renders once it settles. */
export function useGltfStatus(url: string | undefined): 'idle' | 'loading' | 'ready' | 'failed' {
  const [, settled] = useState(0);
  const entry = url ? readGltf(url) : undefined;
  useEffect(() => {
    if (entry?.status !== 'pending') return;
    let live = true;
    void entry.promise.then(() => live && settled(n => n + 1));
    return () => {
      live = false;
    };
  }, [entry]);
  if (!entry) return 'idle';
  if (entry.status === 'pending') return 'loading';
  return 'failed' in entry.result ? 'failed' : 'ready';
}

/** Suspends until the GLB settles; load failures come back as `{ failed: true }`. */
function useGltfSafe(url: string): LoadResult {
  const entry = readGltf(url);
  if (entry.status === 'pending') throw entry.promise;
  return entry.result;
}

/** Loads a Meshy image-to-3D exterior and scales it to the reference anatomy, feet at y=0. */
export function PhotoSkin({
  url,
  height = 1.72,
  onReady,
  onError,
}: {
  url: string;
  height?: number;
  onReady: (o: THREE.Object3D) => void;
  onError: () => void;
}) {
  const load = useGltfSafe(url);
  const failed = 'failed' in load;
  useEffect(() => {
    if (failed) onError();
  }, [failed, onError]);
  const object = useMemo(() => {
    if (failed) return null;
    const root = load.gltf.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = height / Math.max(size.y, 1e-6);
    const center = box.getCenter(new THREE.Vector3());
    const wrap = new THREE.Group();
    root.position.set(-center.x, -box.min.y, -center.z);
    wrap.add(root);
    wrap.scale.setScalar(s);
    wrap.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.userData.tappable = true;
    });
    wrap.updateMatrixWorld(true);
    return wrap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, failed, height]);
  useLayoutEffect(() => {
    if (object) onReady(object);
  }, [object, onReady]);
  if (failed || !object) return null;
  return <primitive object={object} />;
}

/** Renders `fallback` if anything below throws (missing asset, bad GLB, CORS). */
export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode; resetKey?: string }> {
  state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromProps(props: { resetKey?: string }, state: { failed: boolean; key?: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn('3D model failed to load; using fallback.', e);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

export function kneeTarget(side: 'l' | 'r'): Vec3 {
  const p = LM[`${side === 'r' ? 'right' : 'left'}_patella`];
  return [p.center[0], p.center[1], p.center[2] - 0.03];
}

export function implantPlacement(side: 'l' | 'r') {
  const s = side === 'r' ? 'right' : 'left';
  const pat = LM[`${s}_patella`];
  const fem = LM[`${s}_femur`];
  const tib = LM[`${s}_tibia`];
  return {
    x: pat.center[0] * 0.92,
    z: pat.center[2] - 0.04,
    femoralY: fem.min[1] + 0.022,
    tibialY: tib.max[1] - 0.006,
  };
}

const CONDYLE_R = 0.021;
// Sagittal arc from the anterior flange, under the condyle, round to the posterior.
const CONDYLE_START = (-200 * Math.PI) / 180;
const CONDYLE_ARC = (270 * Math.PI) / 180;

/** Schematic TKA: two femoral condyle caps, polyethylene insert, tibial tray and stem. */
export function Implant({
  side,
  metal,
  insert,
}: {
  side: 'l' | 'r';
  metal: THREE.Material;
  insert: THREE.Material;
}) {
  const p = implantPlacement(side);
  const condyleY = p.femoralY + CONDYLE_R - 0.022;
  return (
    <group>
      {[-0.018, 0.018].map(dx => (
        <group key={dx} position={[p.x + dx, condyleY, p.z]} rotation={[0, -Math.PI / 2, 0]}>
          <mesh material={metal} rotation={[0, 0, CONDYLE_START]} renderOrder={6}>
            <torusGeometry args={[CONDYLE_R, 0.0045, 10, 40, CONDYLE_ARC]} />
          </mesh>
        </group>
      ))}
      <mesh material={insert} position={[p.x, p.tibialY + 0.007, p.z]} renderOrder={6}>
        <cylinderGeometry args={[0.03, 0.031, 0.008, 36]} />
      </mesh>
      <mesh material={metal} position={[p.x, p.tibialY, p.z]} renderOrder={6}>
        <cylinderGeometry args={[0.033, 0.033, 0.005, 36]} />
      </mesh>
      <mesh material={metal} position={[p.x, p.tibialY - 0.026, p.z]} renderOrder={6}>
        <cylinderGeometry args={[0.007, 0.004, 0.045, 16]} />
      </mesh>
    </group>
  );
}

type Probe = { origin: Vec3; dir: Vec3; fallback: Vec3 };

function probes(side: 'l' | 'r'): Record<HotspotId, Probe> {
  const s = side === 'r' ? 'right' : 'left';
  const sx = side === 'r' ? -1 : 1;
  const pat = LM[`${s}_patella`];
  const sol = LM[`${s}_soleus`];
  const st = LM.body_of_sternum;
  const [px, py, pz] = pat.center;
  const calfY = sol.max[1] - 0.09;
  const d = Math.SQRT1_2;
  return {
    incision: { origin: [px, py, pz + 0.3], dir: [0, 0, -1], fallback: [px, py, pat.max[2] + 0.006] },
    bend: { origin: [px + sx * 0.3, py - 0.015, pz - 0.035], dir: [-sx, 0, 0], fallback: [px + sx * 0.06, py, pz - 0.035] },
    calf: {
      origin: [sol.center[0] + sx * 0.25 * d, calfY, sol.center[2] + 0.25 * d],
      dir: [-sx * d, 0, -d],
      fallback: [sol.center[0] + sx * 0.04, calfY, sol.center[2] + 0.04],
    },
    chest: { origin: [0, st.center[1], st.max[2] + 0.3], dir: [0, 0, -1], fallback: [0, st.center[1], st.max[2] + 0.01] },
  };
}

/** Hotspot anchors projected onto whatever outer surface is showing. */
export function snapAnchors(side: 'l' | 'r', surface: THREE.Object3D | null): Record<HotspotId, Vec3> {
  const ray = new THREE.Raycaster();
  const out = {} as Record<HotspotId, Vec3>;
  for (const [id, p] of Object.entries(probes(side)) as Array<[HotspotId, Probe]>) {
    let point = p.fallback;
    if (surface) {
      const origin = new THREE.Vector3(...p.origin);
      const dir = new THREE.Vector3(...p.dir).normalize();
      ray.set(origin, dir);
      const hit = ray.intersectObject(surface, true)[0];
      if (hit) point = hit.point.addScaledVector(dir, -0.004).toArray() as Vec3;
    }
    out[id] = point;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tap -> region
// ---------------------------------------------------------------------------

const tmp = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();

function distanceToPart(p: THREE.Vector3, part: Part): number {
  const [cx, cy, cz] = part.pos;
  const sc = part.scale ?? [1, 1, 1];
  const avg = (sc[0] + sc[1] + sc[2]) / 3;
  const shape = part.shape;
  switch (shape.kind) {
    case 'capsule': {
      const half = (shape.len / 2) * sc[1];
      const rz = part.rot?.[2] ?? 0;
      const ux = -Math.sin(rz);
      const uy = Math.cos(rz);
      a.set(cx - ux * half, cy - uy * half, cz);
      b.set(cx + ux * half, cy + uy * half, cz);
      const line = new THREE.Line3(a, b);
      line.closestPointToPoint(p, true, tmp);
      return tmp.distanceTo(p) - shape.r * Math.max(sc[0], sc[2]);
    }
    case 'sphere':
      return tmp.set(cx, cy, cz).distanceTo(p) - shape.r * avg;
    case 'box':
      return tmp.set(cx, cy, cz).distanceTo(p) - Math.min(shape.w, shape.h, shape.d) / 2;
    default:
      return tmp.set(cx, cy, cz).distanceTo(p);
  }
}

/** Region code for a tap on any outer surface, via the nearest reference body part. */
export function regionForPoint(point: [number, number, number]): string {
  const p = new THREE.Vector3(...point);
  let best = SKIN[0]!;
  let bestD = Infinity;
  for (const part of SKIN) {
    const d = distanceToPart(p, part);
    if (d < bestD) {
      bestD = d;
      best = part;
    }
  }
  return regionForHit(best, point);
}

/** Seated (wheelchair) scans: top of head relative to standing height. */
export const SEATED_SCALE = 0.76;

/**
 * Region code for a tap on a seated scan. The standing reference parts don't line
 * up with a seated body, so classify by height bands of a seated adult instead.
 */
export function regionForSeatedPoint([x, y, z]: [number, number, number], standingHeight = 1.72): string {
  const h = y / (standingHeight * SEATED_SCALE);
  const side = x >= 0 ? 'l' : 'r';
  const face = z >= 0 ? 'anterior' : 'posterior';
  if (h > 0.84) return `head_${face}`;
  if (h > 0.78) return `neck_${face}`;
  if (h > 0.58) return face === 'anterior' ? 'chest' : 'back';
  if (h > 0.47) return face === 'anterior' ? 'abdomen' : `hip_${face}`;
  if (h > 0.3) return `${Math.hypot(x, z) > 0.3 ? 'knee' : 'thigh'}_${side}_${face}`;
  if (h > 0.07) return `calf_${side}_${face}`;
  return `foot_${side}_${face}`;
}

useGLTF.preload(ANATOMY_URL);
