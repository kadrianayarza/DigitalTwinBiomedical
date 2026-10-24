import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls } from '@react-three/drei';
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
  type Part,
} from './bodyModel';

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
  initialDepth?: 0 | 1 | 2;
  initialFocus?: 'body' | 'knee';
  compact?: boolean;
};

const LAYERS = ['Skin', 'Muscle', 'Skeleton'] as const;

export function TwinViewer(props: Props) {
  const [depth, setDepth] = useState<0 | 1 | 2>(props.initialDepth ?? 0);
  const [focus, setFocus] = useState<'body' | 'knee'>(props.initialFocus ?? 'body');
  const [focusNonce, setFocusNonce] = useState(0);

  return (
    <div className={`twin ${props.compact ? 'twin--compact' : ''}`}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 1.0, 3.1], fov: 35, near: 0.05, far: 50 }}
      >
        <Suspense fallback={null}>
          <Scene {...props} depth={depth} focus={focus} focusNonce={focusNonce} />
        </Suspense>
      </Canvas>
      <div className="twin__toolbar">
        <div className="seg" role="group" aria-label="Anatomy layer">
          {LAYERS.map((name, i) => (
            <button
              key={name}
              className={depth === i ? 'seg__btn seg__btn--on' : 'seg__btn'}
              onClick={() => setDepth(i as 0 | 1 | 2)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Camera focus">
          {(['body', 'knee'] as const).map(f => (
            <button
              key={f}
              className={focus === f ? 'seg__btn seg__btn--on' : 'seg__btn'}
              onClick={() => {
                setFocus(f);
                setFocusNonce(n => n + 1);
              }}
            >
              {f === 'body' ? 'Full body' : 'Knee'}
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
  depth,
  focus,
  focusNonce,
}: Props & { depth: 0 | 1 | 2; focus: 'body' | 'knee'; focusNonce: number }) {
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

  useEffect(() => {
    const skinOpacity = depth === 0 ? 1 : 0.14;
    for (const m of [mats.skin, mats.skinSurgical]) {
      m.opacity = skinOpacity;
      m.depthWrite = depth === 0;
      m.needsUpdate = true;
    }
    mats.muscle.opacity = depth === 2 ? 0.18 : 1;
    mats.muscle.depthWrite = depth !== 2;
    mats.muscle.needsUpdate = true;
  }, [depth, mats]);

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
      <color attach="background" args={['#f4f7fa']} />
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

      {depth >= 1 && MUSCLE.map(part => <PartMesh key={part.key} part={part} material={mats.muscle} />)}
      {depth === 2 && BONE.map(part => <PartMesh key={part.key} part={part} material={mats.bone} />)}
      {depth === 2 && implantParts(s).map(part => <PartMesh key={part.key} part={part} material={mats.implant} />)}

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
