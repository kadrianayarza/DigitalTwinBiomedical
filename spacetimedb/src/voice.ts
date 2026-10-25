// Voice capture: turn one spoken sentence into proposed record updates that the speaker
// confirms item by item. Claude interprets the sentence; the helpers here validate its
// output and provide a deterministic fallback when the model is unavailable.
//
// Nothing in this file touches the database, so it is shared by the parse procedure,
// the confirm reducers, and the unit tests.

export const VOICE_ITEM_KINDS = [
  'symptom',
  'vitals',
  'dose',
  'lab',
  'history',
  'diet',
  'sleep',
  'exercise',
] as const;
export type VoiceItemKind = (typeof VOICE_ITEM_KINDS)[number];

export const VOICE_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type VoiceConfidence = (typeof VOICE_CONFIDENCES)[number];

/** The app section a confirmed item writes to; the client highlights this anchor. */
export const VOICE_TARGET_FOR: Record<VoiceItemKind, string> = {
  symptom: 'check-ins',
  vitals: 'vitals',
  dose: 'medications',
  lab: 'labs',
  history: 'history',
  diet: 'diet',
  sleep: 'sleep',
  exercise: 'exercise',
};

export const VOICE_KIND_LABEL: Record<VoiceItemKind, string> = {
  symptom: 'Symptom check-in',
  vitals: 'Vital signs',
  dose: 'Medication dose',
  lab: 'Lab result',
  history: 'Health history',
  diet: 'Diet and fluids',
  sleep: 'Sleep and rest',
  exercise: 'Exercise',
};

/** Weekday names, Monday first, shared by the parser, the card, and the questions. */
export const EXERCISE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Workout intensities, shared by the parser, the reducer, and the card. */
export const EXERCISE_INTENSITIES = ['light', 'moderate', 'hard'] as const;
export type ExerciseIntensity = (typeof EXERCISE_INTENSITIES)[number];

/** Kinds only the care team may write, matching the existing reducers. */
export const NURSE_ONLY_KINDS: readonly VoiceItemKind[] = ['lab', 'history'];

export const VOICE_MAX_ITEMS = 12;
export const VOICE_MAX_TRANSCRIPT = 2000;
export const VOICE_MAX_LABEL = 120;
export const VOICE_MAX_REPLY = 600;

export type VoiceDetail = Record<string, string | number | boolean>;

export type VoiceCandidate = {
  kind: VoiceItemKind;
  /** Short plain-language summary shown above the confirm buttons. */
  label: string;
  target: string;
  confidence: VoiceConfidence;
  detail: VoiceDetail;
};

/** One medicine's patient-facing reference card, used to answer spoken questions. */
export type VoiceMedFact = {
  name: string;
  instructions: string;
  sideEffects: string[];
};

/** One open alert, so "why was my nurse notified" can be answered plainly. */
export type VoiceAlertFact = {
  priority: string;
  reasons: string[];
};

/** Everything the fallback parser needs to resolve spoken names to record rows. */
export type VoiceContext = {
  /** The patient's surgical side, used when the speaker does not say left or right. */
  side: 'left' | 'right';
  medications: string[];
  labs: string[];
  /** Medicine cards and open alerts, so questions can be answered from the record. */
  medFacts?: VoiceMedFact[];
  alerts?: VoiceAlertFact[];
};

export const VOICE_SYSTEM_PROMPT = `You convert one spoken sentence from a patient or their nurse into proposed updates to a remote-monitoring record. The speaker will confirm each proposal individually before anything is saved.

Supported update kinds:
- symptom: a physical complaint the patient feels. Include region, severity (0-10), and any of quality, swelling, warmth, redness, chestPain, shortnessOfBreath, bodyTempC, notes.
- vitals: measured numbers. Include any of hr, systolic, diastolic, respRate, spo2, tempC, glucoseMgDl.
- dose: a medication the patient took or skipped. Include medicationName and status ("taken" or "skipped"), plus glucoseMgDl when a blood sugar reading was given with it.
- lab: a laboratory value the nurse is recording. Include name, value, and unit when stated.
- history: a standing fact for the chart. Include category (medical, surgical, allergy, family, social), title, detail, and whenText.
- diet: something eaten or drunk, or appetite and fluid intake. Include summary, plus amount and whenText when stated.
- sleep: sleep or rest. Include summary, plus hours as a number when stated, and whenText.
- exercise: a workout, or a plan for one. Include activity, minutes, and intensity (light, moderate, or hard). When they name a weekday, include day (0-6, Monday first) and status "planned"; otherwise status is "done" for something they just did.

Rules:
- Only propose what the speaker actually said. Never invent a measurement, medication, or date.
- Split a compound sentence into separate proposals, one per distinct fact.
- Convert spoken temperature in Fahrenheit to Celsius in tempC, and keep whole numbers as numbers.
- Region codes are lowercase: a body part, then _l or _r for limbs, then _anterior or _posterior. For example knee_r_anterior, calf_l_posterior, chest.
- Use the medication and lab names exactly as they appear in the provided lists. If nothing matches, omit that proposal.
- Set confidence to "high" when the speaker was explicit, "medium" when you inferred a detail, and "low" when the wording was ambiguous.
- Write each label as a short plain-language summary, for example "Right knee pain 6/10".
- If the sentence contains nothing recordable, return an empty items list.

Answering questions:
- When the speaker asks a question, or says hello or thanks you, set reply to a short warm answer you would speak aloud: at most three short sentences, plain words, no lists or markdown.
- Answer questions ONLY from the provided facts (medicine instructions and side effects, open alert reasons, recent readings). Never invent medical advice and never interpret what a value means.
- If the answer is not in the provided facts, say you have noted it for the care team and that they should ask their nurse.
- A sentence can carry both a reply and items: answer the question and still propose the updates.
- When the sentence is a plain update, leave reply empty and just propose items.`;

export const VOICE_TOOL = {
  name: 'submit_voice_updates',
  description: 'Submit the record updates proposed from one spoken sentence.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...VOICE_ITEM_KINDS] },
            label: { type: 'string' },
            confidence: { type: 'string', enum: [...VOICE_CONFIDENCES] },
            fields: { type: 'object' },
          },
          required: ['kind', 'label', 'confidence', 'fields'],
        },
      },
      reply: {
        type: 'string',
        description:
          'A short spoken answer when the sentence was a question or greeting. Empty when it was a plain update.',
      },
    },
    required: ['items'],
  },
} as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keep only finite numbers, drop everything else. */
function num(raw: unknown, min: number, max: number): number | undefined {
  const v = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v < min || v > max) return undefined;
  return v;
}

function bool(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function text(raw: unknown, max = 400): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  return v ? v.slice(0, max) : undefined;
}

/** Body regions the twin can pin a symptom to. */
const SIDED_REGIONS = ['knee', 'calf', 'thigh', 'foot', 'hip', 'shoulder', 'arm', 'forearm', 'hand'];
const CENTRE_REGIONS = ['chest', 'abdomen', 'back', 'neck', 'head'];
const REGION_FACES = ['anterior', 'posterior', 'medial', 'lateral'];

/** Validate a region code, rejecting anything the twin cannot display. */
export function normalizeRegion(raw: unknown, side: 'left' | 'right'): string | undefined {
  const value = text(raw, 40)?.toLowerCase();
  if (!value) return undefined;
  const [base, a, b] = value.split('_');
  if (!base) return undefined;
  if (CENTRE_REGIONS.includes(base)) {
    if (a && REGION_FACES.includes(a)) return `${base}_${a}`;
    return base;
  }
  if (!SIDED_REGIONS.includes(base)) return undefined;
  const letter = a === 'l' || a === 'r' ? a : side === 'left' ? 'l' : 'r';
  const face = b && REGION_FACES.includes(b) ? b : a && REGION_FACES.includes(a) ? a : 'anterior';
  return `${base}_${letter}_${face}`;
}

function symptomDetail(fields: Record<string, unknown>, side: 'left' | 'right'): VoiceDetail {
  const detail: VoiceDetail = {};
  const region = normalizeRegion(fields.region, side);
  if (region) detail.region = region;
  const severity = num(fields.severity, 0, 10);
  if (severity !== undefined) detail.severity = Math.round(severity);
  const quality = text(fields.quality, 40);
  if (quality) detail.quality = quality;
  for (const flag of ['swelling', 'warmth', 'redness', 'chestPain', 'shortnessOfBreath'] as const) {
    const v = bool(fields[flag]);
    if (v !== undefined) detail[flag] = v;
  }
  const tempC = num(fields.bodyTempC, 30, 45);
  if (tempC !== undefined) detail.bodyTempC = tempC;
  const notes = text(fields.notes, 500);
  if (notes) detail.notes = notes;
  return detail;
}

function vitalsDetail(fields: Record<string, unknown>): VoiceDetail {
  const detail: VoiceDetail = {};
  const hr = num(fields.hr, 20, 250);
  if (hr !== undefined) detail.hr = hr;
  const systolic = num(fields.systolic, 50, 260);
  const diastolic = num(fields.diastolic, 20, 160);
  if (systolic !== undefined && diastolic !== undefined && systolic > diastolic) {
    detail.systolic = systolic;
    detail.diastolic = diastolic;
  }
  const respRate = num(fields.respRate, 4, 80);
  if (respRate !== undefined) detail.respRate = respRate;
  const spo2 = num(fields.spo2, 50, 100);
  if (spo2 !== undefined) detail.spo2 = spo2;
  const tempC = num(fields.tempC, 30, 45);
  if (tempC !== undefined) detail.tempC = tempC;
  const glucose = num(fields.glucoseMgDl, 10, 900);
  if (glucose !== undefined) detail.glucoseMgDl = glucose;
  return detail;
}

function doseDetail(fields: Record<string, unknown>, meds: string[]): VoiceDetail {
  const detail: VoiceDetail = {};
  const name = matchKnownName(text(fields.medicationName, 80), meds);
  if (!name) return detail;
  detail.medicationName = name;
  detail.status = fields.status === 'skipped' ? 'skipped' : 'taken';
  const glucose = num(fields.glucoseMgDl, 10, 900);
  if (glucose !== undefined) detail.glucoseMgDl = glucose;
  return detail;
}

function labDetail(fields: Record<string, unknown>, labs: string[]): VoiceDetail {
  const detail: VoiceDetail = {};
  const name = matchKnownName(text(fields.name, 80), labs);
  if (!name) return detail;
  const value = num(fields.value, -10_000, 100_000);
  if (value === undefined) return detail;
  detail.name = name;
  detail.value = value;
  const unit = text(fields.unit, 20);
  if (unit) detail.unit = unit;
  return detail;
}

const HISTORY_KEYWORDS = ['medical', 'surgical', 'allergy', 'family', 'social'];

function historyDetail(fields: Record<string, unknown>): VoiceDetail {
  const detail: VoiceDetail = {};
  const title = text(fields.title, 120);
  if (!title) return detail;
  detail.title = title;
  const category = text(fields.category, 20)?.toLowerCase();
  detail.category = category && HISTORY_KEYWORDS.includes(category) ? category : 'medical';
  const extra = text(fields.detail, 400);
  if (extra) detail.detail = extra;
  const when = text(fields.whenText, 60);
  if (when) detail.whenText = when;
  return detail;
}

/** Diet and sleep notes share one shape: a short summary plus optional amount or hours. */
function lifestyleDetail(fields: Record<string, unknown>, kind: 'diet' | 'sleep'): VoiceDetail {
  const detail: VoiceDetail = {};
  const summary = text(fields.summary ?? fields.title, 200);
  if (!summary) return detail;
  detail.summary = summary;
  const amount = text(fields.amount, 80);
  if (amount) detail.amount = amount;
  const when = text(fields.whenText, 60);
  if (when) detail.whenText = when;
  if (kind === 'sleep') {
    const hours = num(fields.hours, 0, 24);
    if (hours !== undefined) detail.hours = hours;
  }
  return detail;
}

/** A workout: the activity, how long, how hard, and whether it is planned or done. */
function exerciseDetail(fields: Record<string, unknown>): VoiceDetail {
  const detail: VoiceDetail = {};
  const activity = text(fields.activity ?? fields.summary, 60);
  if (!activity) return detail;
  detail.activity = activity;
  const minutes = num(fields.minutes, 1, 600);
  if (minutes !== undefined) detail.minutes = minutes;
  const intensityRaw = (text(fields.intensity, 20) ?? '').toLowerCase();
  detail.intensity = (EXERCISE_INTENSITIES as readonly string[]).includes(intensityRaw)
    ? (intensityRaw as ExerciseIntensity)
    : 'moderate';
  const day = num(fields.day, 0, 6);
  if (day !== undefined) detail.day = day;
  detail.status = text(fields.status, 10) === 'planned' ? 'planned' : 'done';
  return detail;
}

/** Map spoken wording to a tidy activity name for the plan and the question. */
function exerciseActivity(text: string): string {
  const checks: Array<[RegExp, string]> = [
    [/\b(yoga|pilates)\b/, 'Yoga'],
    [/\b(swim\w*|swam)\b/, 'Swim'],
    [/\b(cycl\w*|bik\w*|spin)\b/, 'Cycle'],
    [/\b(ran|run|running|jog\w*)\b/, 'Run'],
    [/\bhik\w*\b/, 'Hike'],
    [/\bwalk\w*\b/, 'Walk'],
    [/\b(lift\w*|weights?|strength)\b/, 'Strength'],
    [/\bdanc\w*\b/, 'Dance'],
    [/\b(soccer|basketball|football|tennis)\b/, 'Sport'],
    [/\bstretch\w*\b/, 'Stretch'],
  ];
  for (const [re, name] of checks) if (re.test(text)) return name;
  return 'Workout';
}

/** Resolve a spoken name to one of the known names, by full or distinctive-word match. */
export function matchKnownName(spoken: string | undefined, known: string[]): string | undefined {
  if (!spoken) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const target = norm(spoken);
  if (!target) return undefined;
  const exact = known.find(k => norm(k) === target);
  if (exact) return exact;
  // "lispro" should match "Insulin lispro (mealtime)", and vice versa.
  const words = target.split(' ').filter(w => w.length >= 4);
  const byWord = known.filter(k => {
    const kw = norm(k).split(' ').filter(w => w.length >= 4);
    return words.some(w => kw.includes(w)) || kw.some(w => target.includes(w));
  });
  return byWord[0];
}

/** The distinctive word of a name: "Insulin lispro (mealtime)" -> "lispro". */
export function distinctiveWord(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.length > 0 ? words[words.length - 1]! : '';
}

// ---------------------------------------------------------------------------
// Region geometry
// ---------------------------------------------------------------------------

/** Base position of each region on the twin, mirroring the client's body model. */
const REGION_POINTS: Record<string, [number, number, number]> = {
  knee: [0.095, 0.485, 0.005],
  calf: [0.095, 0.27, -0.005],
  thigh: [0.095, 0.69, 0],
  foot: [0.095, 0.03, 0.05],
  hip: [0.09, 0.93, 0],
  shoulder: [0.205, 1.4, 0],
  arm: [0.235, 1.23, 0],
  forearm: [0.262, 0.98, 0.01],
  hand: [0.272, 0.81, 0.015],
  chest: [0, 1.29, 0],
  abdomen: [0, 1.06, 0],
  back: [0, 1.06, -0.12],
  neck: [0, 1.49, -0.005],
  head: [0, 1.62, 0],
};

/** Pin position for a region code, so a spoken symptom lands on the right spot. */
export function regionPoint(region: string): [number, number, number] {
  const [base, a, b] = region.split('_');
  const anchor = REGION_POINTS[base ?? ''] ?? [0, 1.06, 0];
  const side = a === 'l' || a === 'r' ? a : b === 'l' || b === 'r' ? b : undefined;
  const face = [a, b].find(v => v === 'anterior' || v === 'posterior' || v === 'medial' || v === 'lateral');
  const sx = side === 'r' ? -1 : 1;
  const x = anchor[0] * sx;
  const z = anchor[2] + (face === 'posterior' ? -0.06 : face === 'anterior' ? 0.06 : 0);
  const medial = face === 'medial' ? -0.03 * sx : face === 'lateral' ? 0.03 * sx : 0;
  return [x + medial, anchor[1], z];
}

/**
 * Validate one model-proposed item. Returns null when the item is unusable, so the
 * caller can drop it instead of showing the user something that cannot be saved.
 */
export function normalizeCandidate(
  raw: unknown,
  ctx: VoiceContext
): VoiceCandidate | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (typeof kind !== 'string' || !VOICE_ITEM_KINDS.includes(kind as VoiceItemKind)) return null;
  const typed = kind as VoiceItemKind;
  const label = text(raw.label, VOICE_MAX_LABEL);
  if (!label) return null;
  const fields = isRecord(raw.fields) ? raw.fields : {};

  let detail: VoiceDetail;
  switch (typed) {
    case 'symptom':
      detail = symptomDetail(fields, ctx.side);
      if (!detail.region && detail.severity === undefined) return null;
      break;
    case 'vitals':
      detail = vitalsDetail(fields);
      if (Object.keys(detail).length === 0) return null;
      break;
    case 'dose':
      detail = doseDetail(fields, ctx.medications);
      if (!detail.medicationName) return null;
      break;
    case 'lab':
      detail = labDetail(fields, ctx.labs);
      if (!detail.name) return null;
      break;
    case 'history':
      detail = historyDetail(fields);
      if (!detail.title) return null;
      break;
    case 'diet':
    case 'sleep':
      detail = lifestyleDetail(fields, typed);
      if (!detail.summary) return null;
      break;
    case 'exercise':
      detail = exerciseDetail(fields);
      if (!detail.activity) return null;
      break;
  }

  const confidence = VOICE_CONFIDENCES.includes(raw.confidence as VoiceConfidence)
    ? (raw.confidence as VoiceConfidence)
    : 'medium';

  return { kind: typed, label, target: VOICE_TARGET_FOR[typed], confidence, detail };
}

/** Validate a whole model response, capped and de-duplicated. */
export function normalizeCandidates(raw: unknown, ctx: VoiceContext): VoiceCandidate[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.items) ? raw.items : [];
  const out: VoiceCandidate[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const candidate = normalizeCandidate(item, ctx);
    if (!candidate) continue;
    const key = `${candidate.kind}:${JSON.stringify(candidate.detail)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= VOICE_MAX_ITEMS) break;
  }
  return out;
}


// ---------------------------------------------------------------------------
// Confirmation questions and spoken answers
// ---------------------------------------------------------------------------

/** 'knee_r_anterior' -> 'right knee', for speaking the confirmation question. */
export function spokenRegionText(region: string): string {
  const [base, a] = region.split('_');
  const side = a === 'l' ? 'left' : a === 'r' ? 'right' : undefined;
  return side ? `${side} ${base}` : base;
}

/** Re-voice a first-person clause as second person: "I ate soup" -> "you ate soup". */
function asHeard(summary: string): string {
  return summary
    .trim()
    .replace(/\bi'?m\b/gi, "you're")
    .replace(/\bi'?ve\b/gi, "you've")
    .replace(/^i\b/gi, 'you')
    .replace(/\bmy\b/gi, 'your')
    .replace(/\bme\b/gi, 'you');
}

/**
 * The question the assistant asks before saving one proposal. It quotes the fact back
 * in plain words, so a spoken yes means "write exactly that".
 */
export function confirmQuestion(kind: VoiceItemKind, detail: VoiceDetail): string {
  switch (kind) {
    case 'dose': {
      const med = typeof detail.medicationName === 'string' ? detail.medicationName : 'your medicine';
      return `Do you want me to record that you ${detail.status === 'skipped' ? 'skipped' : 'took'} ${med}?`;
    }
    case 'symptom': {
      const parts: string[] = [];
      if (typeof detail.region === 'string' && detail.region) {
        parts.push(`your ${spokenRegionText(detail.region)} hurts`);
      } else if (detail.chestPain === true) {
        parts.push('you have chest pain');
      } else if (detail.shortnessOfBreath === true) {
        parts.push('you are short of breath');
      } else {
        parts.push('you feel something is wrong');
      }
      if (typeof detail.severity === 'number') parts.push(`${detail.severity} out of 10`);
      if (detail.shortnessOfBreath === true && !parts.includes('you are short of breath')) {
        parts.push('you are short of breath');
      }
      if (detail.swelling === true) parts.push('it is swollen');
      if (detail.warmth === true) parts.push('it feels warm');
      if (detail.redness === true) parts.push('it looks red');
      if (typeof detail.bodyTempC === 'number') parts.push(`temperature ${detail.bodyTempC}`);
      return `Do you want me to record that ${parts.join(', ')}?`;
    }
    case 'vitals': {
      const bits: string[] = [];
      if (typeof detail.systolic === 'number' && typeof detail.diastolic === 'number') {
        bits.push(`blood pressure ${detail.systolic} over ${detail.diastolic}`);
      }
      if (typeof detail.hr === 'number') bits.push(`heart rate ${detail.hr}`);
      if (typeof detail.respRate === 'number') bits.push(`breathing rate ${detail.respRate}`);
      if (typeof detail.spo2 === 'number') bits.push(`oxygen level ${detail.spo2} percent`);
      if (typeof detail.tempC === 'number') bits.push(`temperature ${detail.tempC}`);
      if (typeof detail.glucoseMgDl === 'number') bits.push(`blood sugar ${detail.glucoseMgDl}`);
      return bits.length > 0
        ? `Do you want me to record these readings: ${bits.join(', ')}?`
        : 'Do you want me to record these readings?';
    }
    case 'lab': {
      const name = typeof detail.name === 'string' ? detail.name : 'a result';
      const value = typeof detail.value === 'number' ? ` of ${detail.value}` : '';
      const unit = typeof detail.unit === 'string' && detail.unit ? ` ${detail.unit}` : '';
      return `Do you want me to record ${name}${value}${unit} in your chart?`;
    }
    case 'history': {
      const title = typeof detail.title === 'string' ? detail.title : 'this fact';
      return `Do you want me to add "${title}" to your health history?`;
    }
    case 'diet':
    case 'sleep': {
      const summary = typeof detail.summary === 'string' && detail.summary ? detail.summary : 'this';
      return `Do you want me to record that ${asHeard(summary)}?`;
    }
    case 'exercise': {
      const activity =
        typeof detail.activity === 'string' && detail.activity ? detail.activity.toLowerCase() : 'workout';
      const minutes = typeof detail.minutes === 'number' ? `, ${detail.minutes} minutes` : '';
      if (detail.status === 'planned') {
        const day = typeof detail.day === 'number' ? ` on ${EXERCISE_DAYS[detail.day] ?? 'that day'}` : '';
        return `Do you want me to schedule ${activity}${minutes}${day}?`;
      }
      return `Do you want me to record your ${activity}${minutes}?`;
    }
  }
}

const QUESTION_WORDS = /\b(what|why|how|when|where|which|who)\b|\?$/;
const CARE_TEAM_WORDS = /\b(nurse|doctor|care team|hospital)\b/;

/**
 * Best-effort spoken answer when no language model is available. Answers only from the
 * provided record facts (medicine cards, open alerts); anything clinical is deflected
 * to the care team rather than guessed. Returns '' for a plain update.
 */
export function replyVoiceLocally(transcript: string, ctx: VoiceContext): string {
  const t = transcript.trim().toLowerCase();
  if (!t) return '';
  const words = t.split(/\s+/).length;

  // --- greetings and small talk -------------------------------------------
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(t) && words <= 4) {
    return "Hi! Tell me what changed and I'll sort it into the right part of your record. You can also ask about your medicines or why your nurse was notified.";
  }
  if (/\bhow are you\b/.test(t) && words <= 8) {
    return "I'm doing well, thanks for asking! Tell me what changed and I'll sort it into your record.";
  }
  if (/\b(thanks|thank you)\b/.test(t) && words <= 5) {
    return "You're welcome. I'm here whenever anything changes.";
  }
  if (/\b(what can you do|who are you|what are you|how do you work)\b/.test(t)) {
    return "I listen for changes - symptoms, readings, medicines, meals and sleep - and file each one into the right part of your record. I can also explain your medicines or why your care team was notified.";
  }

  // --- medicine questions ---------------------------------------------------
  const asksForMedOverview =
    (ctx.medFacts?.length ?? 0) > 0 &&
    !CARE_TEAM_WORDS.test(t) &&
    /\b(meds?|medicines?|medications?)\b/.test(t) &&
    /\b(explain|tell me about|walk me through|list|what are|which|review)\b/.test(t);
  if (asksForMedOverview) {
    const lines = ctx.medFacts!.map(f => {
      const first = f.instructions.split(/[.!?]/)[0]?.trim() || 'as prescribed';
      return `${f.name} - ${first}`;
    });
    return `You are on ${ctx.medFacts!.length} medicines. ${lines.join('. ')}. Ask me about any one of them for its side effects.`;
  }

  const med = spokenName(t, ctx.medications);
  if (med && !CARE_TEAM_WORDS.test(t) && (QUESTION_WORDS.test(t) || /\b(side effects?|instructions?|tell me about|explain)\b/.test(t))) {
    const fact = ctx.medFacts?.find(f => f.name === med);
    if (/\bside effects?\b/.test(t)) {
      const list = fact?.sideEffects.filter(Boolean) ?? [];
      return list.length > 0
        ? `The common side effects of ${med} are: ${list.join(', ')}. Tell your nurse if any of them feel severe.`
        : `${med} is on your medicine list, but I don't have its side effects. Your nurse can add them.`;
    }
    const lines: string[] = [];
    if (fact?.instructions.trim()) lines.push(`${med}: ${fact.instructions.trim()}`);
    if (fact && fact.sideEffects.length > 0) {
      lines.push(`Common side effects can include: ${fact.sideEffects.join(', ')}.`);
    }
    if (lines.length === 0) {
      return `${med} is on your medicine list, but I don't have its details. Your nurse can walk you through it.`;
    }
    lines.push('Take it exactly as prescribed, and ask your nurse if anything feels wrong.');
    return lines.join(' ');
  }

  // --- alert questions ------------------------------------------------------
  const asksWhyCareTeam =
    (/\bwhy\b/.test(t) && /\b(nurse|doctor|care team|notified|alerted|alert|flag|priority)\b/.test(t)) ||
    (/\b(did|has|was)\b/.test(t) && /\b(nurse|doctor|care team)\b/.test(t) && /\b(notif|alert|call|message)\b/.test(t));
  if (asksWhyCareTeam) {
    const open = ctx.alerts ?? [];
    if (open.length === 0) {
      return "Nothing is flagged on your record right now, so your care team has not been notified. If something feels wrong, tell me and I'll record it.";
    }
    const reasons = [...new Set(open.flatMap(a => a.reasons).filter(Boolean))];
    return `Your care team was notified because: ${reasons.join('; ')}. Your nurse can see it and will follow up with you.`;
  }

  // --- advice questions: deflect rather than guess ---------------------------
  if (
    /\b(what|how) should i\b/.test(t) ||
    /\bshould i (call|go|worry|stop)\b/.test(t) ||
    /\bis (this|that|it) (serious|normal|bad|okay|ok|dangerous)\b/.test(t)
  ) {
    return "I can't give medical advice. I've kept your words here in the chat so you can show your nurse, and if anything feels urgent, contact your care team right away.";
  }

  // --- any other question ---------------------------------------------------
  const questionish =
    QUESTION_WORDS.test(t) ||
    /^(do|does|did|can|could|would|should|is|are|am|will|tell me|explain)\b/.test(t) ||
    /\bside effects?\b/.test(t);
  if (questionish) {
    return "I've noted that here for your care team. I'm best at recording your updates, and explaining your medicines and alerts.";
  }
  return '';
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const NUM = String.raw`(\d{1,3}(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)`;

function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  if (/^\d/.test(raw)) return Number(raw);
  return NUMBER_WORDS[raw.toLowerCase()];
}

function matchNumber(text: string, re: RegExp, min: number, max: number): number | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  // A pattern with alternatives can capture the number in any group, so try each.
  for (const group of m.slice(1)) {
    const v = toNumber(group);
    if (v !== undefined && v >= min && v <= max) return v;
  }
  return undefined;
}

/** Split a spoken sentence into clauses, so a summary quotes only the relevant part. */
function clauses(text: string): string[] {
  return text
    .split(/[.;!?]|\band\b|\bbut\b|,\s*(?=(?:and|then|also|i|we|my|the)\b)/i)
    .map(c => c.trim())
    .filter(Boolean);
}

/** The clause that matches `re`, or the whole sentence when nothing matches. */
function clauseFor(original: string, re: RegExp, max = 160): string {
  const parts = clauses(original);
  const hit = parts.find(p => re.test(p.toLowerCase()));
  return (hit ?? original).slice(0, max).trim();
}

/** Spoken body part to region code. Longer, more specific names are listed first. */
const REGION_WORDS: Array<[RegExp, string]> = [
  [/\b(forearms?|wrists?)\b/, 'forearm'],
  [/\b(hands?|fingers?|thumbs?)\b/, 'hand'],
  [/\b(shoulders?)\b/, 'shoulder'],
  [/\b(thighs?|quads?)\b/, 'thigh'],
  [/\b(knees?)\b/, 'knee'],
  [/\b(calves|calf|shins?)\b/, 'calf'],
  [/\b(feet|foot|toes?|ankles?|heels?)\b/, 'foot'],
  [/\b(hips?|groin)\b/, 'hip'],
  [/\b(chest|breast|sternum)\b/, 'chest'],
  [/\b(belly|abdomen|stomach|tummy)\b/, 'abdomen'],
  [/\b(back)\b/, 'back'],
  [/\b(neck|throat)\b/, 'neck'],
  [/\b(head|forehead)\b/, 'head'],
  [/\b(arms?|elbows?)\b/, 'arm'],
];

const CENTRE = new Set(CENTRE_REGIONS);

function findRegion(text: string, side: 'left' | 'right'): string | undefined {
  for (const [re, base] of REGION_WORDS) {
    if (!re.test(text)) continue;
    if (CENTRE.has(base)) return base;
    const letter = /\bleft\b/.test(text) ? 'l' : /\bright\b/.test(text) ? 'r' : side === 'left' ? 'l' : 'r';
    const face = /\b(back of|behind|posterior|rear)\b/.test(text) ? 'posterior' : 'anterior';
    return `${base}_${letter}_${face}`;
  }
  return undefined;
}

const SEVERITY_RE = new RegExp(
  String.raw`(?:${NUM}\s*(?:\/|out of|of)\s*(?:10|ten))|\b(?:pain|soreness|hurts?|severity|discomfort)\b[^.!?]{0,20}?\b${NUM}\b`,
  'i'
);

const BP_RE = /\b(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})\b/;

/** Best-effort interpretation used when Claude is unavailable or errors. */
export function parseVoiceLocally(transcript: string, ctx: VoiceContext): VoiceCandidate[] {
  const text = transcript.toLowerCase();
  const out: VoiceCandidate[] = [];

  // --- symptom -------------------------------------------------------------
  const severity = matchNumber(text, SEVERITY_RE, 0, 10);
  const region = findRegion(text, ctx.side);
  const swelling = /\b(swell(?:ing|ed)?|swollen|puffy|puffiness)\b/.test(text);
  const warmth = /\b(warm(?:th)?|hot to the touch|burning hot)\b/.test(text);
  const redness = /\b(red(?:ness)?|reddish)\b/.test(text);
  const chestPain = /\bchest pain\b/.test(text);
  const breathless = /\b(short(?:ness)? of breath|can'?t breathe|breathless|trouble breathing)\b/.test(text);
  if (region || severity !== undefined || chestPain || breathless) {
    const detail: VoiceDetail = {};
    if (region) detail.region = region;
    if (severity !== undefined) detail.severity = severity;
    if (swelling) detail.swelling = true;
    if (warmth) detail.warmth = true;
    if (redness) detail.redness = true;
    if (chestPain) detail.chestPain = true;
    if (breathless) detail.shortnessOfBreath = true;
    const feverC = spokenTemperature(text);
    if (feverC !== undefined) detail.bodyTempC = feverC;
    const name = region ? region.replace(/_/g, ' ') : 'symptom';
    out.push({
      kind: 'symptom',
      label: `Symptom: ${name}${severity !== undefined ? ` ${severity}/10` : ''}`,
      target: VOICE_TARGET_FOR.symptom,
      confidence: region && severity !== undefined ? 'high' : 'low',
      detail,
    });
  }

  // --- vitals --------------------------------------------------------------
  const vitals: VoiceDetail = {};
  const bp = BP_RE.exec(text);
  if (bp) {
    const systolic = Number(bp[1]);
    const diastolic = Number(bp[2]);
    if (systolic >= 60 && systolic <= 260 && diastolic >= 30 && diastolic <= 160 && systolic > diastolic) {
      vitals.systolic = systolic;
      vitals.diastolic = diastolic;
    }
  }
  const hr = matchNumber(text, /\b(?:heart rate|heartrate|pulse|hr)\b[^0-9]{0,15}(\d{2,3})\b/, 20, 250);
  if (hr !== undefined) vitals.hr = hr;
  const spo2 = matchNumber(text, /\b(?:oxygen|o2|sats?|saturation|spo2)\b[^0-9]{0,15}(\d{2,3})\b/, 50, 100);
  if (spo2 !== undefined) vitals.spo2 = spo2;
  const respRate = matchNumber(text, /\b(?:breaths?|breathing|respirations?|resp)\b[^0-9]{0,15}(\d{1,2})\b/, 4, 80);
  if (respRate !== undefined) vitals.respRate = respRate;
  const tempC = spokenTemperature(text);
  if (tempC !== undefined) vitals.tempC = tempC;
  const glucose = matchNumber(
    text,
    /\b(?:blood sugar|blood glucose|sugar|glucose)\b[^0-9]{0,15}(\d{2,4})\b/,
    10,
    900
  );
  if (glucose !== undefined) vitals.glucoseMgDl = glucose;
  if (Object.keys(vitals).length > 0) {
    const parts: string[] = [];
    if (vitals.systolic !== undefined) parts.push(`BP ${vitals.systolic}/${vitals.diastolic}`);
    if (vitals.hr !== undefined) parts.push(`HR ${vitals.hr}`);
    if (vitals.spo2 !== undefined) parts.push(`SpO2 ${vitals.spo2}%`);
    if (vitals.respRate !== undefined) parts.push(`resp ${vitals.respRate}`);
    if (vitals.tempC !== undefined) parts.push(`temp ${vitals.tempC}°C`);
    if (vitals.glucoseMgDl !== undefined) parts.push(`glucose ${vitals.glucoseMgDl} mg/dL`);
    out.push({
      kind: 'vitals',
      label: parts.join(' · '),
      target: VOICE_TARGET_FOR.vitals,
      confidence: 'high',
      detail: vitals,
    });
  }

  // --- dose ----------------------------------------------------------------
  const tookWord = /\b(took|taken|take|had|used)\b/.test(text);
  const skipWord = /\b(skipped|skip|missed|forgot|didn'?t take)\b/.test(text);
  if (tookWord || skipWord) {
    const med = matchKnownName(spokenName(text, ctx.medications), ctx.medications);
    if (med) {
      const detail: VoiceDetail = { medicationName: med, status: skipWord ? 'skipped' : 'taken' };
      if (glucose !== undefined) detail.glucoseMgDl = glucose;
      out.push({
        kind: 'dose',
        label: `${skipWord ? 'Skipped' : 'Took'} ${med}`,
        target: VOICE_TARGET_FOR.dose,
        confidence: 'high',
        detail,
      });
    }
  }

  // --- lab -----------------------------------------------------------------
  // Glucose is captured as a vital sign above, so skip glucose-style lab entries here.
  // Several labs can be read in one sentence, so keep going after a match, but never
  // let two different lab names claim the same spoken number.
  const spokenLabValues = new Set<number>();
  for (const lab of ctx.labs) {
    if (/\b(glucose|sugar|a1c)\b/.test(lab.toLowerCase())) continue;
    const word = distinctiveWord(lab);
    if (!word || !text.includes(word)) continue;
    const re = new RegExp(`${escapeRe(word)}[^0-9]{0,25}(\\d+(?:\\.\\d+)?)`);
    const value = matchNumber(text, re, -10_000, 100_000);
    if (value === undefined || spokenLabValues.has(value)) continue;
    spokenLabValues.add(value);
    out.push({
      kind: 'lab',
      label: `${lab} ${value}`,
      target: VOICE_TARGET_FOR.lab,
      confidence: 'medium',
      detail: { name: lab, value },
    });
  }

  // --- diet ----------------------------------------------------------------
  const ateWord =
    /\b(ate|eaten|eating|had (?:a |some )?(?:breakfast|lunch|dinner|snack)|breakfast|lunch|dinner|snack|meal)\b/.test(
      text
    );
  const drankWord = /\b(drank|drinking|drank|glass of|cup of|fluids?|water|juice|tea|coffee)\b/.test(text);
  const appetiteWord = /\b(appetite|not hungry|no appetite|nauseous|nausea)\b/.test(text);
  if (ateWord || drankWord || appetiteWord) {
    const amount = /\b(\d+(?:\.\d+)?\s*(?:cups?|glasses?|oz|ml|liters?|l|bowls?|plates?|slices?|servings?))\b/.exec(text);
    const when = /\b(breakfast|lunch|dinner|snack|morning|afternoon|evening|tonight|last night)\b/.exec(text);
    const summary = clauseFor(
      transcript,
      /\b(ate|eaten|eating|breakfast|lunch|dinner|snack|meal|drank|drinking|glass of|cup of|fluid|water|juice|tea|coffee|appetite|hungry|nauseous)\b/
    );
    out.push({
      kind: 'diet',
      label: `Diet: ${summary.slice(0, 90)}`,
      target: VOICE_TARGET_FOR.diet,
      confidence: 'medium',
      detail: {
        summary,
        ...(amount ? { amount: amount[1]! } : {}),
        ...(when ? { whenText: when[1]! } : {}),
      },
    });
  }

  // --- sleep ---------------------------------------------------------------
  const sleepWord = /\b(slept|sleep|sleeping|nap|napped|rest|rested|insomnia|trouble sleeping|woke up)\b/.test(text);
  if (sleepWord) {
    const hours = matchNumber(text, new RegExp(String.raw`\b${NUM}\s*(?:hours?|hrs?)\b`), 0, 24);
    const summary = clauseFor(
      transcript,
      /\b(slept|sleep|sleeping|nap|napped|rest|rested|insomnia|woke up)\b/
    );
    out.push({
      kind: 'sleep',
      label: `Sleep: ${summary.slice(0, 90)}`,
      target: VOICE_TARGET_FOR.sleep,
      confidence: 'medium',
      detail: {
        summary,
        ...(hours !== undefined ? { hours } : {}),
      },
    });
  }

  // --- exercise ------------------------------------------------------------
  const activityWord =
    /\b(ran|run|running|jog|jogged|jogging|walk(?:ed|ing)?|hike(?:d)?|hiking|cycl\w*|bik\w*|spin|swim\w*|swam|yoga|pilates|stretch(?:ed|ing)?|lift(?:ed|ing)?|weights?|strength|gym|workout|exercis\w*|train(?:ed|ing)?|danc(?:e|ed|ing)|soccer|basketball|football|tennis)\b/.exec(
      text
    );
  if (activityWord) {
    const activity = exerciseActivity(text);
    const minutes =
      matchNumber(text, new RegExp(String.raw`\b${NUM}\s*(?:minutes?|mins?)\b`), 1, 600) ??
      matchNumber(text, /\b(?:for|about)\s+(\d+)\b/, 1, 600);
    // A bare walk to the fridge is not a workout; easy movement only counts with a duration.
    if ((activity === 'Walk' || activity === 'Hike') && minutes === undefined) {
      // fall through without proposing
    } else {
      const intensity = /\b(easy|light|gentle|slow|leisure\w*)\b/.test(text)
        ? ('light' as const)
        : /\b(hard|tough|intense|vigorous|fast|all out)\b/.test(text)
          ? ('hard' as const)
          : ('moderate' as const);
      const day = /\b(?:mon|monday)s?\b/.test(text)
        ? 0
        : /\btues(?:day)?s?\b/.test(text)
          ? 1
          : /\bwed(?:nesday|nes)?s?\b/.test(text)
            ? 2
            : /\bthur(?:s(?:day)?)s?\b/.test(text)
              ? 3
              : /\bfri(?:day)?s?\b/.test(text)
                ? 4
                : /\bsatur(?:day)?s?\b/.test(text)
                  ? 5
                  : /\bsundays?\b/.test(text)
                    ? 6
                    : undefined;
      const planned =
        day !== undefined || /\b(schedul\w+|plan(?:s|ned|ning)?|every\s+\w+|each\s+\w+)\b/.test(text);
      const summary = clauseFor(
        transcript,
        /\b(ran|run|running|jog|walk|cycled|cycling|biked|swam|swimming|yoga|lifted|weights|gym|workout|exercis\w*|training|trained|stretched|stretching|danced|dancing|hiked|hiking)\b/
      );
      out.push({
        kind: 'exercise',
        label: `Exercise: ${summary.slice(0, 90)}`,
        target: VOICE_TARGET_FOR.exercise,
        confidence: minutes !== undefined || planned ? 'medium' : 'low',
        detail: {
          activity,
          intensity,
          status: planned ? 'planned' : 'done',
          ...(minutes !== undefined ? { minutes } : {}),
          ...(planned && day !== undefined ? { day } : {}),
        },
      });
    }
  }

  // --- history -------------------------------------------------------------
  // Deliberately narrow: "I had a salad" is a meal, not a medical history, so a bare
  // "I had ..." never counts. It takes clinical wording or a named condition.
  const historyHit =
    /\b(diagnosed with|history of|allergic to|allergy to|surger(?:y|ies)|surgical|operation|heart attack|stroke|cancer|diabetes|asthma|pneumonia|infection|blood clot|fracture|smokes?|drinks? alcohol|lives? with|retired|works? as)\b/.exec(
      text
    );
  if (historyHit) {
    const category = /\ballerg/.test(text)
      ? 'allergy'
      : /\b(surgery|surgical|operation|procedure)\b/.test(text)
        ? 'surgical'
        : /\b(mother|father|sister|brother|family)\b/.test(text)
          ? 'family'
          : /\b(smokes?|drinks?(?:\s+alcohol)?|lives? with|retired|works? as)\b/.test(text)
            ? 'social'
            : 'medical';
    const when = /\b(19\d{2}|20\d{2})\b/.exec(text)?.[1];
    const title = clauseFor(
      transcript,
      /\b(diagnosed with|history of|allergic to|allergy to|surgery|operation|heart attack|stroke|cancer|diabetes|asthma|pneumonia|infection|clot|fracture|smokes?|drinks?|lives? with|retired|works? as|mother|father|sister|brother)\b/i,
      120
    );
    out.push({
      kind: 'history',
      label: title,
      target: VOICE_TARGET_FOR.history,
      confidence: 'low',
      detail: { category, title, ...(when ? { whenText: when } : {}) },
    });
  }

  return out.slice(0, VOICE_MAX_ITEMS);
}

/** Spoken temperature in Celsius; values above 45 are treated as Fahrenheit. */
export function spokenTemperature(text: string): number | undefined {
  const m = new RegExp(
    String.raw`\b(?:temp(?:erature)?|fever)\b[^0-9]{0,15}(\d{2,3}(?:\.\d)?)`
  ).exec(text);
  const raw = m?.[1];
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  const celsius = value >= 45 ? ((value - 32) * 5) / 9 : value;
  if (celsius < 30 || celsius > 45) return undefined;
  return Math.round(celsius * 10) / 10;
}

/** Find the known name whose distinctive words appear in the spoken text. */
function spokenName(text: string, known: string[]): string | undefined {
  for (const name of known) {
    const words = name
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4);
    if (words.some(w => text.includes(w))) return name;
  }
  return undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
