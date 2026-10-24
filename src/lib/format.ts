import type { Timestamp } from 'spacetimedb';

export const tsMs = (t: Timestamp) => Number(t.microsSinceUnixEpoch / 1000n);

export function daysSince(t: Timestamp, now = Date.now()) {
  return Math.max(0, Math.floor((now - tsMs(t)) / 86_400_000));
}

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
  return new Date(tsMs(t)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  CALF_WARMTH: 'Calf skin temp rising',
  INFECTION_SIGNS: 'Fever or incision redness + warmth',
  INCISION_WARMTH: 'Incision skin temp +1.5 °C',
  PAIN_UNCONTROLLED: 'Pain ≥ 8 twice in a row',
  TACHYCARDIA: 'Heart rate > 100',
  ROM_STALLED: 'Knee flexion not progressing',
};

export const SCENARIO_LABEL: Record<string, string> = {
  normal: 'Normal recovery',
  dvt: 'Blood clot pattern',
  infection: 'Infection pattern',
  stalled: 'Stalled range of motion',
};
