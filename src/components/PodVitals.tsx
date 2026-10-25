import type { VitalSign } from '../module_bindings/types';
import { timeAgo } from '../lib/format';
import { Sparkline } from './Sparkline';
import { Panel } from './ui';

type Props = { vitals: readonly VitalSign[]; detailed?: boolean };

export function PodVitals({ vitals, detailed }: Props) {
  const last = vitals[vitals.length - 1];
  const series = (f: (v: VitalSign) => number) => vitals.slice(-60).map(f);
  const fmt = (n: number | undefined, digits = 0) => (n === undefined ? '–' : n.toFixed(digits));
  // Alarms follow the 5-reading mean, like the server rules, so noise near a threshold does not flicker them.
  const recent = vitals.slice(-5);
  const mean = (f: (v: VitalSign) => number) =>
    recent.length ? recent.reduce((s, v) => s + f(v), 0) / recent.length : undefined;
  const hr = mean(v => v.hr);
  const systolic = mean(v => v.systolic);
  const respRate = mean(v => v.respRate);
  const spo2 = mean(v => v.spo2);
  const tempC = mean(v => v.tempC);

  const tiles = [
    {
      label: 'Heart rate',
      value: fmt(last?.hr),
      unit: 'bpm',
      values: series(v => v.hr),
      color: '#ff5468',
      alarm: (hr ?? 0) > 100,
      min: 55,
      max: 125,
    },
    {
      label: 'Blood pressure',
      value: last ? `${last.systolic.toFixed(0)}/${last.diastolic.toFixed(0)}` : '–',
      unit: 'mmHg',
      values: series(v => v.systolic),
      color: '#b48cff',
      alarm: systolic !== undefined && (systolic < 90 || systolic >= 180),
      min: 80,
      max: 190,
    },
    {
      label: 'Respiratory rate',
      value: fmt(last?.respRate),
      unit: '/min',
      values: series(v => v.respRate),
      color: '#22b573',
      alarm: (respRate ?? 0) > 24,
      min: 8,
      max: 32,
    },
    {
      label: 'SpO₂',
      value: fmt(last?.spo2),
      unit: '%',
      values: series(v => v.spo2),
      color: '#3ad7ff',
      alarm: (spo2 ?? 100) < 93,
      min: 88,
      max: 100,
    },
    {
      label: 'Temperature',
      value: fmt(last?.tempC, 1),
      unit: '°C',
      values: series(v => v.tempC),
      color: '#ff8a2a',
      alarm: (tempC ?? 0) >= 38,
      min: 35.5,
      max: 39.5,
      wide: true,
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
          <div
            key={t.label}
            className={`tile ${t.alarm ? 'tile--alarm' : ''} ${t.wide ? 'tile--wide' : ''}`}
            style={{ '--tile': t.color } as React.CSSProperties}
          >
            <div className="tile__label">
              {t.label}
              <span className={`tile__flag ${t.alarm ? 'tile__flag--on' : ''}`} aria-hidden={!t.alarm}>
                <span className="tile__warn">Check</span>
              </span>
            </div>
            <div className="tile__value">
              {t.value}
              <span className="tile__unit">{t.unit}</span>
            </div>
            <Sparkline values={t.values} color={t.color} min={t.min} max={t.max} />
          </div>
        ))}
      </div>
      <div className="pod__foot mono">{last ? `Last updated ${timeAgo(last.ts)}` : 'Waiting for the pod…'}</div>
    </Panel>
  );
}
