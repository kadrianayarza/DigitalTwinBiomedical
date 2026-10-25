import type { Timestamp } from 'spacetimedb';

export const tsMs = (t: Timestamp) => Number(t.microsSinceUnixEpoch / 1000n);

export function daysSince(t: Timestamp, now = Date.now()) {
  return Math.max(0, Math.floor((now - tsMs(t)) / 86_400_000));
}

const SIDED_CARE = /knee|hip|shoulder/i;

/** What the patient is being followed for, with the body side when the condition has one. */
export function careLabel(p: { procedure: string; side: string }) {
  if (!SIDED_CARE.test(p.procedure)) return p.procedure;
  const side = p.side === 'left' ? 'Left' : 'Right';
  const condition = p.procedure.replace(/^total\s+/i, '');
  return `${side} ${condition.charAt(0).toLowerCase()}${condition.slice(1)}`;
}

/** Wheelchair users get a seated twin; mirrors spacetimedb/src/clinical.ts. */
export const usesWheelchair = (p: { procedure: string }) => /wheelchair/i.test(p.procedure);

export const isSurgical = (p: { procedure: string }) => /replacement|repair|surgery|ectomy|otomy/i.test(p.procedure);

export function timeAgo(t: Timestamp, now = Date.now()) {
  const s = Math.max(0, Math.round((now - tsMs(t)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function clock(t: Timestamp) {
  const d = new Date(tsMs(t));
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

export function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  return `${(m / 60).toFixed(1)} h`;
}

export const PRIORITY_LABEL: Record<string, string> = {
  emergency: 'Emergency',
  same_day: 'Same day',
  review_24h: 'Review in 24 h',
  routine: 'Routine',
};

export const REASON_LABEL: Record<string, string> = {
  PE_SIGNS: 'Chest pain or shortness of breath',
  LOW_SPO2: 'SpO₂ below 92%',
  DVT_SIGNS: 'Calf pain with swelling/warmth (surgical side)',
  INFECTION_SIGNS: 'Fever or incision redness + warmth',
  PAIN_UNCONTROLLED: 'Pain ≥ 8 twice in a row',
  TACHYCARDIA: 'Heart rate > 100',
  FEVER: 'Temperature ≥ 38.0 °C',
  TACHYPNEA: 'Respiratory rate > 24',
  HYPOTENSION: 'Systolic BP < 90',
  HYPERTENSION: 'Systolic BP ≥ 180',
};

export const SCENARIO_LABEL: Record<string, string> = {
  normal: 'Stable',
  dvt: 'Blood clot pattern',
  infection: 'Infection pattern',
  fluid: 'Fluid overload pattern',
};
