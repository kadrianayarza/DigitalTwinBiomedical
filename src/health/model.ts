import { FLOW_LABEL, METRIC, MOOD_LABEL, type MetricDef } from '../../spacetimedb/src/health';
import type { TwinData } from '../lib/data';
import { tsMs } from '../lib/format';

export const DAY_MS = 86_400_000;

export type Sample = {
  id: bigint;
  metric: string;
  value: number;
  label: string;
  /** Start time, ms. */
  at: number;
  source: string;
  device: string;
};

export type DayValue = { day: number; value: number | null; lo?: number; hi?: number; n: number };

/** One patient's samples, oldest first, grouped by metric. */
export function healthFor(data: TwinData, patientId: bigint) {
  const byMetric = new Map<string, Sample[]>();
  for (const s of data.healthSamples) {
    if (s.patientId !== patientId) continue;
    const row: Sample = { id: s.id, metric: s.metric, value: s.value, label: s.label, at: tsMs(s.startAt), source: s.source, device: s.device };
    const list = byMetric.get(s.metric);
    if (list) list.push(row);
    else byMetric.set(s.metric, [row]);
  }
  for (const list of byMetric.values()) list.sort((a, b) => a.at - b.at);
  const devices = data.healthDevices.filter(d => d.patientId === patientId).sort((a, b) => (a.id < b.id ? -1 : 1));
  const medications = data.medications.filter(m => m.patientId === patientId).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { byMetric, devices, medications, get: (m: string) => byMetric.get(m) ?? [] };
}
export type PatientHealth = ReturnType<typeof healthFor>;

export function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Combine one day's samples. Totals take the single source with the most, so a watch and phone don't double count. */
export function rollup(m: MetricDef, xs: Sample[], day: number): DayValue {
  if (xs.length === 0) return { day, value: null, n: 0 };
  const values = xs.map(s => s.value);
  if (m.agg === 'sum') {
    const byDevice = new Map<string, number>();
    for (const s of xs) byDevice.set(s.device, (byDevice.get(s.device) ?? 0) + s.value);
    return { day, value: Math.max(...byDevice.values()), n: xs.length };
  }
  if (m.agg === 'count') return { day, value: xs.length, n: xs.length };
  if (m.agg === 'latest') return { day, value: values[values.length - 1]!, n: xs.length };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (m.agg === 'range') return { day, value: mean, lo: Math.min(...values), hi: Math.max(...values), n: xs.length };
  return { day, value: mean, n: xs.length };
}

/** `days` daily values ending today, oldest first. */
export function dailySeries(m: MetricDef, samples: Sample[], days: number, now = Date.now()): DayValue[] {
  const today = startOfDay(now);
  const first = today - (days - 1) * DAY_MS;
  const buckets = new Map<number, Sample[]>();
  for (const s of samples) {
    if (s.at < first) continue;
    const day = startOfDay(s.at);
    const list = buckets.get(day);
    if (list) list.push(s);
    else buckets.set(day, [s]);
  }
  const out: DayValue[] = [];
  for (let i = 0; i < days; i++) {
    const day = startOfDay(first + i * DAY_MS + DAY_MS / 2);
    out.push(rollup(m, buckets.get(day) ?? [], day));
  }
  return out;
}

/** Hourly values for one day (the D view). */
export function hourlySeries(m: MetricDef, samples: Sample[], day: number): DayValue[] {
  const out: DayValue[] = [];
  for (let h = 0; h < 24; h++) {
    const from = day + h * 3_600_000;
    out.push(rollup(m, samples.filter(s => s.at >= from && s.at < from + 3_600_000), from));
  }
  return out;
}

export const meanOf = (xs: DayValue[]) => {
  const vs = xs.map(x => x.value).filter((v): v is number => v !== null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
};

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Units shown to the user: US customary where the catalog defines one. */
export const showUnit = (m: MetricDef) => m.display?.unit ?? m.unit;
export const toShown = (m: MetricDef, v: number) => (m.display ? v * m.display.factor + (m.display.offset ?? 0) : v);
export const fromShown = (m: MetricDef, v: number) => (m.display ? (v - (m.display.offset ?? 0)) / m.display.factor : v);
const shownDigits = (m: MetricDef) => m.display?.digits ?? m.digits;

export function num(v: number, digits: number) {
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits > 0 && Math.abs(v) < 100 ? Math.min(1, digits) : 0 });
}

export function hoursMinutes(hours: number) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const min = total % 60;
  return h ? `${h} hr ${min} min` : `${min} min`;
}

/** Value text without unit, in the shown unit. */
export function fmtValue(m: MetricDef, v: number) {
  if (m.id === 'mood') return MOOD_LABEL[Math.round(v)] ?? num(v, 1);
  if (m.id === 'menstrual_flow') return FLOW_LABEL[Math.round(v)] ?? '';
  if (m.category === 'sleep') return hoursMinutes(v);
  return num(toShown(m, v), shownDigits(m));
}

/** Unit to print after `fmtValue`, or '' when the text already says it. */
export function fmtUnit(m: MetricDef) {
  if (m.id === 'mood' || m.id === 'menstrual_flow' || m.category === 'sleep') return '';
  return showUnit(m);
}

export function whenText(ms: number, now = Date.now()) {
  const d = new Date(ms);
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return time;
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export type Headline = { value: string; unit: string; when: string; at: number };

/** What a summary card shows: today's total for totals, otherwise the latest reading. */
export function headline(h: PatientHealth, m: MetricDef, now = Date.now()): Headline | null {
  const xs = h.get(m.id);
  const last = xs[xs.length - 1];
  if (!last) return null;
  if (m.id === 'bp_systolic') {
    const dia = h.get('bp_diastolic').filter(s => Math.abs(s.at - last.at) < 60_000).pop();
    return { value: `${Math.round(last.value)}/${dia ? Math.round(dia.value) : '–'}`, unit: 'mmHg', when: whenText(last.at, now), at: last.at };
  }
  if (m.id === 'medication') {
    const day = startOfDay(last.at);
    const taken = xs.filter(s => startOfDay(s.at) === day && s.value > 0).length;
    return { value: String(taken), unit: taken === 1 ? 'dose taken' : 'doses taken', when: day === startOfDay(now) ? 'Today' : whenText(last.at, now), at: last.at };
  }
  if (m.agg === 'sum' || m.agg === 'count') {
    const day = startOfDay(last.at);
    const v = rollup(m, xs.filter(s => startOfDay(s.at) === day), day).value ?? 0;
    return { value: fmtValue(m, v), unit: fmtUnit(m), when: day === startOfDay(now) ? 'Today' : whenText(last.at, now), at: last.at };
  }
  return { value: fmtValue(m, last.value), unit: fmtUnit(m), when: whenText(last.at, now), at: last.at };
}

// ---------------------------------------------------------------------------
// Highlights: last 7 days vs the 3 weeks before
// ---------------------------------------------------------------------------

const HIGHLIGHT_METRICS = [
  'steps', 'wheelchair_pushes', 'resting_heart_rate', 'sleep_asleep', 'hrv', 'walking_speed', 'walking_asymmetry', 'weight',
  'respiratory_rate', 'blood_oxygen', 'blood_glucose', 'bp_systolic', 'active_energy', 'exercise_minutes', 'headphone_audio',
];

/** How a daily total reads after its value ("3,200 steps", "22 min of exercise"). */
const SUM_PHRASE: Record<string, string> = {
  steps: '',
  wheelchair_pushes: '',
  exercise_minutes: 'of exercise',
  active_energy: 'of active energy',
  sleep_asleep: 'asleep',
};

export type Highlight = { metric: MetricDef; text: string; up: boolean; recent: DayValue[]; change: number };

export function highlights(h: PatientHealth, now = Date.now()): Highlight[] {
  const out: Highlight[] = [];
  for (const id of HIGHLIGHT_METRICS) {
    const m = METRIC[id]!;
    const xs = h.get(id);
    if (xs.length < 6) continue;
    const series = dailySeries(m, xs, 28, now);
    // Today's totals are partial; compare whole days.
    const whole = m.agg === 'sum' ? series.slice(0, -1) : series;
    const recent = meanOf(whole.slice(-7));
    const prior = meanOf(whole.slice(0, -7));
    if (recent === null || prior === null || prior === 0) continue;
    const change = (recent - prior) / Math.abs(prior);
    const threshold = id === 'weight' ? 0.012 : id === 'blood_oxygen' ? 0.01 : 0.08;
    if (Math.abs(change) < threshold) continue;
    const up = recent > prior;
    const unit = fmtUnit(m) ? ` ${fmtUnit(m)}` : '';
    const what = SUM_PHRASE[id] ?? `of ${m.label.toLowerCase()}`;
    const text =
      m.agg === 'sum'
        ? `You averaged ${fmtValue(m, recent)}${unit}${what ? ` ${what}` : ''} ${id === 'sleep_asleep' ? 'a night' : 'a day'} over the last 7 days, ${up ? 'more' : 'less'} than the ${fmtValue(m, prior)}${unit} before.`
        : `Your ${m.label.toLowerCase()} averaged ${fmtValue(m, recent)}${unit} over the last 7 days, ${up ? 'up' : 'down'} from ${fmtValue(m, prior)}${unit}.`;
    out.push({ metric: m, text, up, recent: series.slice(-14), change });
  }
  return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 4);
}

// ---------------------------------------------------------------------------
// Activity rings
// ---------------------------------------------------------------------------

export const RING_GOALS = { move: 300, exercise: 30, stand: 12 };

export function rings(h: PatientHealth, day: number) {
  const total = (id: string) => rollup(METRIC[id]!, h.get(id).filter(s => startOfDay(s.at) === day), day).value ?? 0;
  return {
    move: total('active_energy'),
    exercise: total('exercise_minutes'),
    stand: total('stand_hours'),
  };
}

// ---------------------------------------------------------------------------
// Cycle tracking
// ---------------------------------------------------------------------------

export function cycle(h: PatientHealth, now = Date.now()) {
  const days = [...new Set(h.get('menstrual_flow').filter(s => s.value > 0).map(s => startOfDay(s.at)))].sort((a, b) => a - b);
  const periods: Array<{ start: number; end: number }> = [];
  for (const d of days) {
    const last = periods[periods.length - 1];
    if (last && d - last.end <= 2 * DAY_MS) last.end = d;
    else periods.push({ start: d, end: d });
  }
  if (periods.length === 0) return null;
  const starts = periods.map(p => p.start);
  const gaps = starts.slice(1).map((s, i) => Math.round((s - starts[i]!) / DAY_MS));
  const cycleLength = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 28;
  const periodLength = Math.round(periods.reduce((a, p) => a + (p.end - p.start) / DAY_MS + 1, 0) / periods.length);
  const last = periods[periods.length - 1]!;
  let next = last.start + cycleLength * DAY_MS;
  while (next < startOfDay(now)) next += cycleLength * DAY_MS;
  return {
    periods,
    cycleLength,
    periodLength,
    next,
    daysUntil: Math.round((next - startOfDay(now)) / DAY_MS),
    cycleDay: Math.round((startOfDay(now) - last.start) / DAY_MS) + 1,
  };
}

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

export const SCHEDULES = ['Once daily', 'Twice daily', 'Three times daily', 'As needed'] as const;
export const DOSES_PER_DAY: Record<string, number> = { 'Once daily': 1, 'Twice daily': 2, 'Three times daily': 3, 'As needed': 0 };

export function medicationLog(h: PatientHealth, name: string, now = Date.now()) {
  const xs = h.get('medication').filter(s => s.label === name);
  const today = xs.filter(s => startOfDay(s.at) === startOfDay(now));
  const week = xs.filter(s => now - s.at < 7 * DAY_MS);
  return {
    today,
    taken7: week.filter(s => s.value > 0).length,
    skipped7: week.filter(s => s.value === 0).length,
    last: xs[xs.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Pinned metrics (per patient, on this device)
// ---------------------------------------------------------------------------

export function defaultPins(procedure: string): string[] {
  const p = procedure.toLowerCase();
  const moving = /wheelchair/.test(p) ? 'wheelchair_pushes' : 'steps';
  const extra =
    /knee|hip/.test(p) ? ['walking_asymmetry', 'walking_speed']
    : /heart failure/.test(p) ? ['weight', 'bp_systolic', 'sodium']
    : /diabet/.test(p) ? ['blood_glucose', 'carbohydrates']
    : /copd|pulmon/.test(p) ? ['blood_oxygen', 'respiratory_rate', 'six_minute_walk']
    : /concussion/.test(p) ? ['hrv', 'headphone_audio']
    : /wheelchair/.test(p) ? ['bp_systolic', 'water']
    : [];
  return [...extra, moving, 'resting_heart_rate', 'sleep_asleep', 'medication'];
}

const pinKey = (patientId: bigint) => `twin-health-pins:${patientId}`;

export function loadPins(patientId: bigint, procedure: string): string[] {
  try {
    const raw = localStorage.getItem(pinKey(patientId));
    if (raw) return (JSON.parse(raw) as string[]).filter(id => METRIC[id]);
  } catch {
    // fall through to defaults
  }
  return defaultPins(procedure);
}

export function savePins(patientId: bigint, pins: string[]) {
  try {
    localStorage.setItem(pinKey(patientId), JSON.stringify(pins));
  } catch {
    // storage full or blocked; pins stay for this session
  }
}
