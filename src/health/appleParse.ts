// Streaming parser for the Apple Health export (export.xml). Raw readings are reduced on the fly
// to what the Health view charts: daily totals, daily or hourly averages, hourly heart rate
// ranges, sleep stages per night and individual events, grouped by the app or device that wrote them.

import { METRICS, type MetricDef } from '../../spacetimedb/src/health.ts';

export type ImportSample = { metric: string; value: number; label: string; start: number; end: number };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const BY_TYPE = new Map<string, MetricDef>();
for (const m of METRICS) for (const type of m.apple ?? []) BY_TYPE.set(type, m);

/** Readings kept per hour (with their own time) rather than averaged per day. */
const HOURLY = new Set(['bp_systolic', 'bp_diastolic', 'blood_glucose', 'body_temperature']);

const FLOW: Record<string, number> = { None: 0, Unspecified: 2, Light: 2, Medium: 3, Heavy: 4 };

/** Apple's "2024-01-15 08:23:11 -0800" as epoch ms. */
export function appleDate(s: string) {
  if (s.length < 25) return Date.parse(s);
  return Date.parse(`${s.slice(0, 10)}T${s.slice(11, 19)}${s.slice(20, 23)}:${s.slice(23, 25)}`);
}

function localDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Converts an Apple unit to the catalog's canonical unit; null when the unit is unknown. */
export function convert(target: string, value: number, unit: string): number | null {
  const u = unit.trim();
  switch (target) {
    case 'km':
      return u === 'km' ? value : u === 'mi' ? value * 1.609344 : u === 'm' ? value / 1000 : u === 'ft' ? value * 0.0003048 : null;
    case 'kcal':
      return u === 'kcal' || u === 'Cal' ? value : u === 'kJ' ? value * 0.239006 : null;
    case 'kg':
      return u === 'kg' ? value : u === 'lb' ? value * 0.45359237 : u === 'g' ? value / 1000 : u === 'st' ? value * 6.35029 : null;
    case 'cm':
      return u === 'cm' ? value : u === 'm' ? value * 100 : u === 'in' ? value * 2.54 : u === 'ft' ? value * 30.48 : u === 'mm' ? value / 10 : null;
    case 'm':
      return u === 'm' ? value : u === 'ft' ? value * 0.3048 : u === 'km' ? value * 1000 : u === 'yd' ? value * 0.9144 : null;
    case '°C':
      return u === 'degC' ? value : u === 'degF' ? (value - 32) / 1.8 : null;
    case 'km/h':
      return u === 'km/hr' ? value : u === 'mi/hr' ? value * 1.609344 : u === 'm/s' ? value * 3.6 : null;
    case '%':
      return value <= 1 ? value * 100 : value;
    case 'mL':
      return u === 'mL' ? value : u === 'L' ? value * 1000 : u === 'fl_oz_us' ? value * 29.5735 : u === 'cup_us' ? value * 236.588 : null;
    case 'mg/dL':
      return u === 'mg/dL' ? value : u.startsWith('mmol') ? value * 18.0156 : null;
    case 'g':
      return u === 'g' ? value : u === 'mg' ? value / 1000 : u === 'oz' ? value * 28.3495 : null;
    case 'mg':
      return u === 'mg' ? value : u === 'g' ? value * 1000 : u === 'mcg' ? value / 1000 : null;
    case 'min':
      return u === 'min' ? value : u === 'hr' ? value * 60 : u === 's' ? value / 60 : null;
    default:
      return value;
  }
}

/** "HKWorkoutActivityTypeTraditionalStrengthTraining" -> "Traditional strength training". */
function workoutName(type: string) {
  const words = type.replace(/^HKWorkoutActivityType/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Acc = { sum: number; n: number; lo: number; hi: number; last: number; lastAt: number };
type Night = { deep: number; core: number; rem: number; asleep: number; awake: number; end: number };

export function createAppleParser(sinceMs: number) {
  let buf = '';
  let records = 0;
  const acc = new Map<string, Acc>(); // source \0 metric \0 bucket start \0 bucket length
  const nights = new Map<string, Night>(); // source \0 night (wake day)
  const singles = new Map<string, ImportSample[]>();
  const types = new Set<string>();
  const hrHourlyFrom = Date.now() - 7 * DAY;

  const single = (source: string, s: ImportSample) => {
    const list = singles.get(source);
    if (list) list.push(s);
    else singles.set(source, [s]);
  };

  const add = (source: string, m: MetricDef, hourly: boolean, value: number, start: number, at: number) => {
    const bucket = hourly ? Math.floor(start / HOUR) * HOUR : localDay(start);
    const key = `${source}\0${m.id}\0${bucket}\0${hourly ? HOUR : DAY}`;
    const a = acc.get(key);
    if (!a) acc.set(key, { sum: value, n: 1, lo: value, hi: value, last: value, lastAt: at });
    else {
      a.sum += value;
      a.n++;
      a.lo = Math.min(a.lo, value);
      a.hi = Math.max(a.hi, value);
      if (at >= a.lastAt) {
        a.last = value;
        a.lastAt = at;
      }
    }
  };

  const attrs = (raw: string) => {
    const out: Record<string, string> = {};
    for (const m of raw.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]!] = m[2]!;
    return out;
  };

  const sleep = (source: string, value: string, start: number, end: number) => {
    const key = `${source}\0${localDay(end + 6 * HOUR)}`;
    const n = nights.get(key) ?? { deep: 0, core: 0, rem: 0, asleep: 0, awake: 0, end: 0 };
    const h = (end - start) / HOUR;
    const stage = value.replace('HKCategoryValueSleepAnalysis', '');
    if (stage === 'InBed') return;
    if (stage === 'Awake') n.awake += h;
    else {
      n.asleep += h;
      if (stage === 'AsleepDeep') n.deep += h;
      else if (stage === 'AsleepREM') n.rem += h;
      else if (stage === 'AsleepCore') n.core += h;
    }
    n.end = Math.max(n.end, end);
    nights.set(key, n);
  };

  const record = (a: Record<string, string>) => {
    const type = a.type ?? '';
    const start = appleDate(a.startDate ?? '');
    const end = appleDate(a.endDate ?? a.startDate ?? '');
    if (!Number.isFinite(start) || start < sinceMs) return;
    const source = (a.sourceName ?? 'Apple Health').trim();
    records++;

    if (type === 'HKCategoryTypeIdentifierSleepAnalysis') return sleep(source, a.value ?? '', start, end);
    if (type === 'HKCategoryTypeIdentifierIntermenstrualBleeding') {
      return single(source, { metric: 'menstrual_flow', value: 1, label: '', start, end });
    }
    const m = BY_TYPE.get(type);
    if (!m) return;
    types.add(m.id);

    let value: number | null;
    if (type.startsWith('HKCategoryTypeIdentifier')) {
      const v = a.value ?? '';
      if (m.id === 'menstrual_flow') value = FLOW[v.replace('HKCategoryValueMenstrualFlow', '')] ?? 2;
      else if (m.id === 'stand_hours') value = v.endsWith('Stood') ? 1 : null;
      else if (m.id === 'mindful_minutes') value = (end - start) / 60_000;
      else value = 1;
    } else {
      const raw = parseFloat(a.value ?? '');
      value = Number.isFinite(raw) ? convert(m.unit, raw, a.unit ?? '') : null;
    }
    if (value === null || !Number.isFinite(value) || value < m.min || value > m.max) return;

    if (m.agg === 'count' || m.id === 'menstrual_flow') return single(source, { metric: m.id, value, label: '', start, end });
    if (m.agg === 'sum') return add(source, m, false, value, start, end);
    if (m.agg === 'range') return add(source, m, start >= hrHourlyFrom, value, start, start);
    return add(source, m, HOURLY.has(m.id), value, start, start);
  };

  const workout = (a: Record<string, string>) => {
    const start = appleDate(a.startDate ?? '');
    const end = appleDate(a.endDate ?? '');
    if (!Number.isFinite(start) || start < sinceMs) return;
    const minutes = convert('min', parseFloat(a.duration ?? ''), a.durationUnit ?? 'min') ?? (end - start) / 60_000;
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    records++;
    types.add('workouts');
    single((a.sourceName ?? 'Apple Health').trim(), {
      metric: 'workouts',
      value: Math.min(1440, minutes),
      label: workoutName(a.workoutActivityType ?? ''),
      start,
      end,
    });
  };

  // Attribute values can contain '>' (Apple writes glucose as unit="mmol<180.15588...>/L").
  const TAG = /<(Record|Workout)\s((?:[^>"]|"[^"]*")*)>/g;
  const scan = (chunk: string) => {
    for (const m of chunk.matchAll(TAG)) {
      const a = attrs(m[2]!);
      if (m[1] === 'Workout') workout(a);
      else record(a);
    }
  };

  return {
    /** Feed decoded text in any chunk size; complete lines are parsed, since each opening tag sits on one line. */
    feed(text: string) {
      buf += text;
      const cut = buf.lastIndexOf('\n');
      if (cut < 0) return;
      scan(buf.slice(0, cut + 1));
      buf = buf.slice(cut + 1);
    },
    get records() {
      return records;
    },
    /** Readings grouped by source app or device. */
    finish(): Map<string, ImportSample[]> {
      scan(buf);
      buf = '';
      const out = new Map(singles);
      const push = (source: string, s: ImportSample) => {
        const list = out.get(source);
        if (list) list.push(s);
        else out.set(source, [s]);
      };
      const byId = new Map(METRICS.map(m => [m.id, m]));
      for (const [key, a] of acc) {
        const [source, metric, bucketRaw, spanRaw] = key.split('\0') as [string, string, string, string];
        const m = byId.get(metric)!;
        const bucket = Number(bucketRaw);
        const span = Number(spanRaw);
        const end = bucket + span;
        if (m.agg === 'sum') push(source, { metric, value: a.sum, label: '', start: bucket, end });
        else if (m.agg === 'range') {
          push(source, { metric, value: a.lo, label: 'Low', start: bucket, end });
          if (a.hi !== a.lo) push(source, { metric, value: a.hi, label: 'High', start: bucket, end });
        } else if (m.agg === 'latest') push(source, { metric, value: a.last, label: '', start: a.lastAt, end: a.lastAt });
        else push(source, { metric, value: a.sum / a.n, label: '', start: span === HOUR ? bucket : a.lastAt, end: span === HOUR ? end : a.lastAt });
      }
      for (const [key, n] of nights) {
        const source = key.split('\0')[0]!;
        const at = n.end;
        const stage = (metric: string, value: number) => {
          if (value > 0.01) push(source, { metric, value: Math.min(24, value), label: '', start: at, end: at });
        };
        stage('sleep_asleep', n.asleep);
        stage('sleep_deep', n.deep);
        stage('sleep_core', n.core);
        stage('sleep_rem', n.rem);
        stage('sleep_awake', n.awake);
      }
      return out;
    },
    metricsSeen: () => [...types],
  };
}

/** Best guess at which kind of device an Apple Health source is. */
export function appleSourceKind(name: string) {
  if (/watch/i.test(name)) return 'apple_watch';
  if (/iphone/i.test(name)) return 'iphone';
  if (/withings|renpho|eufy|scale|fitindex|qardio ?base/i.test(name)) return 'smart_scale';
  if (/omron|qardio|blood pressure|bp/i.test(name)) return 'bp_cuff';
  if (/dexcom|libre|glucose|one ?drop|contour|accu-?chek/i.test(name)) return 'glucose_monitor';
  if (/fitbit/i.test(name)) return 'fitbit';
  return 'app';
}
