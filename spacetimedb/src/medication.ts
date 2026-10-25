// Medication schedules, presets, and glucose rules shared by reducers, the client, and tests.
// Preset text is a starting point for the clinician; verify against current prescribing information.

import type { RuleHit } from './clinical';

export const MED_KINDS = ['insulin_long', 'insulin_rapid', 'insulin_mixed', 'oral_diabetes', 'other'] as const;

export const MED_KIND_LABEL: Record<string, string> = {
  insulin_long: 'Long-acting insulin',
  insulin_rapid: 'Rapid-acting insulin',
  insulin_mixed: 'Premixed insulin',
  oral_diabetes: 'Oral diabetes medicine',
  other: 'Other',
};

export const MED_ROUTES = ['subcutaneous', 'oral', 'inhaled', 'topical', 'other'] as const;

export const isInsulin = (kind: string) => kind.startsWith('insulin');

const MINUTE = 60_000_000n;
const DAY = 1440n * MINUTE;

/** A dose row appears this long before its scheduled time. */
export const DUE_EARLY_MICROS = 30n * MINUTE;
/** An unlogged dose becomes missed this long after its scheduled time. */
export const MISSED_AFTER_MICROS = 60n * MINUTE;
export const DOSE_KEEP_MICROS = 7n * DAY;
export const MAX_DOSE_TIMES = 8;

export const GLUCOSE_LOW_MGDL = 70;
export const GLUCOSE_HIGH_MGDL = 300;

/** "8:00, 20:30, 08:00" -> "08:00,20:30". Throws with a user-facing message on bad input. */
export function normalizeTimes(raw: string): string {
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error('Add at least one dose time');
  const minutes = new Set<number>();
  for (const p of parts) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(p);
    if (!m) throw new Error(`"${p}" is not a 24-hour time like 08:00`);
    minutes.add(Number(m[1]) * 60 + Number(m[2]));
  }
  if (minutes.size > MAX_DOSE_TIMES) throw new Error(`At most ${MAX_DOSE_TIMES} dose times per day`);
  return [...minutes]
    .sort((a, b) => a - b)
    .map(n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`)
    .join(',');
}

/** The short schedule label shown on med lists ("Once daily"...) for a set of dose times. */
export function scheduleLabel(times: string): string {
  const n = times.split(',').filter(Boolean).length;
  if (n >= 4) return `${n} times daily`;
  return ['As needed', 'Once daily', 'Twice daily', 'Three times daily'][n]!;
}

/** Typical dose times behind a schedule label, so simple med rows still create dose slots. */
export function timesForSchedule(schedule: string): string {
  switch (schedule) {
    case 'Once daily':
      return '10:00';
    case 'Twice daily':
      return '08:00,20:00';
    case 'Three times daily':
      return '06:00,14:00,22:00';
    default:
      return '';
  }
}

/**
 * Scheduled dose instants (UTC micros) within [from, to] for normalized local times.
 * `tzOffsetMin` follows Date#getTimezoneOffset: minutes to add to local time to get UTC.
 */
export function doseSlots(times: string, tzOffsetMin: number, from: bigint, to: bigint): bigint[] {
  if (to < from) return [];
  const offset = BigInt(tzOffsetMin) * MINUTE;
  const local = from - offset;
  const floorDay = (local >= 0n ? local / DAY : (local - DAY + 1n) / DAY) * DAY;
  const minutes = times
    .split(',')
    .filter(Boolean)
    .map(t => {
      const [h, m] = t.split(':').map(Number);
      return BigInt(h! * 60 + m!) * MINUTE;
    });
  const out: bigint[] = [];
  for (let day = floorDay + offset - DAY; day <= to; day += DAY) {
    for (const m of minutes) {
      const slot = day + m;
      if (slot >= from && slot <= to) out.push(slot);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Rules for a fingerstick or CGM glucose reading in mg/dL. 0 means not measured. */
export function glucoseRules(mgdl: number): RuleHit[] {
  if (!(mgdl > 0)) return [];
  if (mgdl < GLUCOSE_LOW_MGDL) return [{ code: 'HYPOGLYCEMIA', priority: 'same_day' }];
  if (mgdl >= GLUCOSE_HIGH_MGDL) return [{ code: 'HYPERGLYCEMIA', priority: 'same_day' }];
  return [];
}

/** A missed or skipped insulin dose needs follow-up; other medicines are tracked for adherence only. */
export function doseRules(kind: string, status: string): RuleHit[] {
  if (isInsulin(kind) && (status === 'missed' || status === 'skipped')) {
    return [{ code: 'MISSED_INSULIN', priority: 'review_24h' }];
  }
  return [];
}

export type MedPreset = {
  key: string;
  name: string;
  kind: (typeof MED_KINDS)[number];
  dose: string;
  route: (typeof MED_ROUTES)[number];
  times: string;
  instructions: string;
  sideEffects: string[];
  contraindications: string[];
  requiresGlucose: boolean;
};

export const MED_PRESETS: MedPreset[] = [
  {
    key: 'glargine',
    name: 'Insulin glargine (basal)',
    kind: 'insulin_long',
    dose: '18 units',
    route: 'subcutaneous',
    times: '21:00',
    instructions: 'Inject once a day at the same time. Rotate injection sites. Do not mix with other insulins.',
    sideEffects: [
      'Low blood sugar: shaky, sweaty, fast heartbeat, confusion',
      'Redness, swelling, or itching at the injection site',
      'Lumps or pits under the skin where you inject (rotate sites)',
      'Weight gain',
      'Swelling in hands or feet',
    ],
    contraindications: [
      'During an episode of hypoglycemia',
      'Hypersensitivity to insulin glargine or its ingredients',
      'Not for intravenous use or for treating diabetic ketoacidosis',
      'Caution: with pioglitazone or rosiglitazone, watch for fluid retention and heart failure',
    ],
    requiresGlucose: true,
  },
  {
    key: 'lispro',
    name: 'Insulin lispro (mealtime)',
    kind: 'insulin_rapid',
    dose: '6 units',
    route: 'subcutaneous',
    times: '08:00,12:30,18:00',
    instructions: 'Inject within 15 minutes before a meal or right after eating. Check blood sugar first.',
    sideEffects: [
      'Low blood sugar: shaky, sweaty, fast heartbeat, confusion',
      'Low potassium: muscle cramps or weakness',
      'Redness, swelling, or itching at the injection site',
      'Lumps or pits under the skin where you inject (rotate sites)',
      'Weight gain',
    ],
    contraindications: [
      'During an episode of hypoglycemia',
      'Hypersensitivity to insulin lispro or its ingredients',
      'Caution: hypokalemia risk, monitor potassium when at risk',
      'Caution: never share pens or needles between patients',
    ],
    requiresGlucose: true,
  },
  {
    key: 'metformin',
    name: 'Metformin',
    kind: 'oral_diabetes',
    dose: '500 mg',
    route: 'oral',
    times: '08:00,18:00',
    instructions: 'Take with breakfast and dinner.',
    sideEffects: [
      'Nausea, diarrhea, or upset stomach (usually improves over weeks)',
      'Metallic taste',
      'Low vitamin B12 with long-term use',
      'Rare lactic acidosis: unusual muscle pain, trouble breathing, severe tiredness',
    ],
    contraindications: [
      'Severe kidney impairment (eGFR below 30)',
      'Acute or chronic metabolic acidosis, including diabetic ketoacidosis',
      'Hypersensitivity to metformin',
      'Caution: hold around iodinated contrast imaging when eGFR is 30-60, or with liver disease, heavy alcohol use, or heart failure',
    ],
    requiresGlucose: false,
  },
  {
    key: 'lithium',
    name: 'Lithium carbonate',
    kind: 'other',
    dose: '300 mg',
    route: 'oral',
    times: '08:00,20:00',
    instructions:
      'Twice daily with food and a full glass of water. Keep salt and fluid intake steady. Blood levels are checked regularly.',
    sideEffects: [
      'Tremor, thirst, or urinating more often',
      'Nausea or diarrhea early in treatment',
      'Weight gain or mild swelling',
      'Lithium toxicity: severe shaking, vomiting, slurred speech, unsteady walking, confusion (urgent)',
      'Low thyroid with long-term use',
    ],
    contraindications: [
      'Significant kidney impairment, unless levels can be monitored closely',
      'Hypersensitivity to lithium',
      'Caution: dehydration, low-salt diets, diuretics, and NSAIDs raise lithium levels',
      'Caution: do not stop abruptly; ask the prescriber before any dose change',
    ],
    requiresGlucose: false,
  },
  {
    key: 'sertraline',
    name: 'Sertraline',
    kind: 'other',
    dose: '50 mg',
    route: 'oral',
    times: '08:00',
    instructions:
      'Once daily in the morning with food. It can take 2 to 4 weeks to feel the full benefit. Do not stop suddenly.',
    sideEffects: [
      'Nausea, loose stools, or upset stomach in the first weeks',
      'Trouble sleeping or feeling jittery early in treatment',
      'Dry mouth, sweating, or headache',
      'Sexual side effects',
      'New or worsening thoughts of self-harm (urgent: contact your care team or 988 right away)',
    ],
    contraindications: [
      'Currently taking or within 14 days of an MAOI',
      'Pimozide use',
      'Hypersensitivity to sertraline',
      'Caution: young adults may have increased suicidal thoughts early in treatment; close follow-up in the first weeks',
    ],
    requiresGlucose: false,
  },
];
