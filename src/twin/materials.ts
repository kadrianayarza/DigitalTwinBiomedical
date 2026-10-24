import * as THREE from 'three';

/** Fresnel shell: clear where the surface faces the camera, glowing at the silhouette. */
function createGlassSkin() {
  return new THREE.ShaderMaterial({
    uniforms: {
      rim: { value: new THREE.Color('#e06208') },
      core: { value: new THREE.Color('#0891b2') },
      opacity: { value: 0.9 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 rim;
      uniform vec3 core;
      uniform float opacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
        gl_FragColor = vec4(mix(core, rim, f), opacity * (0.03 + 0.6 * f));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

export function createTwinMaterials() {
  return {
    skin: new THREE.MeshStandardMaterial({ color: '#d9b49a', roughness: 0.6 }),
    skinSurgical: new THREE.MeshStandardMaterial({
      color: '#f0b9a0',
      roughness: 0.6,
      emissive: new THREE.Color('#ff6a3d'),
      emissiveIntensity: 0.12,
    }),
    realSkin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }),
    glassSkin: createGlassSkin(),
    shorts: new THREE.MeshStandardMaterial({ color: '#2a3446', roughness: 0.85 }),
    muscle: new THREE.MeshStandardMaterial({
      color: '#c4453c',
      roughness: 0.5,
      emissive: new THREE.Color('#5a0f0a'),
      emissiveIntensity: 0.25,
    }),
    bone: new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.75 }),
    artery: new THREE.MeshStandardMaterial({ color: '#dc2b3f', roughness: 0.4, emissive: new THREE.Color('#40060c') }),
    vein: new THREE.MeshStandardMaterial({ color: '#3a56d4', roughness: 0.4, emissive: new THREE.Color('#0c1440') }),
    insert: new THREE.MeshStandardMaterial({
      color: '#f4f7fb', roughness: 0.5, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
    }),
    implant: new THREE.MeshStandardMaterial({
      color: '#c9d3dd',
      metalness: 0.9,
      roughness: 0.25,
      emissive: new THREE.Color('#0891b2'),
      emissiveIntensity: 0.4,
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
      data.set([0, 0, 0, alpha], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
