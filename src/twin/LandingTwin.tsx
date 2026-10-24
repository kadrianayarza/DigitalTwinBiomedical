import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ModelBoundary, useAnatomy } from './anatomy';
import { createTwinMaterials, setTwinMaterialMode } from './materials';
import { Platform } from './TwinViewer';

/** Decorative inside-view twin for the landing page: glass skin, muscle and bone, slowly turning. */
export default function LandingTwin() {
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [0, 1.0, 3.35], fov: 35, near: 0.05, far: 50 }}
      onCreated={({ camera }) => camera.lookAt(0, 0.86, 0)}
    >
      <hemisphereLight args={['#ffffff', '#c9c3ba', 0.5]} />
      <directionalLight position={[1.5, 3, 3]} intensity={1.1} color="#fff8f0" />
      <directionalLight position={[-3, 2, -2.5]} intensity={1.4} color="#ffd9b8" />
      <directionalLight position={[3, 1.5, -2.5]} intensity={1.0} color="#d8ecf5" />
      <ModelBoundary fallback={null}>
        <Suspense fallback={null}>
          <SpinningAnatomy spin={!still} />
        </Suspense>
      </ModelBoundary>
      <Platform />
    </Canvas>
  );
}

function SpinningAnatomy({ spin }: { spin: boolean }) {
  const geo = useAnatomy('r');
  const mats = useMemo(createTwinMaterials, []);
  const group = useRef<THREE.Group>(null);

  useLayoutEffect(() => setTwinMaterialMode(mats, true, true), [mats]);
  useEffect(() => () => Object.values(mats).forEach(m => m.dispose()), [mats]);
  useFrame((_, dt) => {
    if (spin && group.current) group.current.rotation.y += dt * 0.35;
  });

  return (
    <group ref={group} rotation={[0, -0.5, 0]}>
      {geo.skin && <mesh geometry={geo.skin} material={mats.glassSkin} renderOrder={4} />}
      {geo.muscle && <mesh geometry={geo.muscle} material={mats.muscle} renderOrder={2} />}
      {geo.bone && <mesh geometry={geo.bone} material={mats.bone} />}
    </group>
  );
}
