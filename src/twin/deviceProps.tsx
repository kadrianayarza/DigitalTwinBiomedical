import { useState } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { deviceProp, type DeviceProp, type TwinDevice } from '../lib/deviceProp';

/**
 * Assistive devices drawn as real objects around the 3D twin: the walker stands in
 * front, oxygen runs a cannula to the face, a wheelchair frame wraps a seated scan.
 * Tap any prop to confirm or review it — patient and nurse views both.
 */

const METAL = '#9aa3ad';
const DARK = '#4a525f';
const ACCENT = '#1a73e8';
const OXY = '#2f9e62';
const BEIGE = '#e9e2d4';
const TEAL = '#6fa3b5';
const RED = '#dc1f34';
const AMBER = '#d97706';
const SEAT = '#2d4a7c';

export { type TwinDevice } from '../lib/deviceProp';

type LayerProps = {
  devices: TwinDevice[];
  /** A personal scan is showing: body-anchored props would sit in the wrong place. */
  scan: boolean;
  /** The scan is seated, so a wheelchair frame wraps the twin instead of parking beside it. */
  seated: boolean;
  onSelect?: (id: string) => void;
};

export function DeviceLayer({ devices, scan, seated, onSelect }: LayerProps) {
  return (
    <group>
      {devices.map(d => {
        const prop = deviceProp(d.slug, d.name);
        if (prop.kind === 'none') return null;
        if (prop.wearable && scan) return null;
        return <DeviceItem key={d.id} device={d} prop={prop} seated={seated} onSelect={onSelect} />;
      })}
    </group>
  );
}

function DeviceItem({
  device,
  prop,
  seated,
  onSelect,
}: {
  device: TwinDevice;
  prop: DeviceProp;
  seated: boolean;
  onSelect?: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const labelAt: [number, number, number] = prop.kind === 'wheelchair' && seated ? [0, 1.48, 0] : prop.anchor;

  return (
    <group
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect?.(device.id);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
        setHover(true);
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
        setHover(false);
      }}
    >
      <DeviceShape kind={prop.kind} seated={seated} />

      {/* Unconfirmed devices get an amber bead so both sides can spot what to review. */}
      {!device.confirmed && (
        <group position={labelAt}>
          <mesh renderOrder={10}>
            <sphereGeometry args={[0.011, 16, 12]} />
            <meshBasicMaterial color={AMBER} depthTest={false} depthWrite={false} />
          </mesh>
        </group>
      )}

      {hover && (
        <Html
          center
          zIndexRange={[4, 0]}
          distanceFactor={0.85}
          position={[labelAt[0], labelAt[1] + 0.05, labelAt[2]]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="pin-label">
            {device.name}
            {device.confirmed ? ' · confirmed' : ' · needs confirmation'}
          </div>
        </Html>
      )}
    </group>
  );
}

/** Shared material for matte equipment surfaces. */
type ShapeProps = { kind: DeviceProp['kind']; seated: boolean };

function DeviceShape({ kind, seated }: ShapeProps) {
  switch (kind) {
    case 'walker':
      return <Walker />;
    case 'cane':
      return <Cane />;
    case 'crutches':
      return <Crutches />;
    case 'wheelchair':
      return <WheelchairFrame seated={seated} />;
    case 'hearing-aids':
      return <HearingAids />;
    case 'eyeglasses':
      return <Glasses />;
    case 'bathroom-safety':
      return <BathroomChair />;
    case 'daily-living-aids':
      return <Reacher />;
    case 'home-oxygen':
      return <OxygenTank />;
    case 'cpap':
      return <Cpap />;
    case 'compression-stockings':
      return <Stockings />;
    case 'medical-alert':
      return <Pendant />;
    case 'walking-boot':
      return <WalkingBoot />;
    case 'equipment-case':
      return <EquipmentCase />;
    default:
      return null;
  }
}

/** Simple mesh helpers: mesh + geometry + standard material in one call. */
function Box({
  size,
  pos,
  rot,
  color,
}: {
  size: [number, number, number];
  pos: [number, number, number];
  rot?: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={pos} rotation={rot}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.15} />
    </mesh>
  );
}

function Tube({
  r,
  h,
  pos,
  rot,
  color,
}: {
  r: number;
  h: number;
  pos: [number, number, number];
  rot?: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={pos} rotation={rot}>
      <cylinderGeometry args={[r, r, h, 12]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.15} />
    </mesh>
  );
}

function Ring({
  r,
  tube,
  pos,
  rot,
  color,
}: {
  r: number;
  tube: number;
  pos: [number, number, number];
  rot?: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={pos} rotation={rot}>
      <torusGeometry args={[r, tube, 10, 36]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.15} />
    </mesh>
  );
}

/** Front-wheeled walker standing in front of the twin. */
function Walker() {
  return (
    <group position={[0.45, 0, 0.32]} rotation={[0, -0.35, 0]}>
      {[-0.19, 0.19].map(x =>
        [-0.13, 0.13].map((z, i) => (
          <Tube key={`${x}:${z}`} r={0.011} h={i === 0 ? 0.79 : 0.82} pos={[x, 0.41, z]} color={METAL} />
        ))
      )}
      {[-0.13, 0.13].map(z => (
        <Tube key={`rail:${z}`} r={0.013} h={0.4} pos={[0, 0.8, z]} rot={[0, 0, Math.PI / 2]} color={DARK} />
      ))}
      {[-0.13, 0.13].map(z => (
        <Tube key={`cross:${z}`} r={0.009} h={0.38} pos={[0, 0.34, z]} rot={[0, 0, Math.PI / 2]} color={METAL} />
      ))}
      {[-0.19, 0.19].map(x => (
        <Tube key={`wheel:${x}`} r={0.032} h={0.022} pos={[x, 0.032, -0.13]} rot={[Math.PI / 2, 0, 0]} color={DARK} />
      ))}
      {[-0.19, 0.19].map(x => (
        <Tube key={`tip:${x}`} r={0.014} h={0.024} pos={[x, 0.012, 0.13]} color={DARK} />
      ))}
    </group>
  );
}

/** Single-point cane beside the right hand. */
function Cane() {
  return (
    <group position={[0.3, 0, 0.1]}>
      <Tube r={0.011} h={0.84} pos={[0, 0.42, 0]} color={DARK} />
      <Ring r={0.042} tube={0.011} pos={[-0.03, 0.86, 0]} rot={[Math.PI / 2, 0, 0]} color={DARK} />
      <Tube r={0.014} h={0.026} pos={[0, 0.013, 0]} color={DARK} />
    </group>
  );
}

/** A pair of crutches tucked under the arms. */
function Crutches() {
  return (
    <group>
      {[-1, 1].map(sx => (
        <group key={sx} position={[sx * 0.27, 0, 0.06]} rotation={[-0.1, 0, sx * 0.04]}>
          <Tube r={0.012} h={1.34} pos={[0, 0.67, 0]} color={METAL} />
          <Box size={[0.055, 0.03, 0.13]} pos={[0, 1.32, 0]} color={DARK} />
          <Tube r={0.011} h={0.09} pos={[0, 1.0, 0.03]} rot={[Math.PI / 2, 0, 0]} color={DARK} />
          <Tube r={0.015} h={0.03} pos={[0, 0.015, 0.07]} color={DARK} />
        </group>
      ))}
    </group>
  );
}

/**
 * Wheelchair frame. Wraps the twin when their scan is seated; otherwise it parks
 * beside the standing reference body so the chart still shows it.
 */
function WheelchairFrame({ seated }: { seated: boolean }) {
  const inner = (
    <group>
      <Box size={[0.42, 0.03, 0.42]} pos={[0, 0.56, 0]} color={SEAT} />
      <Box size={[0.42, 0.5, 0.03]} pos={[0, 0.85, -0.2]} color={SEAT} />
      <Box size={[0.42, 0.04, 0.4]} pos={[0, 0.53, 0]} color={DARK} />
      {[-0.24, 0.24].map(x => (
        <group key={x}>
          <Ring r={0.26} tube={0.02} pos={[x, 0.26, 0.02]} rot={[0, Math.PI / 2, 0]} color={METAL} />
          <Ring r={0.3} tube={0.007} pos={[x, 0.26, 0.02]} rot={[0, Math.PI / 2, 0]} color={DARK} />
          <Tube r={0.012} h={0.42} pos={[x * 0.7, 0.78, -0.21]} color={METAL} />
        </group>
      ))}
      {[-0.17, 0.17].map(x => (
        <group key={`caster:${x}`}>
          <Ring r={0.05} tube={0.014} pos={[x, 0.05, 0.3]} rot={[0, Math.PI / 2, 0]} color={DARK} />
          <Tube r={0.012} h={0.12} pos={[x, 0.1, 0.3]} color={METAL} />
        </group>
      ))}
      {[-0.1, 0.1].map(x => (
        <Box key={`foot:${x}`} size={[0.14, 0.015, 0.16]} pos={[x, 0.1, 0.42]} color={DARK} />
      ))}
    </group>
  );
  if (seated) return inner;
  return (
    <group position={[0.78, 0, -0.1]} rotation={[0, -0.55, 0]} scale={0.94}>
      {inner}
    </group>
  );
}

/** Behind-the-ear hearing aids on the reference head. */
function HearingAids() {
  return (
    <group>
      {[-1, 1].map(sx => (
        <group key={sx}>
          <Tube r={0.009} h={0.022} pos={[sx * 0.092, 1.615, -0.008]} color={BEIGE} />
          <mesh position={[sx * 0.084, 1.598, 0.012]}>
            <sphereGeometry args={[0.007, 12, 10]} />
            <meshStandardMaterial color={BEIGE} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Glasses on the reference face. */
function Glasses() {
  return (
    <group>
      {[-0.033, 0.033].map(x => (
        <Box key={x} size={[0.05, 0.032, 0.006]} pos={[x, 1.655, 0.106]} color={DARK} />
      ))}
      <Box size={[0.018, 0.006, 0.006]} pos={[0, 1.663, 0.106]} color={DARK} />
      {[-0.058, 0.058].map(x => (
        <Tube key={`temple:${x}`} r={0.003} h={0.085} pos={[x, 1.657, 0.062]} rot={[Math.PI / 2, 0, 0]} color={DARK} />
      ))}
    </group>
  );
}

/** Shower chair for the bathroom-safety group (seats, rails, raised toilet seats). */
function BathroomChair() {
  return (
    <group position={[-0.62, 0, 0.05]} rotation={[0, 0.5, 0]}>
      <Box size={[0.34, 0.02, 0.3]} pos={[0, 0.42, 0]} color={TEAL} />
      <Box size={[0.34, 0.28, 0.02]} pos={[0, 0.57, -0.14]} color={TEAL} />
      {[-0.15, 0.15].map(x =>
        [-0.12, 0.12].map(z => (
          <Tube key={`${x}:${z}`} r={0.012} h={0.42} pos={[x, 0.21, z]} color={METAL} />
        ))
      )}
      {[-0.15, 0.15].map(x => (
        <Tube key={`arm:${x}`} r={0.011} h={0.3} pos={[x, 0.62, 0]} rot={[0, 0, Math.PI / 2]} color={METAL} />
      ))}
    </group>
  );
}

/** Reacher (grabber) leaning beside the twin for the daily-living aids. */
function Reacher() {
  return (
    <group position={[0.5, 0, -0.25]} rotation={[0, 0.3, -0.13]}>
      <Tube r={0.008} h={0.74} pos={[0, 0.37, 0]} color={ACCENT} />
      {[-1, 1].map(sx => (
        <Box key={sx} size={[0.01, 0.09, 0.012]} pos={[sx * 0.016, 0.76, 0]} rot={[0, 0, sx * 0.55]} color={DARK} />
      ))}
      <Box size={[0.05, 0.014, 0.014]} pos={[0, 0.62, 0]} color={DARK} />
      <Tube r={0.013} h={0.022} pos={[0, 0.011, 0]} color={DARK} />
    </group>
  );
}

/** Green oxygen cylinder with a nasal cannula running to the face. */
function OxygenTank() {
  return (
    <group position={[-0.5, 0, -0.1]}>
      <Tube r={0.075} h={0.5} pos={[0, 0.26, 0]} color={OXY} />
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.075, 16, 12]} />
        <meshStandardMaterial color={OXY} roughness={0.55} metalness={0.15} />
      </mesh>
      <Box size={[0.05, 0.055, 0.05]} pos={[0, 0.545, 0]} color={DARK} />
      <Box size={[0.03, 0.012, 0.04]} pos={[0, 0.585, 0]} color={METAL} />
      <Tube r={0.02} h={0.026} pos={[0, 0.013, 0]} color={DARK} />
      <mesh>
        <tubeGeometry args={[CANNULA, 24, 0.005, 6, false]} />
        <meshStandardMaterial color="#f4f4ef" roughness={0.7} />
      </mesh>
    </group>
  );
}

/** Cannula curve: cylinder top to the bridge of the nose. */
const CANNULA = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(-0.5, 0.575, -0.1),
  new THREE.Vector3(-0.26, 1.28, 0.16),
  new THREE.Vector3(0, 1.585, 0.1)
);

/** Bedside CPAP machine with its hose and mask. */
function Cpap() {
  return (
    <group position={[-0.55, 0, -0.35]}>
      <Box size={[0.22, 0.26, 0.18]} pos={[0, 0.13, 0]} color="#e3e6ea" />
      <Box size={[0.02, 0.2, 0.02]} pos={[0.09, 0.13, 0.085]} color={DARK} />
      <Box size={[0.1, 0.075, 0.06]} pos={[-0.05, 0.285, 0.05]} color="#cfd6dd" />
      <mesh>
        <tubeGeometry args={[CPAP_HOSE, 20, 0.008, 6, false]} />
        <meshStandardMaterial color="#c9ccd1" roughness={0.7} />
      </mesh>
    </group>
  );
}

const CPAP_HOSE = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(-0.55, 0.27, -0.35),
  new THREE.Vector3(-0.66, 0.52, -0.36),
  new THREE.Vector3(-0.6, 0.33, -0.3)
);

/** Knee-high compression stockings over both calves. */
function Stockings() {
  return (
    <group>
      {[-1, 1].map(sx => (
        <group key={sx}>
          <Tube r={0.062} h={0.38} pos={[sx * 0.095, 0.26, -0.005]} color={BEIGE} />
          <Ring r={0.064} tube={0.009} pos={[sx * 0.095, 0.455, -0.005]} rot={[Math.PI / 2, 0, 0]} color="#d9cfb9" />
        </group>
      ))}
    </group>
  );
}

/** Medical alert pendant on a neck cord. */
function Pendant() {
  return (
    <group>
      <Ring r={0.05} tube={0.0022} pos={[0, 1.42, 0.015]} rot={[1.25, 0, 0]} color="#c9ccd1" />
      <Tube r={0.017} h={0.01} pos={[0.02, 1.23, 0.114]} color={RED} />
      <mesh position={[0.02, 1.236, 0.121]}>
        <sphereGeometry args={[0.006, 10, 8]} />
        <meshStandardMaterial color="#ffffff" roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Walking boot wrapped over the left foot (offloading boot for a foot ulcer). */
function WalkingBoot() {
  return (
    <group position={[0.095, 0, 0.04]}>
      <Box size={[0.1, 0.13, 0.23]} pos={[0, 0.105, 0.01]} color="#d8dde3" />
      <Box size={[0.11, 0.04, 0.28]} pos={[0, 0.02, 0.02]} color={DARK} />
      <Box size={[0.104, 0.012, 0.12]} pos={[0, 0.135, 0.02]} color={ACCENT} />
      <Box size={[0.104, 0.012, 0.12]} pos={[0, 0.08, 0.02]} color={ACCENT} />
    </group>
  );
}

/** Generic equipment case for anything without a prop of its own. */
function EquipmentCase() {
  return (
    <group position={[-0.55, 0, 0.15]}>
      <Box size={[0.18, 0.13, 0.14]} pos={[0, 0.065, 0]} color="#cfd6dd" />
      <Box size={[0.19, 0.022, 0.15]} pos={[0, 0.14, 0]} color="#b9c1ca" />
      <Ring r={0.028} tube={0.006} pos={[0, 0.155, 0]} rot={[Math.PI / 2, 0, 0]} color={DARK} />
      <Box size={[0.19, 0.02, 0.03]} pos={[0, 0.1, 0]} color={ACCENT} />
    </group>
  );
}
