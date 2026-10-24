import * as THREE from 'three';

export function createTwinMaterials() {
  return {
    skin: new THREE.MeshStandardMaterial({ color: '#e9c6ab', roughness: 0.65 }),
    skinSurgical: new THREE.MeshStandardMaterial({
      color: '#f0b9a0',
      roughness: 0.6,
      emissive: new THREE.Color('#ff6a3d'),
      emissiveIntensity: 0.08,
    }),
    realSkin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }),
    shorts: new THREE.MeshStandardMaterial({ color: '#4b5f7a', roughness: 0.85 }),
    muscle: new THREE.MeshStandardMaterial({ color: '#b8483f', roughness: 0.55 }),
    bone: new THREE.MeshStandardMaterial({ color: '#f1ead9', roughness: 0.8 }),
    artery: new THREE.MeshStandardMaterial({ color: '#c8323c', roughness: 0.45 }),
    vein: new THREE.MeshStandardMaterial({ color: '#3a5bc7', roughness: 0.45 }),
    insert: new THREE.MeshStandardMaterial({
      color: '#f4f7fb', roughness: 0.5, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
    }),
    implant: new THREE.MeshStandardMaterial({
      color: '#c9d3dd',
      metalness: 0.9,
      roughness: 0.25,
      emissive: new THREE.Color('#5aa9ff'),
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    }),
  };
}

export type TwinMaterials = ReturnType<typeof createTwinMaterials>;

function setOpacity(material: THREE.MeshStandardMaterial, opacity: number) {
  const transparent = opacity < 1;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
  material.opacity = opacity;
  material.depthWrite = !transparent;
}

export function setTwinMaterialMode(materials: TwinMaterials, inside: boolean, seeThroughMuscle: boolean) {
  for (const skin of [materials.skin, materials.skinSurgical, materials.realSkin]) {
    setOpacity(skin, inside ? 0.1 : 1);
  }
  setOpacity(materials.muscle, inside && seeThroughMuscle ? 0.45 : 1);
}

/** A static soft shadow, without an extra scene/depth render on every frame. */
export function createGroundShadowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x / (size - 1) - 0.5) * 2, (y / (size - 1) - 0.5) * 2);
      const alpha = Math.round(255 * Math.pow(Math.max(0, 1 - radius), 2));
      data.set([100, 115, 130, alpha], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
