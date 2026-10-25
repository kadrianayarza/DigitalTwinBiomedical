import type { TwinPin } from '../twin/TwinViewer';
import { regionPoint } from '../../spacetimedb/src/voice.ts';
import {
  ASSESSMENT_LABEL,
  ASSESSMENT_NORMAL,
  ASSESSMENT_PROMPT,
  ASSESSMENT_SHORT,
  ASSESSMENT_STATUSES,
  ASSESSMENT_STATUS_LABEL,
  ASSESSMENT_SYSTEMS,
  assessmentLabel,
  isAssessmentStatus,
  isAssessmentSystem,
  latestBySystem,
  statusLabel,
  systemForRegion,
  type AssessmentStatus,
  type AssessmentSystem,
} from '../../spacetimedb/src/assessment.ts';

export {
  ASSESSMENT_LABEL,
  ASSESSMENT_NORMAL,
  ASSESSMENT_PROMPT,
  ASSESSMENT_SHORT,
  ASSESSMENT_STATUSES,
  ASSESSMENT_STATUS_LABEL,
  ASSESSMENT_SYSTEMS,
  assessmentLabel,
  isAssessmentStatus,
  isAssessmentSystem,
  latestBySystem,
  statusLabel,
  systemForRegion,
};
export type { AssessmentStatus, AssessmentSystem };

/** Status color for the hex badge and the 3D marker. */
export function statusTone(status: string): 'ok' | 'alarm' | 'off' | 'watch' {
  if (status === 'normal') return 'ok';
  if (status === 'abnormal') return 'alarm';
  if (status === 'deferred') return 'off';
  return 'watch';
}

/**
 * Marker anchor per system on the standing twin (feet at y=0, facing +z, patient's
 * right at -x). Psychosocial has no body region, so it stays a list-only system.
 */
const SYSTEM_ANCHOR: Record<AssessmentSystem, [number, number, number] | null> = {
  neuro: [0, 1.7, 0.03],
  heent: [0, 1.575, 0.1],
  respiratory: [-0.07, 1.31, 0.09],
  cardiovascular: [0.035, 1.25, 0.09],
  gi: [0, 1.06, 0.11],
  gu: [0, 0.93, 0.11],
  msk: [0, 1.02, -0.11],
  skin: [0, 0.9, -0.13],
  psych: null,
};

/** Latest assessment per system shown as diamond markers on the 3D model. */
export function assessmentPins<
  T extends { id: bigint; system: string; status: string; region: string; assessedAt: { microsSinceUnixEpoch: bigint } },
>(rows: readonly T[]): TwinPin[] {
  const pins: TwinPin[] = [];
  for (const [system, a] of latestBySystem(rows)) {
    if (!isAssessmentSystem(system)) continue;
    const anchor = a.region ? regionPoint(a.region) : SYSTEM_ANCHOR[system];
    if (!anchor) continue;
    pins.push({
      id: `assess:${String(a.id)}`,
      x: anchor[0],
      y: anchor[1],
      z: anchor[2],
      severity: a.status === 'abnormal' ? 8 : a.status === 'normal' ? 1 : 0,
      label: `${assessmentLabel(system)} · ${statusLabel(a.status)}`,
      tone: a.status === 'abnormal' ? 'alarm' : a.status === 'normal' ? 'ok' : 'off',
      diamond: true,
    });
  }
  return pins;
}

/** Parse an assessment pin id back to its row id ('assess:12' -> 12n). */
export function assessmentPinRowId(pinId: string): bigint | null {
  if (!pinId.startsWith('assess:')) return null;
  const id = BigInt(pinId.slice('assess:'.length));
  return Number.isFinite(Number(id)) ? id : null;
}
