// Mental-health instruments and rules, shared with the server module.
// Re-exported here so the client imports one path (pattern of src/lib/assessment.ts).

export {
  CRISIS_LINES,
  GAD7_QUESTIONS,
  MH_BAND_LABEL,
  MH_CRISIS_CODES,
  MH_KIND_LABEL,
  MH_KINDS,
  MH_MAX_SCORE,
  MH_OPTIONS,
  MOOD_SCALE,
  PHQ9_QUESTIONS,
  gad7Band,
  isCrisisNote,
  isElevatedWithLittleSleep,
  isMhKind,
  mhBand,
  phq9Band,
  type MhBand,
  type MhEntryLike,
  type MhKind,
} from '../../spacetimedb/src/mentalHealth';

import { MH_BAND_LABEL, MH_CRISIS_CODES, MOOD_SCALE } from '../../spacetimedb/src/mentalHealth';

/** Plain-language label for a bipolar mood day, e.g. -3 -> 'Very low'. */
export const moodLabel = (v: number) => MOOD_SCALE.find(m => m.value === v)?.label ?? 'Even';

/** Plain-language label for a screening band, e.g. 'mod_severe' -> 'Moderately severe'. */
export const bandLabel = (b: string) => MH_BAND_LABEL[b] ?? '';

/** True when the alert's reason codes mark a mental-health crisis, so crisis lines are pushed. */
export function isMhCrisisAlert(reasonCodes: string): boolean {
  const codes = reasonCodes.split(',').filter(Boolean);
  return codes.some(c => MH_CRISIS_CODES.includes(c));
}
