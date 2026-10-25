// Google Health API (the successor to the Fitbit Web API and Google Fit) for Fitbit and Pixel Watch
// data: OAuth URLs, request bodies, and tolerant normalization of responses into catalog readings.
// Pure functions only; the network calls live in googleHealthProxy.ts.

import { METRICS, type MetricDef } from './spacetimedb/src/health.ts';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_HEALTH_BASE = 'https://health.googleapis.com/v4/users/me';

export const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
  'https://www.googleapis.com/auth/googlehealth.irn.readonly',
];

export type GoogleSample = { metric: string; value: number; label: string; start: number; end: number };

export const GOOGLE_METRICS: MetricDef[] = METRICS.filter(m => m.google);

export function authUrl(opts: { clientId: string; redirectUri: string; state: string }) {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: GOOGLE_HEALTH_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state: opts.state,
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

const civil = (d: Date) => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });

/** Body for POST .../dataPoints:dailyRollUp covering the last `days` days, one window per day. */
export function rollupBody(days: number, now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  const end = new Date(now);
  end.setDate(end.getDate() + 1);
  return { range: { start: { date: civil(start), time: {} }, end: { date: civil(end), time: {} } }, windowSizeDays: 1 };
}

type Leaf = { path: string; value: number };

/** Every numeric field in a data point with its dotted path. Numeric strings (int64 in JSON) count. */
export function numericLeaves(obj: unknown, path = ''): Leaf[] {
  if (obj === null || obj === undefined) return [];
  if (typeof obj === 'number') return Number.isFinite(obj) ? [{ path, value: obj }] : [];
  if (typeof obj === 'string') return /^-?\d+(\.\d+)?$/.test(obj) ? [{ path, value: Number(obj) }] : [];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => numericLeaves(v, `${path}[${i}]`));
  if (typeof obj === 'object') {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => numericLeaves(v, path ? `${path}.${k}` : k));
  }
  return [];
}

const TIME_PATH = /(time|date|year|month|day|hours|minutes|seconds|nanos|offset|utc|zone)$/i;

/** Start time of a data point in ms, whatever shape the time comes in. */
export function pointTime(p: unknown): number | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  for (const key of ['civilStartTime', 'startTime', 'sampleTime', 'civilTime', 'time', 'date', 'interval', 'startDate']) {
    const v = o[key];
    const t = timeOf(v);
    if (t !== null) return t;
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const t = pointTime(v);
      if (t !== null) return t;
    }
  }
  return null;
}

function timeOf(v: unknown): number | null {
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.startTime === 'string') return timeOf(o.startTime);
  if (typeof o.physicalTime === 'string') return timeOf(o.physicalTime);
  const date = (o.date ?? o) as Record<string, unknown>;
  if (typeof date.year === 'number' && typeof date.month === 'number') {
    const time = (o.time ?? {}) as Record<string, number>;
    return new Date(date.year, date.month - 1, (date.day as number) ?? 1, time.hours ?? 0, time.minutes ?? 0).getTime();
  }
  return null;
}

/** Converts a Google field to the catalog unit using the unit spelled in its name. */
export function scaleByPath(m: MetricDef, path: string, v: number) {
  const p = path.toLowerCase();
  switch (m.unit) {
    case 'km':
      return p.includes('millimeter') ? v / 1e6 : p.includes('kilometer') ? v : p.includes('mile') ? v * 1.609344 : p.includes('meter') ? v / 1000 : v;
    case 'kg':
      return p.includes('kilogram') ? v : p.includes('gram') ? v / 1000 : p.includes('pound') ? v * 0.45359237 : v;
    case 'mL':
      return p.includes('milliliter') ? v : p.includes('liter') ? v * 1000 : v;
    case '°C':
      return p.includes('fahrenheit') ? (v - 32) / 1.8 : v;
    case 'mg/dL':
      return p.includes('mmol') ? v * 18.0156 : v;
    case '%':
      return v <= 1 ? v * 100 : v;
    case 'hr':
      return p.includes('minute') ? v / 60 : p.includes('millis') ? v / 3_600_000 : p.includes('second') ? v / 3600 : v;
    default:
      return v;
  }
}

function pickValue(m: MetricDef, point: unknown): number | null {
  const leaves = numericLeaves(point).filter(l => !TIME_PATH.test(l.path.split('.').pop() ?? ''));
  const pick = m.google!.pick;
  const hit = leaves.find(l => pick.test(l.path.split('.').pop() ?? '')) ?? leaves.find(l => pick.test(l.path)) ?? leaves[0];
  if (!hit) return null;
  const v = scaleByPath(m, hit.path, hit.value);
  return Number.isFinite(v) && v >= m.min && v <= m.max ? v : null;
}

const DAY = 86_400_000;

/** Daily rollup response -> one reading per day. */
export function normalizeRollup(m: MetricDef, json: unknown): GoogleSample[] {
  const points = ((json as { rollupDataPoints?: unknown[] })?.rollupDataPoints ?? []) as unknown[];
  const out: GoogleSample[] = [];
  for (const p of points) {
    const start = pointTime(p);
    const value = pickValue(m, p);
    if (start === null || value === null) continue;
    if (m.agg === 'sum' && value === 0) continue;
    out.push({ metric: m.id, value, label: '', start, end: start + DAY });
  }
  return out;
}

const asNumber = (v: unknown) =>
  typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined;

/**
 * Sleep stage minutes in a sleep session, whether stages come as named fields (deepMinutes) or as
 * a list of { type: 'DEEP', minutes } entries.
 */
function sleepStages(point: unknown) {
  const s = { asleep: 0, deep: 0, core: 0, rem: 0, awake: 0 };
  const add = (name: string, minutes: number) => {
    const n = name.toLowerCase();
    if (/asleep/.test(n)) s.asleep += minutes;
    else if (/deep/.test(n)) s.deep += minutes;
    else if (/\brem\b|^rem|rem(minutes)?$/.test(n)) s.rem += minutes;
    else if (/light|core/.test(n)) s.core += minutes;
    else if (/wake|awake/.test(n)) s.awake += minutes;
  };
  const walk = (o: unknown) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    const label = ['type', 'stage', 'level', 'name'].map(k => rec[k]).find((v): v is string => typeof v === 'string');
    const mins = ['minutes', 'durationMinutes', 'minutesSum', 'totalMinutes'].map(k => asNumber(rec[k])).find(v => v !== undefined);
    if (label && mins !== undefined) return add(label, mins);
    for (const [k, v] of Object.entries(rec)) {
      const n = asNumber(v);
      if (n !== undefined) {
        if (/minutes/i.test(k) && !/inbed|after|before|tofallasleep/i.test(k)) add(k, n);
      } else walk(v);
    }
  };
  walk(point);
  return { ...s, asleep: s.asleep || null };
}

/** Listed data points (sessions, daily measures, events) -> readings since `sinceMs`. */
export function normalizeList(m: MetricDef, json: unknown, sinceMs: number): GoogleSample[] {
  const points = ((json as { dataPoints?: unknown[] })?.dataPoints ?? []) as unknown[];
  const out: GoogleSample[] = [];
  for (const p of points) {
    const start = pointTime(p);
    if (start === null || start < sinceMs) continue;
    if (m.id === 'sleep_asleep') {
      const s = sleepStages(p);
      const total = s.asleep ?? s.deep + s.core + s.rem;
      if (!total) continue;
      const push = (metric: string, minutes: number) => {
        if (minutes > 0) out.push({ metric, value: Math.min(24, minutes / 60), label: '', start, end: start });
      };
      push('sleep_asleep', total);
      push('sleep_deep', s.deep);
      push('sleep_core', s.core);
      push('sleep_rem', s.rem);
      push('sleep_awake', s.awake);
      continue;
    }
    if (m.agg === 'count') {
      out.push({ metric: m.id, value: 1, label: '', start, end: start });
      continue;
    }
    const value = pickValue(m, p);
    if (value !== null) out.push({ metric: m.id, value, label: '', start, end: start });
  }
  return out;
}

/** "Charge 6" -> Fitbit Charge 6; Pixel Watch stays as is. */
export function deviceFrom(json: unknown): { name: string; kind: string } {
  const list = ((json as { pairedDevices?: unknown[]; devices?: unknown[] })?.pairedDevices ??
    (json as { devices?: unknown[] })?.devices ??
    []) as Array<Record<string, unknown>>;
  const version = list.map(d => String(d.deviceVersion ?? d.displayName ?? d.name ?? '')).find(Boolean) ?? '';
  if (/pixel/i.test(version)) return { name: version, kind: 'pixel_watch' };
  if (version) return { name: /fitbit/i.test(version) ? version : `Fitbit ${version}`, kind: 'fitbit' };
  return { name: 'Fitbit', kind: 'fitbit' };
}
