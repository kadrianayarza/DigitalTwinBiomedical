// Head-to-toe nursing assessment, system by system. Pure catalogue and helpers shared by
// the reducers, the client, and the tests. Findings are reference prompts for clinicians,
// not a substitute for judgment.

export const ASSESSMENT_SYSTEMS = [
  'neuro',
  'heent',
  'respiratory',
  'cardiovascular',
  'gi',
  'gu',
  'msk',
  'skin',
  'psych',
] as const;
export type AssessmentSystem = (typeof ASSESSMENT_SYSTEMS)[number];

/** Full label for the chart and audit trail. */
export const ASSESSMENT_LABEL: Record<AssessmentSystem, string> = {
  neuro: 'Neurologic',
  heent: 'Head, eyes, ears, nose, and throat',
  respiratory: 'Respiratory',
  cardiovascular: 'Cardiovascular',
  gi: 'Gastrointestinal',
  gu: 'Genitourinary',
  msk: 'Musculoskeletal',
  skin: 'Skin and integumentary',
  psych: 'Psychosocial',
};

/** Short label for chips and markers. */
export const ASSESSMENT_SHORT: Record<AssessmentSystem, string> = {
  neuro: 'Neuro',
  heent: 'HEENT',
  respiratory: 'Respiratory',
  cardiovascular: 'Cardiac',
  gi: 'GI',
  gu: 'GU',
  msk: 'MSK',
  skin: 'Skin',
  psych: 'Psych',
};

/** What the nurse checks, shown as the prompt in the assessment sheet. */
export const ASSESSMENT_PROMPT: Record<AssessmentSystem, string> = {
  neuro: 'Mental status and speech, pupils, facial symmetry, grip strength, sensation',
  heent: 'Pupils, mucous membranes, airway, neck range of motion',
  respiratory: 'Effort and rate, breath sounds, cough, oxygen use',
  cardiovascular: 'Rate and rhythm, pulses, edema, capillary refill',
  gi: 'Bowel sounds, abdomen soft or tender, nausea, appetite, last bowel movement',
  gu: 'Urination, catheter or output, color and odor',
  msk: 'Strength, range of motion, joints, gait or transfers, the surgical limb',
  skin: 'Color and moisture, wounds or incisions, pressure points, turgor',
  psych: 'Mood, orientation, safety, support at home',
};

/** A pre-written normal finding the nurse can accept or edit. */
export const ASSESSMENT_NORMAL: Record<AssessmentSystem, string> = {
  neuro: 'Alert and oriented, speech clear, pupils equal and reactive, moves all limbs',
  heent: 'Pupils equal and reactive, membranes moist, airway clear, neck supple',
  respiratory: 'Breath sounds clear and equal, no distress, rate within range',
  cardiovascular: 'Regular rhythm, pulses 2+, no new edema, refill under 2 seconds',
  gi: 'Bowel sounds present, abdomen soft, no nausea, eating and drinking',
  gu: 'Voiding without complaint, urine clear and pale',
  msk: 'Full strength, moves all joints, gait and transfers as expected',
  skin: 'Skin warm, dry, and intact; no new wounds or pressure spots',
  psych: 'Mood appropriate, safety plan in place, support at home',
};

export const ASSESSMENT_STATUSES = ['normal', 'abnormal', 'deferred'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const ASSESSMENT_STATUS_LABEL: Record<AssessmentStatus, string> = {
  normal: 'Normal',
  abnormal: 'Abnormal',
  deferred: 'Deferred',
};

export const isAssessmentSystem = (v: string): v is AssessmentSystem =>
  (ASSESSMENT_SYSTEMS as readonly string[]).includes(v);

export const isAssessmentStatus = (v: string): v is AssessmentStatus =>
  (ASSESSMENT_STATUSES as readonly string[]).includes(v);

/** Label for any stored system code, falling back to the raw code. */
export const assessmentLabel = (s: string): string =>
  ASSESSMENT_LABEL[s as AssessmentSystem] ?? s;

/** Label for any stored status code, falling back to the raw code. */
export const statusLabel = (s: string): string => ASSESSMENT_STATUS_LABEL[s as AssessmentStatus] ?? s;

/**
 * Default system for a tapped twin region, so the assessment sheet opens pre-picked.
 * Head-in-front is HEENT, the back of the head picks neuro; the chest picks respiratory.
 */
export function systemForRegion(region: string): AssessmentSystem {
  const base = region.split('_')[0] ?? '';
  switch (base) {
    case 'head':
      return region.includes('posterior') ? 'neuro' : 'heent';
    case 'neck':
      return 'heent';
    case 'chest':
      return 'respiratory';
    case 'abdomen':
      return 'gi';
    case 'hip':
      return 'gu';
    case 'back':
      return 'msk';
    case 'shoulder':
    case 'arm':
    case 'forearm':
    case 'hand':
    case 'thigh':
    case 'knee':
    case 'calf':
    case 'foot':
      return 'msk';
    default:
      return 'msk';
  }
}

/** Latest assessment row per system, keyed by system code. */
export function latestBySystem<
  T extends { system: string; assessedAt: { microsSinceUnixEpoch: bigint } },
>(rows: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const r of rows) {
    const prior = latest.get(r.system);
    if (!prior || r.assessedAt.microsSinceUnixEpoch > prior.assessedAt.microsSinceUnixEpoch) {
      latest.set(r.system, r);
    }
  }
  return latest;
}
