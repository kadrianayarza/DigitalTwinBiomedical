import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { METRIC, healthRules, type MetricDef } from '../../spacetimedb/src/health';
import type { Patient } from '../module_bindings/types';
import { useData } from '../lib/data';
import { REASON_LABEL, timeAgo, usesWheelchair } from '../lib/format';
import { Sparkline } from '../components/Sparkline';
import { Panel } from '../components/ui';
import { Rings } from './Charts';
import { RING_GOALS, dailySeries, defaultPins, headline, healthFor, rings, startOfDay, type PatientHealth } from './model';
import type { Page } from './HealthApp';

/** Wearable rule hits right now, computed the same way as the server. */
export function wearableFlags(h: PatientHealth) {
  const points = ['weight', 'resting_heart_rate', 'blood_oxygen', 'irregular_rhythm', 'blood_glucose'].flatMap(id =>
    h.get(id).map(s => ({ metric: s.metric, value: s.value, label: s.label, at: s.at * 1000 }))
  );
  return healthRules(points, Date.now() * 1000);
}

function missedDoses(h: PatientHealth) {
  return h.get('medication').filter(s => s.value === 0 && Date.now() - s.at < 7 * 86_400_000);
}

function Tile({ h, m, onOpen }: { h: PatientHealth; m: MetricDef; onOpen: (p: Page) => void }) {
  const head = headline(h, m);
  const xs = h.get(m.id);
  const values = dailySeries(m, xs, 14)
    .slice(0, m.agg === 'sum' ? -1 : undefined)
    .map(d => d.value)
    .filter((v): v is number => v !== null);
  return (
    <button className="tile tile--health" style={{ '--tile': `var(--cat-${m.category})` } as CSSProperties} onClick={() => onOpen({ kind: 'metric', id: m.id })}>
      <div className="tile__label">
        {m.label.replace('Walking + Running ', '').replace(' Average', '')}
        <span className="tile__when">{head?.when}</span>
      </div>
      <div className="tile__value">
        {head?.value ?? '–'}
        {head?.unit && <span className="tile__unit">{head.unit}</span>}
      </div>
      <Sparkline values={values} color={`var(--cat-${m.category})`} />
    </button>
  );
}

export function HealthGlance({
  patient,
  variant,
  title,
  onOpen,
}: {
  patient: Patient;
  variant: 'patient' | 'nurse';
  title?: ReactNode;
  onOpen: (p?: Page) => void;
}) {
  const data = useData();
  const h = useMemo(() => healthFor(data, patient.id), [data, patient.id]);
  const flags = useMemo(() => wearableFlags(h), [h]);
  const missed = missedDoses(h);
  const ids = defaultPins(patient.procedure).filter(id => id !== 'medication' && h.byMetric.has(id));
  const metrics = ids.map(id => METRIC[id]!).slice(0, variant === 'nurse' ? 5 : 4);
  const lastSync = h.devices.reduce<(typeof h.devices)[number] | undefined>(
    (a, d) => (!a || d.lastSyncAt.microsSinceUnixEpoch > a.lastSyncAt.microsSinceUnixEpoch ? d : a),
    undefined
  );
  const r = rings(h, startOfDay(Date.now()));
  const hasRings = h.get('active_energy').length > 0;

  return (
    <Panel
      title={title ?? 'Health'}
      code={
        <button className="hlink" onClick={() => onOpen()}>
          {variant === 'nurse' ? 'Full health record' : 'Open Health'} ›
        </button>
      }
      className={`pod hglance ${variant === 'nurse' ? 'pod--detailed' : ''}`}
    >
      {h.byMetric.size === 0 ? (
        <p className="muted small">
          No wearable or home data yet.{' '}
          <button className="hlink" onClick={() => onOpen({ kind: 'sources' })}>
            Connect a device
          </button>
        </p>
      ) : (
        <>
          {(flags.length > 0 || missed.length > 0) && (
            <ul className="hglance__flags">
              {flags.map(f => (
                <li key={f.code} className={`hglance__flag hglance__flag--${f.priority === 'same_day' ? 'alarm' : 'watch'}`}>
                  {REASON_LABEL[f.code] ?? f.code}
                </li>
              ))}
              {missed.length > 0 && (
                <li className="hglance__flag hglance__flag--watch">
                  {missed.length} missed dose{missed.length > 1 ? 's' : ''} this week: {[...new Set(missed.map(s => s.label))].join(', ')}
                </li>
              )}
            </ul>
          )}
          {variant === 'patient' && hasRings && (
            <button className="hglance__rings" onClick={() => onOpen({ kind: 'metric', id: 'active_energy' })}>
              <Rings fractions={[r.move / RING_GOALS.move, r.exercise / RING_GOALS.exercise, r.stand / RING_GOALS.stand]} size={64} />
              <dl className="hglance__ringstats">
                {(
                  [
                    ['Move', r.move, RING_GOALS.move, 'kcal', 'var(--ring-move)'],
                    ['Exercise', r.exercise, RING_GOALS.exercise, 'min', 'var(--ring-exercise)'],
                    [usesWheelchair(patient) ? 'Roll' : 'Stand', r.stand, RING_GOALS.stand, 'hr', 'var(--ring-stand)'],
                  ] as const
                ).map(([label, v, goal, unit, color]) => (
                  <div key={label}>
                    <dt style={{ color }}>{label}</dt>
                    <dd>
                      {Math.round(v)}/{goal} <small>{unit}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            </button>
          )}
          <div className="pod__grid">
            {metrics.map(m => (
              <Tile key={m.id} h={h} m={m} onOpen={onOpen} />
            ))}
          </div>
          <div className="pod__foot mono">
            {h.devices.length ? `${h.devices.map(d => d.name).join(' · ')} · synced ${lastSync ? timeAgo(lastSync.lastSyncAt) : ''}` : 'Entered by hand'}
          </div>
        </>
      )}
    </Panel>
  );
}
