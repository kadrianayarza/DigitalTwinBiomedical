import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Bvh, Grid, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { BONE, MUSCLE, SKIN, implantParts, regionForHit, regionLabel, type HotspotId, type Part } from './bodyModel';
import {
  ANATOMY_CREDIT,
  EXTERIOR_CREDIT,
  EXTERIOR_URL,
  Implant,
  ModelBoundary,
  PhotoSkin,
  ReferenceExterior,
  Shorts,
  kneeTarget,
  proxiedTwinUrl,
  regionForPoint,
  snapAnchors,
  useAnatomy,
  useGltfStatus,
} from './anatomy';
import type { HotspotTone, TwinHotspot } from './hotspots';
import { createGroundShadowTexture, createTwinMaterials, setTwinMaterialMode, type TwinMaterials } from './materials';

export type TwinPin = {
  id: string;
  x: number;
  y: number;
  z: number;
  severity: number;
  label: string;
  pending?: boolean;
};

export type TwinPointer = { id: string; name: string; x: number; y: number; z: number; color: string };

type Props = {
  side: 'left' | 'right';
  pins: TwinPin[];
  pointers?: TwinPointer[];
  selectedPinId?: string;
  onSelectPin?: (id: string) => void;
  onTap?: (region: string, point: [number, number, number]) => void;
  onHover?: (point: [number, number, number] | null) => void;
  hotspots?: TwinHotspot[];
  /** Personal Meshy twin (GLB). Empty uses the reference exterior. */
  twinUrl?: string;
  initialMode?: Mode;
  initialFocus?: 'body' | 'knee';
  compact?: boolean;
};

type Mode = 'outside' | 'inside';
type Layer = 'muscle' | 'bone' | 'vessel' | 'implant';
/** What the outer surface currently is. */
type SkinKind = 'scan' | 'reference' | 'anatomy';

const LAYERS: Array<{ id: Layer; label: string; color: string }> = [
  { id: 'muscle', label: 'Muscles', color: '#c4453c' },
  { id: 'bone', label: 'Bones', color: '#efe6d2' },
  { id: 'vessel', label: 'Vessels', color: 'linear-gradient(90deg, #ff3b4f 50%, #4a6dff 50%)' },
  { id: 'implant', label: 'Implant', color: '#3ad7ff' },
];

const ACCENT = '#1a73e8';

export function TwinViewer(props: Props) {
  const [mode, setMode] = useState<Mode>(props.initialMode ?? 'outside');
  const [layers, setLayers] = useState<Record<Layer, boolean>>({
    muscle: true,
    bone: true,
    vessel: false,
    implant: true,
  });
  const [focus, setFocus] = useState<'body' | 'knee'>(props.initialFocus ?? 'body');
  const [focusNonce, setFocusNonce] = useState(0);
  const [openSpot, setOpenSpot] = useState<HotspotId | null>(null);
  const [skinKind, setSkinKind] = useState<SkinKind>('anatomy');
  // Show the inside view as the placeholder while a personal scan downloads.
  const scanLoading = useGltfStatus(props.twinUrl ? proxiedTwinUrl(props.twinUrl) : undefined) === 'loading';
  const view: Mode = scanLoading ? 'inside' : mode;

  const credit = scanLoading
    ? `Loading your scan · ${ANATOMY_CREDIT}`
    : view === 'inside' || skinKind === 'anatomy'
      ? ANATOMY_CREDIT
      : skinKind === 'scan'
        ? 'Personal scan · Meshy image-to-3D · shape is approximate'
        : EXTERIOR_CREDIT;

  return (
    <div className={`twin twin--${view} ${props.compact ? 'twin--compact' : ''}`}>
      <div className="twin__viewport">
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0.86, 3.1], fov: 35, near: 0.05, far: 50 }}
          onPointerMissed={() => setOpenSpot(null)}
        >
          <Suspense fallback={null}>
            <Scene
              {...props}
              mode={view}
              layers={layers}
              focus={focus}
              focusNonce={focusNonce}
              openSpot={openSpot}
              onToggleSpot={id => setOpenSpot(cur => (cur === id ? null : id))}
              onSkinKind={setSkinKind}
            />
          </Suspense>
        </Canvas>
      </div>

      <div className="twin__hud" aria-hidden>
        <span className="twin__hudlabel">
          Twin · {view === 'outside' ? 'Exterior' : 'Interior'}
          <em>{view === 'outside' && skinKind === 'scan' ? 'Meshy' : view === 'outside' && skinKind === 'reference' ? 'Reference' : 'Anatomy'}</em>
        </span>
      </div>

      <div className="twin__dock">
        {view === 'inside' && (
          <div className="legend" role="group" aria-label="Anatomy layers">
            {LAYERS.map(l => (
              <button
                key={l.id}
                className={`legend__chip ${layers[l.id] ? '' : 'legend__chip--off'}`}
                aria-pressed={layers[l.id]}
                onClick={() => setLayers(cur => ({ ...cur, [l.id]: !cur[l.id] }))}
              >
                <span className="legend__dot" style={{ background: l.color }} />
                {l.label}
              </button>
            ))}
          </div>
        )}
        <div className="twin__controls">
          <div className="seg" role="group" aria-label="Camera focus">
            {(['body', 'knee'] as const).map(f => (
              <button
                key={f}
                className={focus === f ? 'seg__btn seg__btn--on' : 'seg__btn'}
                aria-pressed={focus === f}
                onClick={() => {
                  setFocus(f);
                  setFocusNonce(n => n + 1);
                }}
              >
                {f === 'body' ? 'Full body' : 'Knee'}
              </button>
            ))}
          </div>
          <div className="seg seg--mode" role="group" aria-label="View">
            {(['outside', 'inside'] as const).map(m => (
              <button
                key={m}
                className={mode === m ? 'seg__btn seg__btn--on' : 'seg__btn'}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === 'outside' ? 'Outside' : 'Inside'}
              </button>
            ))}
          </div>
        </div>
        <div className="twin__credit">{credit}</div>
      </div>
    </div>
  );
}

function Scene({
  side,
  pins,
  pointers = [],
  selectedPinId,
  onSelectPin,
  onTap,
  onHover,
  hotspots = [],
  twinUrl,
  mode,
  layers,
  focus,
  focusNonce,
  openSpot,
  onToggleSpot,
  onSkinKind,
}: Props & {
  mode: Mode;
  layers: Record<Layer, boolean>;
  focus: 'body' | 'knee';
  focusNonce: number;
  openSpot: HotspotId | null;
  onToggleSpot: (id: HotspotId) => void;
  onSkinKind: (kind: SkinKind) => void;
}) {
  const s = side === 'left' ? 'l' : 'r';
  const mats = useMemo(createTwinMaterials, []);

  const inside = mode === 'inside';
  const show: Visible = {
    muscle: inside && layers.muscle,
    bone: inside && layers.bone,
    vessel: inside && layers.vessel,
    implant: inside && layers.implant,
  };

  useLayoutEffect(() => {
    setTwinMaterialMode(mats, inside, show.bone || show.vessel);
  }, [inside, show.bone, show.vessel, mats]);

  const [surface, setSurface] = useState<THREE.Object3D | null>(null);
  const anchors = useMemo(() => snapAnchors(s, surface), [s, surface]);
  const handleSurface = useCallback(
    (o: THREE.Object3D, kind: SkinKind) => {
      setSurface(o);
      onSkinKind(kind);
    },
    [onSkinKind]
  );

  const lastHover = useRef(0);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onTap || e.delta > 6) return;
    const part = e.object.userData.part as Part | undefined;
    if (!part && !e.object.userData.tappable) return;
    e.stopPropagation();
    const p: [number, number, number] = [e.point.x, e.point.y, e.point.z];
    onTap(part ? regionForHit(part, p) : regionForPoint(p), p);
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (!onHover) return;
    const now = performance.now();
    if (now - lastHover.current < 80) return;
    lastHover.current = now;
    onHover([e.point.x, e.point.y, e.point.z]);
  };

  const procedural = <ProceduralBody side={s} show={show} mats={mats} />;

  return (
    <>
      <color attach="background" args={[inside ? '#eef4f7' : '#eef0f4']} />
      <hemisphereLight args={['#ffffff', '#c9c3ba', inside ? 0.5 : 0.95]} />
      <directionalLight position={[1.5, 3, 3]} intensity={inside ? 1.1 : 2.0} color="#fff8f0" />
      <directionalLight position={[-3, 2, -2.5]} intensity={inside ? 1.4 : 0.7} color="#ffd9b8" />
      <directionalLight position={[3, 1.5, -2.5]} intensity={inside ? 1.0 : 0.55} color="#d8ecf5" />

      <CameraRig focus={focus} nonce={focusNonce} side={s} />

      <Bvh firstHitOnly>
        <group onClick={handleClick} onPointerMove={handleMove} onPointerOut={() => onHover?.(null)}>
          <ModelBoundary fallback={procedural}>
            <Suspense fallback={procedural}>
              <RealBody
                side={s}
                show={show}
                mats={mats}
                inside={inside}
                twinUrl={twinUrl ?? ''}
                onSurface={handleSurface}
              />
            </Suspense>
          </ModelBoundary>
        </group>
      </Bvh>

      {hotspots.map(h => (
        <Hotspot key={h.id} spot={h} point={anchors[h.id]} open={openSpot === h.id} onToggle={onToggleSpot} />
      ))}

      {pins.map(pin => (
        <Pin key={pin.id} pin={pin} selected={pin.id === selectedPinId} onSelect={onSelectPin} />
      ))}
      {pointers.map(p => (
        <PointerMarker key={p.id} pointer={p} />
      ))}

      <Platform />
    </>
  );
}

type Visible = { muscle: boolean; bone: boolean; vessel: boolean; implant: boolean };
type Mats = TwinMaterials;

/** Floor grid, contact shadow, and slowly turning range rings under the twin. */
function Platform() {
  const texture = useMemo(createGroundShadowTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const arcs = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (arcs.current) arcs.current.rotation.z += dt * 0.12;
  });

  return (
    <group>
      <Grid
        position={[0, -0.002, 0]}
        args={[8, 8]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor="#ccd2da"
        sectionSize={0.5}
        sectionThickness={0.9}
        sectionColor="#a8c7f0"
        fadeDistance={5.5}
        fadeStrength={2.2}
        infiniteGrid
        raycast={noRaycast}
      />
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <planeGeometry args={[1.1, 0.6]} />
        <meshBasicMaterial map={texture} transparent opacity={0.65} depthWrite={false} />
      </mesh>
      <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <mesh raycast={noRaycast}>
          <ringGeometry args={[0.44, 0.447, 128]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.8} depthWrite={false} />
        </mesh>
        <group ref={arcs}>
          {[0, 1, 2].map(i => (
            <mesh key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]} raycast={noRaycast}>
              <ringGeometry args={[0.49, 0.5, 48, 1, 0, Math.PI / 3]} />
              <meshBasicMaterial color={ACCENT} transparent opacity={0.45} depthWrite={false} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

/** Primitive stand-in shown while anatomy.glb loads, or if it fails. */
function ProceduralBody({ side, show, mats }: { side: 'l' | 'r'; show: Visible; mats: Mats }) {
  const surgical = (p: Part) => p.side === side && (p.region === 'knee' || p.region === 'thigh' || p.region === 'calf');
  return (
    <>
      {SKIN.map(part => (
        <PartMesh key={part.key} part={part} material={surgical(part) ? mats.skinSurgical : mats.skin} tappable renderOrder={3} />
      ))}
      {show.muscle && MUSCLE.map(part => <PartMesh key={part.key} part={part} material={mats.muscle} renderOrder={2} />)}
      {show.bone && BONE.map(part => <PartMesh key={part.key} part={part} material={mats.bone} />)}
      {show.implant && implantParts(side).map(part => <PartMesh key={part.key} part={part} material={mats.implant} />)}
    </>
  );
}

function RealBody({
  side,
  show,
  mats,
  inside,
  twinUrl,
  onSurface,
}: {
  side: 'l' | 'r';
  show: Visible;
  mats: Mats;
  inside: boolean;
  twinUrl: string;
  onSurface: (o: THREE.Object3D, kind: SkinKind) => void;
}) {
  const geo = useAnatomy(side);
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const onFail = useCallback(
    (url: string) => setFailedUrls(cur => (cur[url] ? cur : { ...cur, [url]: true })),
    []
  );
  const height = useMemo(() => {
    if (!geo.skin) return 1.72;
    geo.skin.computeBoundingBox();
    const b = geo.skin.boundingBox!;
    return b.max.y - b.min.y;
  }, [geo.skin]);
  const skinRef = useCallback((m: THREE.Mesh | null) => m && onSurface(m, 'anatomy'), [onSurface]);
  const onReference = useCallback((o: THREE.Object3D) => onSurface(o, 'reference'), [onSurface]);
  const onScan = useCallback((o: THREE.Object3D) => onSurface(o, 'scan'), [onSurface]);
  const failExterior = useCallback(() => onFail(EXTERIOR_URL), [onFail]);

  const anatomySkin = geo.skin && (
    <mesh
      ref={skinRef}
      geometry={geo.skin}
      material={inside ? mats.glassSkin : mats.realSkin}
      userData={{ tappable: true }}
      renderOrder={inside ? 4 : 3}
    />
  );
  const anatomyOutside = (
    <>
      {anatomySkin}
      <Shorts material={mats.shorts} />
    </>
  );
  // Tier order for the Outside view: personal Meshy scan -> Human Atlas reference body -> anatomy skin.
  const reference = failedUrls[EXTERIOR_URL] ? (
    anatomyOutside
  ) : (
    <ModelBoundary resetKey={EXTERIOR_URL} fallback={anatomyOutside}>
      <Suspense fallback={anatomyOutside}>
        <ReferenceExterior side={side} skin={mats.realSkin} onReady={onReference} onError={failExterior} />
        <Shorts material={mats.shorts} />
      </Suspense>
    </ModelBoundary>
  );
  const scan =
    twinUrl && !failedUrls[twinUrl] ? (
      <ModelBoundary resetKey={twinUrl} fallback={reference}>
        <Suspense fallback={reference}>
        <PhotoSkin
          url={proxiedTwinUrl(twinUrl)}
          height={height}
          onReady={onScan}
          onError={() => twinUrl && onFail(twinUrl)}
        />
        </Suspense>
      </ModelBoundary>
    ) : null;
  const exterior = twinUrl ? (failedUrls[twinUrl] ? reference : scan) : reference;

  const inner = (g: THREE.BufferGeometry | undefined, m: THREE.Material, on: boolean, order = 0) =>
    on && g ? <mesh geometry={g} material={m} raycast={noRaycast} renderOrder={order} /> : null;

  return (
    <>
      {inside ? anatomySkin : exterior}
      {inner(geo.muscle, mats.muscle, show.muscle, 2)}
      {inner(geo.bone, mats.bone, show.bone)}
      {inner(geo.artery, mats.artery, show.vessel)}
      {inner(geo.vein, mats.vein, show.vessel)}
      {show.implant && <Implant side={side} metal={mats.implant} insert={mats.insert} />}
    </>
  );
}

function CameraRig({ focus, nonce, side }: { focus: 'body' | 'knee'; nonce: number; side: 'l' | 'r' }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const goal = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);
  // Fit the body's width as well as its height in narrow dashboard panels.
  const aspect = size.width / Math.max(size.height, 1);
  const bodyDistance = Math.max(3.1, 0.4 / (Math.tan(THREE.MathUtils.degToRad(35 / 2)) * Math.max(aspect, 0.01)));

  useEffect(() => {
    if (focus === 'knee') {
      const [x, y, z] = kneeTarget(side);
      goal.current = {
        target: new THREE.Vector3(x, y, z),
        pos: new THREE.Vector3(x + 0.45, y + 0.2, z + 1.15),
      };
    } else {
      goal.current = { target: new THREE.Vector3(0, 0.86, 0), pos: new THREE.Vector3(0, 0.86, bodyDistance) };
    }
  }, [focus, nonce, side, bodyDistance]);

  useFrame((_, dt) => {
    const c = controls.current;
    const g = goal.current;
    if (!c || !g) return;
    const k = 1 - Math.pow(0.002, dt);
    c.target.lerp(g.target, k);
    camera.position.lerp(g.pos, k);
    c.update();
    if (c.target.distanceTo(g.target) < 0.002 && camera.position.distanceTo(g.pos) < 0.002) {
      c.target.copy(g.target);
      camera.position.copy(g.pos);
      c.update();
      goal.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      minDistance={0.45}
      maxDistance={Math.max(4, bodyDistance * 1.5)}
      maxPolarAngle={Math.PI * 0.55}
      onStart={() => (goal.current = null)}
    />
  );
}

function geometryFor(shape: Part['shape']) {
  switch (shape.kind) {
    case 'capsule':
      return <capsuleGeometry args={[shape.r, shape.len, 8, 20]} />;
    case 'sphere':
      return <sphereGeometry args={[shape.r, 32, 20]} />;
    case 'box':
      return <boxGeometry args={[shape.w, shape.h, shape.d]} />;
    case 'cylinder':
      return <cylinderGeometry args={[shape.r, shape.r, shape.len, 14]} />;
    case 'torus':
      return <torusGeometry args={[shape.r, shape.tube, 10, 48]} />;
  }
}

const noRaycast = () => null;

function PartMesh({ part, material, tappable, renderOrder = 0 }: {
  part: Part; material: THREE.Material; tappable?: boolean; renderOrder?: number;
}) {
  return (
    <mesh
      position={part.pos}
      rotation={part.rot ?? [0, 0, 0]}
      scale={part.scale ?? [1, 1, 1]}
      material={material}
      renderOrder={renderOrder}
      userData={{ part }}
      raycast={tappable ? undefined : noRaycast}
    >
      {geometryFor(part.shape)}
    </mesh>
  );
}

function severityColor(sev: number) {
  if (sev >= 7) return '#dc1f34';
  if (sev >= 4) return '#d97706';
  return '#0f8a4d';
}

/** Flat hexagon outline that always faces the camera. */
function HexRing({ r, width, color, opacity = 1, order }: { r: number; width: number; color: string; opacity?: number; order: number }) {
  return (
    <Billboard>
      <mesh renderOrder={order} raycast={noRaycast} rotation={[0, 0, Math.PI / 6]}>
        <ringGeometry args={[r - width, r, 6]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

/** Expanding hexagon pulse, like a sensor ping. Owns its material ref safely. */
function PulseRing({ color, speed = 0.7 }: { color: string; speed?: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * speed) % 1;
    if (group.current) group.current.scale.setScalar(1 + t * 0.9);
    if (mat.current) mat.current.opacity = 0.6 * (1 - t);
  });
  return (
    <group ref={group}>
      <Billboard>
        <mesh renderOrder={7} raycast={noRaycast} rotation={[0, 0, Math.PI / 6]}>
          <ringGeometry args={[0.017, 0.02, 6]} />
          <meshBasicMaterial ref={mat} color={color} transparent opacity={0.5} depthTest={false} depthWrite={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

function Pin({ pin, selected, onSelect }: { pin: TwinPin; selected: boolean; onSelect?: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  const color = pin.pending ? ACCENT : severityColor(pin.severity);

  return (
    <group position={[pin.x, pin.y, pin.z]}>
      <mesh
        renderOrder={10}
        onClick={e => {
          e.stopPropagation();
          onSelect?.(pin.id);
        }}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      >
        <sphereGeometry args={[selected ? 0.014 : 0.011, 20, 12]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
      <HexRing r={selected ? 0.032 : 0.026} width={0.004} color={color} opacity={0.9} order={9} />
      {(hover || selected || pin.pending) && (
        <Html center zIndexRange={[4, 0]} distanceFactor={0.85} position={[0, 0.055, 0]} style={{ pointerEvents: 'none' }}>
          <div className="pin-label">{pin.label}</div>
        </Html>
      )}
    </group>
  );
}

const TONE_COLOR: Record<HotspotTone, string> = {
  info: '#0789b4',
  watch: '#d97706',
  alarm: '#dc1f34',
};

function Hotspot({
  spot,
  point,
  open,
  onToggle,
}: {
  spot: TwinHotspot;
  point: [number, number, number];
  open: boolean;
  onToggle: (id: HotspotId) => void;
}) {
  const color = TONE_COLOR[spot.tone];
  const [flip, setFlip] = useState(false);
  const projected = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    if (open) {
      const x = projected.set(...point).project(camera).x;
      const onRight = flip ? x > -0.08 : x > 0.08;
      if (onRight !== flip) setFlip(onRight);
    }
  });

  return (
    <group position={point}>
      <mesh
        renderOrder={8}
        onClick={e => {
          e.stopPropagation();
          onToggle(spot.id);
        }}
        onPointerOver={e => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <sphereGeometry args={[open ? 0.011 : 0.008, 20, 12]} />
        <meshBasicMaterial color={open ? '#ffffff' : color} depthWrite={false} />
      </mesh>
      <HexRing r={0.02} width={0.003} color={color} order={7} />
      <PulseRing color={color} speed={spot.tone === 'alarm' ? 1.4 : 0.7} />
      {open && (
        <Html zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`callout callout--${spot.tone} ${flip ? 'callout--flip' : ''}`}>
            <svg className="callout__line" width="64" height="44" viewBox="0 0 64 44" aria-hidden>
              <polyline points="0,44 26,4 64,4" />
            </svg>
            <div className="callout__card" role="status">
              <div className="callout__kicker">{spot.kicker}</div>
              <div className="callout__body">{spot.body}</div>
              {spot.meta && <div className="callout__meta">{spot.meta}</div>}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

function PointerMarker({ pointer }: { pointer: TwinPointer }) {
  return (
    <group position={[pointer.x, pointer.y, pointer.z]}>
      <HexRing r={0.024} width={0.004} color={pointer.color} order={11} />
      <Html center zIndexRange={[4, 0]} distanceFactor={0.85} position={[0, 0.05, 0]} style={{ pointerEvents: 'none' }}>
        <div className="pointer-label" style={{ '--pointer': pointer.color } as React.CSSProperties}>
          {pointer.name}
        </div>
      </Html>
    </group>
  );
}

export { regionLabel };
