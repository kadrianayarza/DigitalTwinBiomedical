import type { RiskScore } from '../module_bindings/types';
import type { Driver } from '../../spacetimedb/src/riskModel';

export { MODEL_CARD, THRESHOLDS } from '../../spacetimedb/src/riskModelData';

export const RISK_LEVEL_LABEL: Record<string, string> = { low: 'Low', elevated: 'Elevated', high: 'High' };

const UNIT: Record<string, string> = {
  HR: ' bpm',
  O2Sat: '%',
  Temp: ' °C',
  SBP: ' mmHg',
  DBP: ' mmHg',
  MAP: ' mmHg',
  Resp: '/min',
  SI: '',
};

/** 'Temp_slope6', 0.42 -> '+0.42 °C/h'. */
export function driverValue(d: Driver): string {
  if (d.feature === 'Age') return `${Math.round(d.value)} y`;
  const [signal, stat] = d.feature.split('_') as [string, string];
  const unit = UNIT[signal] ?? '';
  const digits = signal === 'SI' || stat.startsWith('slope') || stat.startsWith('std') ? 2 : signal === 'Temp' ? 1 : 0;
  const n = d.value.toFixed(digits);
  if (stat.startsWith('slope')) return `${d.value > 0 ? '+' : ''}${n}${unit}/h`;
  if (stat.startsWith('delta')) return `${d.value > 0 ? '+' : ''}${n}${unit}`;
  if (stat.startsWith('std')) return `±${n}${unit}`;
  return `${n}${unit}`;
}

export function parseRisk(r: RiskScore) {
  let drivers: Driver[] = [];
  let history: number[] = [];
  try {
    drivers = JSON.parse(r.drivers);
    history = JSON.parse(r.history);
  } catch {
    // Older rows may predate a field; show what parses.
  }
  return { prob: r.prob, level: r.level, hours: r.hours, drivers, history };
}

export const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
