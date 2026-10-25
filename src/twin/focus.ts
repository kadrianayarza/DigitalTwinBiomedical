import { kneeTarget } from './anatomy';

type Vec3 = [number, number, number];

/** A camera close-up on the body region a patient's condition is about. */
export type FocusRegion = {
  label: string;
  target: Vec3;
  /** Camera position relative to the target. */
  offset: Vec3;
};

/** The only implant the twin can draw is a total knee replacement. */
export const hasKneeImplant = (procedure: string) =>
  /knee/i.test(procedure) && /replacement|arthroplasty/i.test(procedure);

/**
 * Twin space: feet at y=0, about 1.72 m tall, facing +z, patient's right at -x.
 * Seated twins only matter for the personal scan; the anatomy view is always standing.
 */
export function focusForCondition(procedure: string, side: 'l' | 'r', seated = false): FocusRegion | null {
  const sx = side === 'r' ? -1 : 1;
  const text = procedure.toLowerCase();

  if (/knee/.test(text)) {
    const [x, y, z] = kneeTarget(side);
    return { label: 'Knee', target: [x, y, z], offset: [0.45, 0.2, 1.15] };
  }
  if (/hip/.test(text)) return { label: 'Hip', target: [sx * 0.1, 0.92, 0.02], offset: [sx * 0.5, 0.15, 1.3] };
  if (/shoulder/.test(text)) return { label: 'Shoulder', target: [sx * 0.18, 1.42, 0], offset: [sx * 0.5, 0.1, 1.3] };
  if (/foot|ankle/.test(text)) return { label: 'Foot', target: [sx * 0.09, 0.08, 0.04], offset: [sx * 0.55, 0.45, 1.15] };
  if (/concussion|head|brain|stroke|migraine/.test(text)) {
    return { label: 'Head', target: [0, 1.58, 0.02], offset: [0.4, 0.06, 1.45] };
  }
  if (/heart|cardiac/.test(text)) return { label: 'Heart', target: [0.035, 1.25, 0.05], offset: [0.4, 0.1, 1.55] };
  if (/copd|lung|pneumo|asthma|respir/.test(text)) {
    return { label: 'Lungs', target: [0, 1.28, 0.02], offset: [0, 0.08, 1.7] };
  }
  if (/spin|back/.test(text)) {
    // The seated scan's wheelchair backrest hides the spine from behind, so look from the side.
    return seated
      ? { label: 'Spine', target: [0, 0.82, -0.08], offset: [1.5, 0.15, 0.5] }
      : { label: 'Spine', target: [0, 1.1, -0.06], offset: [0.4, 0.1, -1.75] };
  }
  return null;
}
