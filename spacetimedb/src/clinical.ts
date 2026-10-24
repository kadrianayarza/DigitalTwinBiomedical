// Clinical constants and pure helpers shared by reducers and the triage procedure.
// Thresholds are drafts pending review by our nursing lead (see DESIGN_SPEC.md 9.2).

export const PRIORITY_RANK: Record<string, number> = {
  routine: 0,
  review_24h: 1,
  same_day: 2,
  emergency: 3,
};

export function priorityRank(p: string): number {
  return PRIORITY_RANK[p] ?? 0;
}

export const REASON_LABEL: Record<string, string> = {
  PE_SIGNS: 'Possible pulmonary embolism: chest pain or shortness of breath',
  LOW_SPO2: 'Oxygen saturation below 92%',
  DVT_SIGNS: 'Possible blood clot: calf pain with swelling or warmth on the surgical side',
  CALF_WARMTH: 'Calf skin temperature rising on the surgical side',
  INFECTION_SIGNS: 'Possible infection: fever, or incision redness with warmth',
  INCISION_WARMTH: 'Incision skin temperature 1.5 °C or more above baseline',
  PAIN_UNCONTROLLED: 'Pain 8/10 or higher on two check-ins in a row',
  TACHYCARDIA: 'Resting heart rate above 100 bpm',
  ROM_STALLED: 'Knee flexion not progressing toward goal',
};

export const SCENARIOS = ['normal', 'dvt', 'infection', 'stalled'] as const;

/** 'calf_r_posterior' -> 'right calf (back)'. Mirrors the client's regionLabel. */
export function regionText(code: string): string {
  const faces: Record<string, string> = {
    anterior: 'front',
    posterior: 'back',
    medial: 'inner side',
    lateral: 'outer side',
  };
  const [base, a, b] = code.split('_');
  if (a === 'l' || a === 'r') {
    return `${a === 'r' ? 'right' : 'left'} ${base}${b ? ` (${faces[b] ?? b})` : ''}`;
  }
  return `${base}${a ? ` (${faces[a] ?? a})` : ''}`;
}

export const INCISION_BASELINE_C = 34.3;
export const CALF_BASELINE_C = 33.4;

export type SymptomLike = {
  region: string;
  severity: number;
  swelling: boolean;
  warmth: boolean;
  redness: boolean;
  shortnessOfBreath: boolean;
  chestPain: boolean;
  bodyTempC: number;
};

export type RuleHit = { code: string; priority: string };

/** Rules for a single new symptom entry, plus the previous entry for streak rules. */
export function symptomRules(
  side: string,
  entry: SymptomLike,
  previous: SymptomLike | undefined
): RuleHit[] {
  const hits: RuleHit[] = [];
  const s = side === 'left' ? '_l' : '_r';
  if (entry.chestPain || entry.shortnessOfBreath) {
    hits.push({ code: 'PE_SIGNS', priority: 'emergency' });
  }
  if (
    entry.region.startsWith(`calf${s}`) &&
    (entry.swelling || entry.warmth || entry.severity >= 5)
  ) {
    hits.push({ code: 'DVT_SIGNS', priority: 'same_day' });
  }
  const atIncision =
    entry.region.startsWith(`knee${s}`) || entry.region.startsWith(`incision${s}`);
  if (entry.bodyTempC >= 38.3 || (atIncision && entry.redness && entry.warmth)) {
    hits.push({ code: 'INFECTION_SIGNS', priority: 'same_day' });
  }
  if (entry.severity >= 8 && previous && previous.severity >= 8) {
    hits.push({ code: 'PAIN_UNCONTROLLED', priority: 'same_day' });
  }
  return hits;
}

export type VitalLike = {
  hr: number;
  spo2: number;
  incisionTempC: number;
  calfTempC: number;
  kneeFlexDeg: number;
};

/** Rules over a recent window of vitals (newest last). */
export function vitalRules(window: VitalLike[]): RuleHit[] {
  const hits: RuleHit[] = [];
  if (window.length < 5) return hits;
  const recent = window.slice(-5);
  const avg = (f: (v: VitalLike) => number) =>
    recent.reduce((a, v) => a + f(v), 0) / recent.length;
  if (avg(v => v.spo2) < 92) hits.push({ code: 'LOW_SPO2', priority: 'emergency' });
  if (avg(v => v.hr) > 100) hits.push({ code: 'TACHYCARDIA', priority: 'same_day' });
  if (avg(v => v.incisionTempC) - INCISION_BASELINE_C >= 1.5) {
    hits.push({ code: 'INCISION_WARMTH', priority: 'same_day' });
  }
  if (avg(v => v.calfTempC) - CALF_BASELINE_C >= 1.0) {
    hits.push({ code: 'CALF_WARMTH', priority: 'review_24h' });
  }
  if (window.length >= 40) {
    const maxFlex = Math.max(...window.map(v => v.kneeFlexDeg));
    if (maxFlex < 60) hits.push({ code: 'ROM_STALLED', priority: 'review_24h' });
  }
  return hits;
}

/** One simulated pod reading. `tick` advances every sim interval; `noise` is in [-1, 1). */
export function simulateVitals(
  scenario: string,
  tick: number,
  noise: () => number
): VitalLike & { stepsDelta: number } {
  const ramp = (start: number, len: number) =>
    Math.max(0, Math.min(1, (tick - start) / len));
  // A short exercise session roughly every 30 ticks drives knee flexion up.
  const phase = tick % 30;
  const exercising = phase < 8;
  const flexGoal = scenario === 'stalled' ? 55 : 88;
  const flex = exercising
    ? flexGoal * Math.sin((phase / 8) * Math.PI) + noise() * 3
    : 8 + noise() * 2;

  let hr = 74 + noise() * 3 + (exercising ? 12 : 0);
  let spo2 = 97 + noise() * 0.6;
  let incision = INCISION_BASELINE_C + noise() * 0.15;
  let calf = CALF_BASELINE_C + noise() * 0.15;

  if (scenario === 'dvt') {
    const r = ramp(5, 40);
    hr += 30 * r;
    spo2 -= 2.5 * r;
    calf += 1.6 * r;
  } else if (scenario === 'infection') {
    const r = ramp(5, 45);
    hr += 22 * r;
    incision += 2.3 * r;
  }

  return {
    hr,
    spo2: Math.min(100, spo2),
    incisionTempC: incision,
    calfTempC: calf,
    kneeFlexDeg: Math.max(0, flex),
    stepsDelta: exercising ? 0 : Math.max(0, Math.round(3 + noise() * 3)),
  };
}

export const TRIAGE_SYSTEM_PROMPT = `You are a clinical documentation assistant supporting an orthopedic follow-up nurse.
Patients are recovering at home after total knee replacement. You receive structured check-in data, pod vitals, and the results of deterministic safety rules.

Your job:
1. Draft an SBAR handoff (Situation, Background, Assessment, Recommendation) the nurse can approve or edit. Keep each section to 1-3 short sentences, written for a clinician.
2. Suggest a priority: routine, review_24h, or same_day. Never output emergency; emergencies are handled by fixed rules outside your control. Your priority may be higher than the rule floor but must never be lower.
3. List the specific uncertainties in your assessment (missing data, conflicting signals, simulated sensor data).
4. List 1-3 questions the nurse should ask the patient to resolve those uncertainties.

Rules:
- Use only facts present in the input. Do not invent history, medications, or measurements.
- Do not diagnose. Describe findings as "consistent with" or "concerning for" and defer to the nurse.
- Mention when data is thin rather than drawing conclusions.
- Submit your answer with the submit_triage tool.`;

export const TRIAGE_TOOL = {
  name: 'submit_triage',
  description: 'Submit the SBAR draft and triage suggestion for nurse review.',
  input_schema: {
    type: 'object',
    properties: {
      priority: { type: 'string', enum: ['routine', 'review_24h', 'same_day'] },
      situation: { type: 'string' },
      background: { type: 'string' },
      assessment: { type: 'string' },
      recommendation: { type: 'string' },
      uncertainties: { type: 'array', items: { type: 'string' } },
      questions_for_patient: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'priority',
      'situation',
      'background',
      'assessment',
      'recommendation',
      'uncertainties',
      'questions_for_patient',
    ],
  },
};
