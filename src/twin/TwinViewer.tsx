import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  BONE,
  KNEE_TARGET,
  MUSCLE,
  SKIN,
  implantParts,
  regionForHit,
  regionLabel,
  type HotspotId,
  type Part,
} from './bodyModel';
import type { HotspotTone, TwinHotspot } from './hotspots';

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
  initialMode?: Mode;
  initialFocus?: 'body' | 'knee';
  compact?: boolean;
};

type Mode = 'outside' | 'inside';
type Layer = 'muscle' | 'bone' | 'implant';

const LAYERS: Array<{ id: Layer; label: string; color: string }> = [
  { id: 'muscle', label: 'Muscles', color: '#b8483f' },
  { id: 'bone', label: 'Bones', color: '#d9cfb8' },
  { id: 'implant', label: 'Implant', color: '#5aa9ff' },
];

export function TwinViewer(props: Props) {
  const [mode, setMode] = useState<Mode>(props.initialMode ?? 'outside');
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ muscle: true, bone: true, implant: true });
  const [focus, setFocus] = useState<'body' | 'knee'>(props.initialFocus ?? 'body');
  const [focusNonce, setFocusNonce] = useState(0);
  const [openSpot, setOpenSpot] = useState<HotspotId | null>(null);

  return (
    <div className={`twin twin--${mode} ${props.compact ? 'twin--compact' : ''}`}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 1.0, 3.1], fov: 35, near: 0.05, far: 50 }}
        onPointerMissed={() => setOpenSpot(null)}
      >
        <Suspense fallback={null}>
          <Scene
            {...props}
            mode={mode}
            layers={layers}
            focus={focus}
            focusNonce={focusNonce}
            openSpot={openSpot}
            onToggleSpot={id => setOpenSpot(cur => (cur === id ? null : id))}
          />
        </Suspense>
      </Canvas>

      <div className="seg twin__focus" role="group" aria-label="Camera focus">
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

      <div className="twin__dock">
        {mode === 'inside' && (
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
        <div className="seg modepill" role="group" aria-label="View">
          {(['outside', 'inside'] as const).map(m => (
            <button
              key={m}
              className={mode === m ? `seg__btn modepill__btn--on modepill__btn--${m}` : 'seg__btn'}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === 'outside' ? 'Outside' : 'Inside'}
            </button>
          ))}
        </div>
      </div>
      <div className="twin__credit">Reference anatomy · not to scale</div>
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
  mode,
  layers,
  focus,
  focusNonce,
  openSpot,
  onToggleSpot,
}: Props & {
  mode: Mode;
  layers: Record<Layer, boolean>;
  focus: 'body' | 'knee';
  focusNonce: number;
  openSpot: HotspotId | null;
  onToggleSpot: (id: HotspotId) => void;
}) {
  const s = side === 'left' ? 'l' : 'r';
  const mats = useMemo(
    () => ({
      skin: new THREE.MeshStandardMaterial({ color: '#e9c6ab', roughness: 0.65, transparent: true }),
      skinSurgical: new THREE.MeshStandardMaterial({
        color: '#f0b9a0',
        roughness: 0.6,
        transparent: true,
        emissive: new THREE.Color('#ff6a3d'),
        emissiveIntensity: 0.08,
      }),
      muscle: new THREE.MeshStandardMaterial({ color: '#b8483f', roughness: 0.55, transparent: true }),
      bone: new THREE.MeshStandardMaterial({ color: '#f1ead9', roughness: 0.8 }),
      implant: new THREE.MeshStandardMaterial({
        color: '#c9d3dd',
        metalness: 0.95,
        roughness: 0.2,
        emissive: new THREE.Color('#5aa9ff'),
        emissiveIntensity: 0.25,
      }),
    }),
    []
  );

  const inside = mode === 'inside';
  const showMuscle = inside && layers.muscle;
  const showBone = inside && layers.bone;
  const showImplant = inside && layers.implant;

  useEffect(() => {
    for (const m of [mats.skin, mats.skinSurgical]) {
      m.opacity = inside ? 0.12 : 1;
      m.depthWrite = !inside;
      m.needsUpdate = true;
    }
    const seeThrough = showBone || showImplant;
    mats.muscle.opacity = seeThrough ? 0.3 : 1;
    mats.muscle.depthWrite = !seeThrough;
    mats.muscle.needsUpdate = true;
  }, [inside, showBone, showImplant, mats]);

  const lastHover = useRef(0);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onTap || e.delta > 6) return;
    const part = e.object.userData.part as Part | undefined;
    if (!part) return;
    e.stopPropagation();
    const p: [number, number, number] = [e.point.x, e.point.y, e.point.z];
    onTap(regionForHit(part, p), p);
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (!onHover) return;
    const now = performance.now();
    if (now - lastHover.current < 80) return;
    lastHover.current = now;
    onHover([e.point.x, e.point.y, e.point.z]);
  };

  return (
    <>
      <color attach="background" args={[inside ? '#f8f2f2' : '#f4f7fa']} />
      <hemisphereLight args={['#ffffff', '#c9d4de', 0.9]} />
      <directionalLight position={[2, 4, 3]} intensity={1.6} castShadow />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} />

      <CameraRig focus={focus} nonce={focusNonce} side={s} />

      <group
        onClick={handleClick}
        onPointerMove={handleMove}
        onPointerOut={() => onHover?.(null)}
      >
        {SKIN.map(part => (
          <PartMesh
            key={part.key}
            part={part}
            material={part.side === s && (part.region === 'knee' || part.region === 'thigh' || part.region === 'calf') ? mats.skinSurgical : mats.skin}
            tappable
          />
        ))}
      </group>

      {showMuscle && MUSCLE.map(part => <PartMesh key={part.key} part={part} material={mats.muscle} />)}
      {showBone && BONE.map(part => <PartMesh key={part.key} part={part} material={mats.bone} />)}
      {showImplant && implantParts(s).map(part => <PartMesh key={part.key} part={part} material={mats.implant} />)}

      {hotspots.map(h => (
        <Hotspot key={h.id} spot={h} open={openSpot === h.id} onToggle={onToggleSpot} />
      ))}

      <Sparkles count={36} scale={[3.2, 2.2, 2]} position={[0, 1.05, -0.6]} size={1.6} speed={0.18} opacity={0.45} color="#9aa6b2" />

      {pins.map(pin => (
        <Pin key={pin.id} pin={pin} selected={pin.id === selectedPinId} onSelect={onSelectPin} />
      ))}
      {pointers.map(p => (
        <PointerMarker key={p.id} pointer={p} />
      ))}

      <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={2.5} blur={2.4} far={1.2} />
    </>
  );
}

function CameraRig({ focus, nonce, side }: { focus: 'body' | 'knee'; nonce: number; side: 'l' | 'r' }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const goal = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (focus === 'knee') {
      const [x, y, z] = KNEE_TARGET(side);
      goal.current = {
        target: new THREE.Vector3(x, y, z),
        pos: new THREE.Vector3(x + 0.45, y + 0.2, z + 1.15),
      };
    } else {
      goal.current = { target: new THREE.Vector3(0, 0.88, 0), pos: new THREE.Vector3(0, 1.0, 3.1) };
    }
  }, [focus, nonce, side]);

  useFrame((_, dt) => {
    const c = controls.current;
    const g = goal.current;
    if (!c || !g) return;
    const k = 1 - Math.pow(0.002, dt);
    c.target.lerp(g.target, k);
    camera.position.lerp(g.pos, k);
    c.update();
    if (c.target.distanceTo(g.target) < 0.002 && camera.position.distanceTo(g.pos) < 0.002) {
      goal.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      minDistance={0.45}
      maxDistance={4}
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

function PartMesh({ part, material, tappable }: { part: Part; material: THREE.Material; tappable?: boolean }) {
  return (
    <mesh
      position={part.pos}
      rotation={part.rot ?? [0, 0, 0]}
      scale={part.scale ?? [1, 1, 1]}
      material={material}
      userData={{ part }}
      raycast={tappable ? undefined : noRaycast}
      castShadow={tappable}
    >
      {geometryFor(part.shape)}
    </mesh>
  );
}

function severityColor(sev: number) {
  if (sev >= 7) return '#e5484d';
  if (sev >= 4) return '#f5a524';
  return '#30a46c';
}

function Pin({ pin, selected, onSelect }: { pin: TwinPin; selected: boolean; onSelect?: (id: string) => void }) {
  const ring = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const color = pin.pending ? '#3e63dd' : severityColor(pin.severity);

  useFrame(({ clock }) => {
    if (!ring.current) return;
    const t = (clock.elapsedTime * 1.2 + pin.x * 10) % 1;
    ring.current.scale.setScalar(1 + t * 1.6);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t);
  });

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
        <sphereGeometry args={[selected ? 0.02 : 0.015, 20, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent />
      </mesh>
      <mesh ref={ring} renderOrder={9} raycast={noRaycast}>
        <sphereGeometry args={[0.018, 20, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.4} />
      </mesh>
      {(hover || selected || pin.pending) && (
        <Html center zIndexRange={[4, 0]} distanceFactor={0.85} position={[0, 0.05, 0]} style={{ pointerEvents: 'none' }}>
          <div className="pin-label">{pin.label}</div>
        </Html>
      )}
    </group>
  );
}

const TONE_COLOR: Record<HotspotTone, string> = {
  info: '#6ea8ff',
  watch: '#f5a524',
  alarm: '#e5484d',
};

function Hotspot({ spot, open, onToggle }: { spot: TwinHotspot; open: boolean; onToggle: (id: HotspotId) => void }) {
  const halo = useRef<THREE.Mesh>(null);
  const color = TONE_COLOR[spot.tone];
  const [flip, setFlip] = useState(false);
  const projected = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock, camera }) => {
    if (open) {
      const onRight = projected.set(...spot.point).project(camera).x > 0;
      if (onRight !== flip) setFlip(onRight);
    }
    if (!halo.current) return;
    const t = (Math.sin(clock.elapsedTime * 2.4 + spot.point[1] * 9) + 1) / 2;
    halo.current.scale.setScalar(1 + t * 0.6);
    (halo.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.22 * (1 - t);
  });

  return (
    <group position={spot.point}>
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
        <sphereGeometry args={[open ? 0.012 : 0.009, 20, 12]} />
        <meshBasicMaterial color={open ? '#ffffff' : color} />
      </mesh>
      <mesh ref={halo} renderOrder={7} raycast={noRaycast}>
        <sphereGeometry args={[0.02, 20, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
      </mesh>
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
      <mesh renderOrder={11} raycast={noRaycast}>
        <torusGeometry args={[0.022, 0.004, 8, 32]} />
        <meshBasicMaterial color={pointer.color} depthTest={false} transparent />
      </mesh>
      <Html center zIndexRange={[4, 0]} distanceFactor={0.85} position={[0, 0.045, 0]} style={{ pointerEvents: 'none' }}>
        <div className="pointer-label" style={{ background: pointer.color }}>
          {pointer.name}
        </div>
      </Html>
    </group>
  );
}

export { regionLabel };
