// Procedural reference body. Units are meters, feet at y=0, body faces +z.
// The patient's right side is at -x (mirror of the viewer's right).

export type Shape =
  | { kind: 'capsule'; r: number; len: number }
  | { kind: 'sphere'; r: number }
  | { kind: 'box'; w: number; h: number; d: number }
  | { kind: 'cylinder'; r: number; len: number }
  | { kind: 'torus'; r: number; tube: number };

export type Part = {
  key: string;
  region?: string; // base region code, e.g. 'calf'; omitted for non-tappable parts
  side?: 'l' | 'r';
  shape: Shape;
  pos: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
};

const LEGS_X = 0.095;
const sides: Array<['l' | 'r', number]> = [
  ['r', -1],
  ['l', 1],
];

export const SKIN: Part[] = [
  { key: 'head', region: 'head', shape: { kind: 'sphere', r: 0.105 }, pos: [0, 1.62, 0], scale: [0.9, 1.1, 1] },
  { key: 'neck', region: 'neck', shape: { kind: 'capsule', r: 0.048, len: 0.07 }, pos: [0, 1.49, -0.005] },
  { key: 'chest', region: 'chest', shape: { kind: 'capsule', r: 0.16, len: 0.2 }, pos: [0, 1.29, 0], scale: [1.12, 1, 0.68] },
  { key: 'abdomen', region: 'abdomen', shape: { kind: 'capsule', r: 0.14, len: 0.12 }, pos: [0, 1.06, 0], scale: [1.02, 1, 0.7] },
  { key: 'pelvis', region: 'hip', shape: { kind: 'capsule', r: 0.15, len: 0.04 }, pos: [0, 0.93, 0], scale: [1.08, 1, 0.74] },
  ...sides.flatMap(([side, sx]): Part[] => [
    { key: `shoulder_${side}`, region: 'shoulder', side, shape: { kind: 'sphere', r: 0.06 }, pos: [sx * 0.205, 1.4, 0] },
    { key: `arm_${side}`, region: 'arm', side, shape: { kind: 'capsule', r: 0.045, len: 0.22 }, pos: [sx * 0.235, 1.23, 0], rot: [0, 0, sx * 0.1] },
    { key: `forearm_${side}`, region: 'forearm', side, shape: { kind: 'capsule', r: 0.037, len: 0.2 }, pos: [sx * 0.262, 0.98, 0.01], rot: [0, 0, sx * 0.05] },
    { key: `hand_${side}`, region: 'hand', side, shape: { kind: 'sphere', r: 0.045 }, pos: [sx * 0.272, 0.81, 0.015], scale: [0.65, 1.3, 0.9] },
    { key: `thigh_${side}`, region: 'thigh', side, shape: { kind: 'capsule', r: 0.078, len: 0.28 }, pos: [sx * LEGS_X, 0.69, 0], rot: [0, 0, sx * -0.03] },
    { key: `knee_${side}`, region: 'knee', side, shape: { kind: 'sphere', r: 0.064 }, pos: [sx * LEGS_X, 0.485, 0.005], scale: [1, 1.05, 1] },
    { key: `calf_${side}`, region: 'calf', side, shape: { kind: 'capsule', r: 0.056, len: 0.28 }, pos: [sx * LEGS_X, 0.27, -0.005] },
    { key: `foot_${side}`, region: 'foot', side, shape: { kind: 'box', w: 0.085, h: 0.055, d: 0.22 }, pos: [sx * LEGS_X, 0.03, 0.05] },
  ]),
];

export const MUSCLE: Part[] = [
  { key: 'pec_l', shape: { kind: 'sphere', r: 0.085 }, pos: [0.075, 1.32, 0.07], scale: [1.1, 0.75, 0.45] },
  { key: 'pec_r', shape: { kind: 'sphere', r: 0.085 }, pos: [-0.075, 1.32, 0.07], scale: [1.1, 0.75, 0.45] },
  ...[0, 1, 2].flatMap(row =>
    [-1, 1].map(
      (sx): Part => ({
        key: `abs_${row}_${sx}`,
        shape: { kind: 'box', w: 0.055, h: 0.06, d: 0.03 },
        pos: [sx * 0.033, 1.15 - row * 0.068, 0.085],
      })
    )
  ),
  { key: 'traps', shape: { kind: 'capsule', r: 0.07, len: 0.18 }, pos: [0, 1.38, -0.05], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.5] },
  ...sides.flatMap(([side, sx]): Part[] => [
    { key: `delt_${side}`, shape: { kind: 'sphere', r: 0.055 }, pos: [sx * 0.21, 1.39, 0], scale: [1, 1.2, 1] },
    { key: `bicep_${side}`, shape: { kind: 'capsule', r: 0.036, len: 0.15 }, pos: [sx * 0.235, 1.23, 0.018] },
    { key: `forearm_m_${side}`, shape: { kind: 'capsule', r: 0.03, len: 0.16 }, pos: [sx * 0.262, 0.99, 0.012] },
    { key: `glute_${side}`, shape: { kind: 'sphere', r: 0.09 }, pos: [sx * 0.075, 0.9, -0.07], scale: [1, 1, 0.75] },
    { key: `quad_${side}`, shape: { kind: 'capsule', r: 0.058, len: 0.24 }, pos: [sx * LEGS_X, 0.7, 0.025], scale: [1, 1, 0.9] },
    { key: `hamstring_${side}`, shape: { kind: 'capsule', r: 0.05, len: 0.22 }, pos: [sx * LEGS_X, 0.7, -0.03] },
    { key: `gastroc_m_${side}`, shape: { kind: 'capsule', r: 0.032, len: 0.13 }, pos: [sx * (LEGS_X - 0.018), 0.33, -0.03] },
    { key: `gastroc_l_${side}`, shape: { kind: 'capsule', r: 0.03, len: 0.12 }, pos: [sx * (LEGS_X + 0.02), 0.335, -0.028] },
    { key: `tib_ant_${side}`, shape: { kind: 'capsule', r: 0.022, len: 0.22 }, pos: [sx * (LEGS_X + 0.02), 0.27, 0.025] },
  ]),
];

export const BONE: Part[] = [
  { key: 'skull', shape: { kind: 'sphere', r: 0.088 }, pos: [0, 1.635, 0], scale: [0.88, 1.05, 1.05] },
  { key: 'jaw', shape: { kind: 'box', w: 0.09, h: 0.03, d: 0.07 }, pos: [0, 1.545, 0.03] },
  ...Array.from({ length: 14 }, (_, i): Part => ({
    key: `vert_${i}`,
    shape: { kind: 'cylinder', r: 0.017, len: 0.03 },
    pos: [0, 0.97 + i * 0.038, -0.065 + Math.sin(i / 3) * 0.01],
  })),
  ...Array.from({ length: 6 }, (_, i): Part => ({
    key: `rib_${i}`,
    shape: { kind: 'torus', r: 0.12 - Math.abs(i - 2) * 0.008, tube: 0.007 },
    pos: [0, 1.2 + i * 0.035, 0],
    rot: [Math.PI / 2 + 0.25, 0, 0],
    scale: [1.15, 0.72, 1],
  })),
  { key: 'pelvis_ring', shape: { kind: 'torus', r: 0.1, tube: 0.022 }, pos: [0, 0.94, 0], rot: [Math.PI / 2 - 0.4, 0, 0], scale: [1.25, 0.8, 1] },
  ...sides.flatMap(([side, sx]): Part[] => [
    { key: `clavicle_${side}`, shape: { kind: 'cylinder', r: 0.009, len: 0.15 }, pos: [sx * 0.085, 1.44, 0.04], rot: [0, 0, Math.PI / 2 + sx * 0.12] },
    { key: `humerus_${side}`, shape: { kind: 'cylinder', r: 0.014, len: 0.27 }, pos: [sx * 0.232, 1.24, 0], rot: [0, 0, sx * 0.1] },
    { key: `radius_${side}`, shape: { kind: 'cylinder', r: 0.009, len: 0.22 }, pos: [sx * 0.255, 0.98, 0.012], rot: [0, 0, sx * 0.05] },
    { key: `ulna_${side}`, shape: { kind: 'cylinder', r: 0.009, len: 0.23 }, pos: [sx * 0.27, 0.985, -0.008], rot: [0, 0, sx * 0.05] },
    { key: `femoral_head_${side}`, shape: { kind: 'sphere', r: 0.024 }, pos: [sx * 0.085, 0.9, 0] },
    { key: `femur_${side}`, shape: { kind: 'cylinder', r: 0.017, len: 0.38 }, pos: [sx * LEGS_X, 0.7, 0], rot: [0, 0, sx * -0.03] },
    { key: `patella_${side}`, shape: { kind: 'sphere', r: 0.024 }, pos: [sx * LEGS_X, 0.49, 0.05], scale: [1, 1.15, 0.55] },
    { key: `tibia_${side}`, shape: { kind: 'cylinder', r: 0.017, len: 0.38 }, pos: [sx * (LEGS_X - 0.008), 0.265, 0.01] },
    { key: `fibula_${side}`, shape: { kind: 'cylinder', r: 0.008, len: 0.36 }, pos: [sx * (LEGS_X + 0.03), 0.265, -0.008] },
    { key: `foot_bones_${side}`, shape: { kind: 'box', w: 0.06, h: 0.025, d: 0.18 }, pos: [sx * LEGS_X, 0.03, 0.05] },
  ]),
];

/** Knee implant parts (femoral component + tibial tray) for the surgical side. */
export function implantParts(side: 'l' | 'r'): Part[] {
  const sx = side === 'r' ? -1 : 1;
  return [
    { key: 'implant_femoral', shape: { kind: 'torus', r: 0.03, tube: 0.011 }, pos: [sx * LEGS_X, 0.505, 0.008], rot: [0, Math.PI / 2, 0], scale: [1, 1.1, 1] },
    { key: 'implant_tray', shape: { kind: 'cylinder', r: 0.036, len: 0.012 }, pos: [sx * LEGS_X, 0.467, 0.006] },
    { key: 'implant_stem', shape: { kind: 'cylinder', r: 0.008, len: 0.05 }, pos: [sx * LEGS_X, 0.44, 0.006] },
  ];
}

export const KNEE_TARGET = (side: 'l' | 'r'): [number, number, number] => [
  (side === 'r' ? -1 : 1) * LEGS_X,
  0.48,
  0,
];

export type HotspotId = 'incision' | 'bend' | 'calf' | 'chest';

/** Surface points for clinical landmarks on the surgical side. */
export function hotspotAnchors(side: 'l' | 'r'): Record<HotspotId, [number, number, number]> {
  const sx = side === 'r' ? -1 : 1;
  return {
    incision: [sx * LEGS_X, 0.505, 0.07],
    bend: [sx * (LEGS_X + 0.064), 0.47, 0.012],
    calf: [sx * (LEGS_X + 0.04), 0.3, 0.036],
    chest: [0, 1.31, 0.115],
  };
}

const REGION_NAMES: Record<string, string> = {
  head: 'Head',
  neck: 'Neck',
  chest: 'Chest',
  abdomen: 'Abdomen',
  hip: 'Hip / pelvis',
  shoulder: 'shoulder',
  arm: 'upper arm',
  forearm: 'forearm',
  hand: 'hand',
  thigh: 'thigh',
  knee: 'knee',
  calf: 'calf',
  foot: 'foot',
  back: 'Back',
};

const FACE_NAMES: Record<string, string> = {
  anterior: 'front',
  posterior: 'back',
  medial: 'inner side',
  lateral: 'outer side',
};

/** 'calf_r_posterior' -> 'Right calf (back)'. */
export function regionLabel(code: string): string {
  const [base, a, b] = code.split('_');
  if (a === 'l' || a === 'r') {
    const sideName = a === 'r' ? 'Right' : 'Left';
    const face = b ? ` (${FACE_NAMES[b] ?? b})` : '';
    return `${sideName} ${REGION_NAMES[base!] ?? base}${face}`;
  }
  const face = a ? ` (${FACE_NAMES[a] ?? a})` : '';
  return `${REGION_NAMES[base!] ?? base}${face}`;
}

/** Region code for a hit point on a skin part. */
export function regionForHit(part: Part, point: [number, number, number]): string {
  const [px, , pz] = point;
  const [cx, , cz] = part.pos;
  const base = part.region ?? 'other';
  const face = pz >= cz ? 'anterior' : 'posterior';
  if (!part.side) {
    if (base === 'chest' || base === 'abdomen') return face === 'anterior' ? base : 'back';
    return `${base}_${face}`;
  }
  if (base === 'knee') {
    const r = part.shape.kind === 'sphere' ? part.shape.r : 0.06;
    const dx = px - cx;
    if (Math.abs(dx) > r * 0.6 && Math.abs(pz - cz) < r * 0.6) {
      const towardMidline = Math.sign(dx) === -Math.sign(cx);
      return `knee_${part.side}_${towardMidline ? 'medial' : 'lateral'}`;
    }
  }
  return `${base}_${part.side}_${face}`;
}
