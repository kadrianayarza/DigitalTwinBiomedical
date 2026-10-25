// Scores the deterioration model exported by ml/train.py. Pure functions; the model data is passed in
// so the module and the tests share one implementation. Feature definitions mirror ml/features.py.

export type RiskModel = {
  FEATURES: readonly string[];
  SIGNALS: readonly string[];
  STATS: readonly string[];
  BASE_MARGIN: number;
  PLATT: readonly [number, number];
  THRESHOLDS: { readonly elevated: number; readonly high: number };
  TREES: readonly (readonly number[])[];
};

/** One hour of vitals in the training order (HR, SpO2, temperature °C, SBP, DBP, resp rate); NaN = not measured. */
export type HourRow = readonly number[];

export type RiskLevel = 'low' | 'elevated' | 'high';

export type Driver = {
  feature: string;
  label: string;
  value: number;
  /** Change in log-odds this feature caused; positive raises the risk. */
  effect: number;
};

export type RiskResult = {
  prob: number;
  level: RiskLevel;
  drivers: Driver[];
};

const WINDOWS = [6, 24] as const;

function signals(row: HourRow): number[] {
  const [hr, , , sbp, dbp] = row as number[];
  const map = (sbp! + 2 * dbp!) / 3;
  const si = sbp! > 0 ? hr! / sbp! : NaN;
  return [...row, map, si];
}

/** The model's feature vector for hour `t` (0-based) of an hourly series. */
export function featuresAt(rows: readonly HourRow[], t: number, age: number): number[] {
  const sig = rows.slice(0, t + 1).map(signals);
  const out: number[] = [];
  const nSignals = sig[0]?.length ?? 8;
  for (let s = 0; s < nSignals; s++) {
    const seen: number[] = [];
    for (let j = 0; j <= t; j++) if (!Number.isNaN(sig[j]![s])) seen.push(j);
    const last = seen.length ? sig[seen[seen.length - 1]!]![s]! : NaN;
    out.push(last);
    let mean24 = NaN;
    let xs6: number[] = [];
    let ys6: number[] = [];
    for (const w of WINDOWS) {
      const js = seen.filter(j => j >= t - w + 1);
      const ys = js.map(j => sig[j]![s]!);
      if (ys.length) {
        const m = ys.reduce((a, y) => a + y, 0) / ys.length;
        const sd = ys.length >= 2 ? Math.sqrt(ys.reduce((a, y) => a + (y - m) ** 2, 0) / ys.length) : NaN;
        out.push(m, Math.min(...ys), Math.max(...ys), sd);
        if (w === 24) mean24 = m;
      } else {
        out.push(NaN, NaN, NaN, NaN);
      }
      if (w === 6) {
        xs6 = js;
        ys6 = ys;
      }
    }
    const n = xs6.length;
    const sx = xs6.reduce((a, x) => a + x, 0);
    const sy = ys6.reduce((a, y) => a + y, 0);
    const sxx = xs6.reduce((a, x) => a + x * x, 0);
    const sxy = xs6.reduce((a, x, i) => a + x * ys6[i]!, 0);
    const den = n * sxx - sx * sx;
    out.push(n >= 2 && den !== 0 ? (n * sxy - sx * sy) / den : NaN);
    out.push(last - mean24);
  }
  out.push(age);
  return out;
}

/** Raw margin plus per-feature contributions (Saabas: change in node value along each decision path). */
export function explain(model: RiskModel, x: readonly number[]): { margin: number; effects: Float64Array } {
  const effects = new Float64Array(model.FEATURES.length);
  let margin = model.BASE_MARGIN;
  for (const tree of model.TREES) {
    let i = 0;
    for (;;) {
      const o = i * 6;
      const f = tree[o]!;
      if (f < 0) break;
      const v = x[f]!;
      // XGBoost compares in float32; values often sit exactly on a split (e.g. 37.3 °C).
      const next = Number.isNaN(v)
        ? tree[o + 4]!
        : Math.fround(v) < Math.fround(tree[o + 1]!)
          ? tree[o + 2]!
          : tree[o + 3]!;
      effects[f] += tree[next * 6 + 5]! - tree[o + 5]!;
      i = next;
    }
    margin += tree[i * 6 + 5]!;
  }
  return { margin, effects };
}

export function calibrate(model: RiskModel, margin: number): number {
  const [a, b] = model.PLATT;
  return 1 / (1 + Math.exp(-(a * margin + b)));
}

export function levelFor(model: RiskModel, prob: number): RiskLevel {
  if (prob >= model.THRESHOLDS.high) return 'high';
  if (prob >= model.THRESHOLDS.elevated) return 'elevated';
  return 'low';
}

const SIGNAL_LABEL: Record<string, string> = {
  HR: 'Heart rate',
  O2Sat: 'SpO₂',
  Temp: 'Temperature',
  SBP: 'Systolic BP',
  DBP: 'Diastolic BP',
  Resp: 'Breathing rate',
  MAP: 'Mean arterial pressure',
  SI: 'Shock index',
};

const STAT_LABEL: Record<string, string> = {
  last: 'latest',
  mean6: '6 h average',
  min6: '6 h low',
  max6: '6 h high',
  std6: '6 h variability',
  mean24: '24 h average',
  min24: '24 h low',
  max24: '24 h high',
  std24: '24 h variability',
  slope6: '6 h trend per hour',
  delta24: 'change from 24 h average',
};

/** 'Resp_min24' -> 'Breathing rate, 24 h low'. */
export function featureLabel(feature: string): string {
  if (feature === 'Age') return 'Age';
  const [signal, stat] = feature.split('_');
  return `${SIGNAL_LABEL[signal!] ?? signal}, ${STAT_LABEL[stat!] ?? stat}`;
}

/** Probability, level and the strongest drivers for the latest hour of a series. */
export function scoreRisk(model: RiskModel, rows: readonly HourRow[], age: number, topN = 4): RiskResult {
  const x = featuresAt(rows, rows.length - 1, age);
  const { margin, effects } = explain(model, x);
  const prob = calibrate(model, margin);
  const a = model.PLATT[0];
  const drivers = [...effects]
    .map((e, i) => ({ i, e: e * a }))
    .filter(d => Math.abs(d.e) > 1e-4)
    .sort((p, q) => Math.abs(q.e) - Math.abs(p.e))
    .slice(0, topN)
    .map(({ i, e }) => ({
      feature: model.FEATURES[i]!,
      label: featureLabel(model.FEATURES[i]!),
      value: x[i]!,
      effect: e,
    }));
  return { prob, level: levelFor(model, prob), drivers };
}
