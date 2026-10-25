/**
 * How one chart device is drawn on the 3D twin. Plain data so the mapping is testable
 * without a canvas: each assistive-device slug picks a prop kind, whether it anchors
 * to the standing reference body, and where its label floats.
 */

export type DevicePropKind =
  | 'walker'
  | 'cane'
  | 'crutches'
  | 'wheelchair'
  | 'hearing-aids'
  | 'eyeglasses'
  | 'bathroom-safety'
  | 'daily-living-aids'
  | 'home-oxygen'
  | 'cpap'
  | 'compression-stockings'
  | 'medical-alert'
  | 'walking-boot'
  | 'equipment-case'
  | 'none';

export type DeviceProp = {
  kind: DevicePropKind;
  /** Body-anchored props only make sense on the standing reference twin, not a personal scan. */
  wearable: boolean;
  /** Where the hover label floats, in standing-twin meters (feet at y=0). */
  anchor: [number, number, number];
};

/** Device slugs from the curated library; see spacetimedb/src/library.ts. */
const BY_SLUG: Record<string, DeviceProp> = {
  walker: { kind: 'walker', wearable: false, anchor: [0.45, 0.98, 0.32] },
  cane: { kind: 'cane', wearable: false, anchor: [0.3, 0.98, 0.1] },
  crutches: { kind: 'crutches', wearable: false, anchor: [0, 1.52, 0.12] },
  wheelchair: { kind: 'wheelchair', wearable: false, anchor: [0.78, 1.15, -0.1] },
  'hearing-aids': { kind: 'hearing-aids', wearable: true, anchor: [0, 1.79, 0] },
  eyeglasses: { kind: 'eyeglasses', wearable: true, anchor: [0, 1.77, 0.07] },
  'bathroom-safety': { kind: 'bathroom-safety', wearable: false, anchor: [-0.62, 0.85, 0.05] },
  'daily-living-aids': { kind: 'daily-living-aids', wearable: false, anchor: [0.5, 0.95, -0.25] },
  'home-oxygen': { kind: 'home-oxygen', wearable: false, anchor: [-0.5, 0.78, -0.1] },
  cpap: { kind: 'cpap', wearable: false, anchor: [-0.55, 0.55, -0.35] },
  'compression-stockings': { kind: 'compression-stockings', wearable: true, anchor: [0, 0.62, 0.06] },
  'medical-alert': { kind: 'medical-alert', wearable: true, anchor: [0.02, 1.34, 0.16] },
  // Dentures live in a drawer, not on the body — nothing sensible to draw.
  dentures: { kind: 'none', wearable: false, anchor: [0, 0, 0] },
};

const CASE_FALLBACK: DeviceProp = { kind: 'equipment-case', wearable: false, anchor: [-0.55, 0.42, 0.15] };

/**
 * Prop for one device row. Known slugs map directly; the general 'assistive-device'
 * fallback looks at the name (a walking boot wraps the foot, anything else reads as
 * equipment beside the twin); unknown slugs become the generic case.
 */
export function deviceProp(slug: string, name = ''): DeviceProp {
  const known = BY_SLUG[slug];
  if (known) return known;
  if (/\b(walk|moon|cam)ing boot\b|ankle (boot|brace)|foot cast|air cast/i.test(name)) {
    return { kind: 'walking-boot', wearable: true, anchor: [0.095, 0.3, 0.08] };
  }
  return CASE_FALLBACK;
}

/** Device rows as the twin layer wants them. */
export type TwinDevice = {
  id: string;
  slug: string;
  name: string;
  confirmed: boolean;
};
