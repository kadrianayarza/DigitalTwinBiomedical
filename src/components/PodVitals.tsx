import type { VitalSample } from '../module_bindings/types';
import { timeAgo } from '../lib/format';
import { Sparkline } from './Sparkline';
import { Panel } from './ui';

export const INCISION_BASELINE_C = 34.3;
export const CALF_BASELINE_C = 33.4;

type Props = { vitals: readonly VitalSample[]; detailed?: boolean };

export function PodVitals({ vitals, detailed }: Props) {
  const last = vitals[vitals.length - 1];
  const series = (f: (v: VitalSample) => number) => vitals.slice(-60).map(f);
  const fmt = (n: number | undefined, digits = 0) => (n === undefined ? '–' : n.toFixed(digits));

  const tiles = [
    {
      label: 'Heart rate',
      value: fmt(last?.hr),
      unit: 'bpm',
      values: series(v => v.hr),
      color: '#ff5468',
      alarm: (last?.hr ?? 0) > 100,
      min: 55,
      max: 125,
    },
    {
      label: 'SpO₂',
      value: fmt(last?.spo2),
      unit: '%',
      values: series(v => v.spo2),
      color: '#3ad7ff',
      alarm: (last?.spo2 ?? 100) < 93,
      min: 88,
      max: 100,
    },
    {
      label: 'Incision temp',
      value: fmt(last?.incisionTempC, 1),
      unit: '°C',
      values: series(v => v.incisionTempC),
      color: '#ff8a2a',
      baseline: INCISION_BASELINE_C,
      alarm: (last?.incisionTempC ?? 0) - INCISION_BASELINE_C >= 1.5,
      min: 33.5,
      max: 37.5,
    },
    {
      label: 'Calf temp',
      value: fmt(last?.calfTempC, 1),
      unit: '°C',
      values: series(v => v.calfTempC),
      color: '#b48cff',
      baseline: CALF_BASELINE_C,
      alarm: (last?.calfTempC ?? 0) - CALF_BASELINE_C >= 1.0,
      min: 32.5,
      max: 35.5,
    },
    {
      label: 'Knee bend',
      value: fmt(last?.kneeFlexDeg),
      unit: '°',
      values: series(v => v.kneeFlexDeg),
      color: '#5cff9d',
      baseline: 90,
      alarm: false,
      min: 0,
      max: 100,
    },
    {
      label: 'Steps',
      value: last ? last.steps.toLocaleString() : '–',
      unit: '',
      values: series(v => v.steps),
      color: '#c9ced8',
      alarm: false,
    },
  ];

  return (
    <Panel
      title="Twin Pod"
      code={<span className="tag">Simulated data</span>}
      className={`pod ${detailed ? 'pod--detailed' : ''}`}
    >
      <div className="pod__grid">
        {tiles.map(t => (
          <div key={t.label} className={`tile ${t.alarm ? 'tile--alarm' : ''}`} style={{ '--tile': t.color } as React.CSSProperties}>
            <div className="tile__label">
              {t.label}
              {t.alarm && <span className="tile__warn">Check</span>}
            </div>
            <div className="tile__value">
              {t.value}
              <span className="tile__unit">{t.unit}</span>
            </div>
            <Sparkline values={t.values} color={t.color} baseline={t.baseline} min={t.min} max={t.max} />
          </div>
        ))}
      </div>
      <div className="pod__foot mono">{last ? `Last updated ${timeAgo(last.ts)}` : 'Waiting for the pod…'}</div>
    </Panel>
  );
}
