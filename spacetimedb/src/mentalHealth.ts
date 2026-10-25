// Mental health monitoring shared by reducers, seeds, the client, and tests.
// Instruments are the standard PHQ-9 and GAD-7; bipolar mood uses a -3..+3 day scale.
// Thresholds are drafts pending clinician review (see DESIGN_SPEC.md 9.2).

import type { RuleHit } from './clinical';

export const MH_KINDS = ['mood', 'phq9', 'gad7'] as const;
export type MhKind = (typeof MH_KINDS)[number];

export const MH_KIND_LABEL: Record<MhKind, string> = {
  mood: 'Daily mood',
  phq9: 'PHQ-9 (depression)',
  gad7: 'GAD-7 (anxiety)',
};

export function isMhKind(v: string): v is MhKind {
  return (MH_KINDS as readonly string[]).includes(v);
}

/** Standard PHQ-9 items; item 9 asks about thoughts of self-harm. */
export const PHQ9_QUESTIONS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself, or that you are a failure or have let yourself or your family down',
  'Trouble concentrating on things, such as reading the paper or watching TV',
  'Moving or speaking so slowly that other people could have noticed, or the opposite, being fidgety or restless',
  'Thoughts that you would be better off dead, or of hurting yourself in some way',
] as const;

/** Standard GAD-7 items. */
export const GAD7_QUESTIONS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it is hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid, as if something awful might happen',
] as const;

/** Shared 0-3 answer options for both questionnaires. */
export const MH_OPTIONS = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'] as const;

export const MH_MAX_SCORE: Record<MhKind, number> = { mood: 3, phq9: 27, gad7: 21 };

/** Bipolar mood day scale, depression to mania. */
export const MOOD_SCALE: Array<{ value: number; label: string }> = [
  { value: -3, label: 'Very low' },
  { value: -2, label: 'Low' },
  { value: -1, label: 'A bit low' },
  { value: 0, label: 'Even' },
  { value: 1, label: 'A bit high' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Very high, energized' },
];

export type MhBand = '' | 'minimal' | 'mild' | 'moderate' | 'mod_severe' | 'severe';

export const MH_BAND_LABEL: Record<string, string> = {
  minimal: 'Minimal',
  mild: 'Mild',
  moderate: 'Moderate',
  mod_severe: 'Moderately severe',
  severe: 'Severe',
};

/** PHQ-9 severity band; 0-27. */
export function phq9Band(score: number): MhBand {
  if (score >= 20) return 'severe';
  if (score >= 15) return 'mod_severe';
  if (score >= 10) return 'moderate';
  if (score >= 5) return 'mild';
  return 'minimal';
}

/** GAD-7 severity band; 0-21. */
export function gad7Band(score: number): MhBand {
  if (score >= 15) return 'severe';
  if (score >= 10) return 'moderate';
  if (score >= 5) return 'mild';
  return 'minimal';
}

/** Display band for a stored check-in row. */
export function mhBand(kind: string, score: number): MhBand {
  if (kind === 'phq9') return phq9Band(score);
  if (kind === 'gad7') return gad7Band(score);
  return '';
}

export type MhEntryLike = {
  kind: string;
  /** mood: -3..3; phq9: 0..27; gad7: 0..21. */
  score: number;
  /** PHQ-9 item 9 (self-harm thoughts), 0..3; 0 for other kinds. */
  item9: number;
  /** Hours slept on a mood day; 0 when not answered. */
  sleepHours: number;
  notes: string;
};

/** True when the mood day suggests mania or activation: high mood with little sleep. */
export function isElevatedWithLittleSleep(score: number, sleepHours: number) {
  return score >= 2 && sleepHours > 0 && sleepHours <= 4;
}

/**
 * Red-flag rules for one new mental-health check-in. `recentMood` are the patient's
 * previous mood days, oldest first; a sustained run of high days with short sleep
 * flags possible activation even when no single day looks extreme.
 */
export function mhRules(
  entry: MhEntryLike,
  recentMood: Array<{ score: number; sleepHours: number }> = []
): RuleHit[] {
  const hits: RuleHit[] = [];
  const push = (code: string, priority: string) => {
    if (!hits.some(h => h.code === code)) hits.push({ code, priority });
  };

  if (entry.kind === 'phq9') {
    // Item 9 asks about thoughts of being better off dead or self-harm: contact now.
    if (entry.item9 > 0) push('SELF_HARM_RISK', 'emergency');
    if (entry.score >= 15) push('SEVERE_DEPRESSION', 'same_day');
  }
  if (entry.kind === 'gad7' && entry.score >= 15) {
    push('SEVERE_ANXIETY', 'same_day');
  }
  if (entry.kind === 'mood') {
    if (isElevatedWithLittleSleep(entry.score, entry.sleepHours)) push('MOOD_ELEVATION', 'same_day');
    if (entry.score <= -3) push('SEVERE_LOW_MOOD', 'same_day');
    // Three high days in a row with five hours of sleep or less.
    const window = [...recentMood, { score: entry.score, sleepHours: entry.sleepHours }];
    const last3 = window.slice(-3);
    if (
      last3.length === 3 &&
      last3.every(m => m.score >= 2 && m.sleepHours > 0 && m.sleepHours <= 5)
    ) {
      push('MOOD_ELEVATION', 'same_day');
    }
  }
  if (isCrisisNote(entry.notes)) push('CRISIS_LANGUAGE', 'emergency');
  return hits;
}

/**
 * Wording that always means a crisis, checked against any free-text note. Deliberately
 * narrow so ordinary phrasing ("this headache is killing me") does not fire.
 */
const CRISIS_PHRASES = [
  'kill myself',
  'killing myself',
  'end my life',
  'ending it all',
  'want to die',
  'wish i was dead',
  'better off dead',
  'no reason to live',
  'not want to be here anymore',
  "don't want to be here",
  'dont want to be here',
  'hurt myself',
  'self-harm',
  'self harm',
  'suicid',
  'overdose',
];

export function isCrisisNote(text: string): boolean {
  const t = text.toLowerCase();
  return CRISIS_PHRASES.some(p => t.includes(p));
}

/**
 * Crisis resources pushed to the patient (and echoed to the nurse) whenever a
 * crisis-level flag fires. US national lines; a real deployment would localize.
 */
export const CRISIS_LINES: Array<{ label: string; detail: string }> = [
  { label: '988 Suicide & Crisis Lifeline', detail: 'Call or text 988 — free, confidential, 24/7' },
  { label: 'Crisis Text Line', detail: 'Text HOME to 741741' },
  { label: 'SAMHSA National Helpline', detail: '1-800-662-4357 — treatment referral, 24/7' },
  { label: 'Emergency', detail: 'Call 911 if you think you may act on thoughts of harming yourself' },
];

/** Reason codes that mark a mental-health crisis on an alert. */
export const MH_CRISIS_CODES = ['SELF_HARM_RISK', 'CRISIS_LANGUAGE'];
