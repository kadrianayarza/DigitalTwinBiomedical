import { useMemo, useState, type CSSProperties } from 'react';
import { Timestamp } from 'spacetimedb';
import { useReducer } from 'spacetimedb/react';
import { FLOW_LABEL, METRIC, MOOD_LABEL, type MetricDef } from '../../spacetimedb/src/health';
import { reducers } from '../module_bindings';
import { MetricChart, type ChartKind, type StackPart } from './Charts';
import { CategoryIcon } from './icons';
import {
  DAY_MS,
  RING_GOALS,
  cycle,
  dailySeries,
  fmtUnit,
  fmtValue,
  fromShown,
  hoursMinutes,
  hourlySeries,
  meanOf,
  num,
  showUnit,
  startOfDay,
  toShown,
  whenText,
  type DayValue,
  type Sample,
} from './model';
import { catStyle, type HealthCtx } from './HealthApp';

type Range = 'D' | 'W' | 'M' | '6M';

const STAGES = [
  { id: 'sleep_deep', label: 'Deep', color: 'var(--sleep-deep)' },
  { id: 'sleep_core', label: 'Core', color: 'var(--sleep-core)' },
  { id: 'sleep_rem', label: 'REM', color: 'var(--sleep-rem)' },
  { id: 'sleep_awake', label: 'Awake', color: 'var(--sleep-awake)' },
];

/** Six months as weekly points: the mean daily value (or spread) of each week. */
function weekly(days: DayValue[]): DayValue[] {
  const out: DayValue[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const chunk = days.slice(Math.max(0, end - 7), end);
    const vs = chunk.filter(d => d.value !== null);
    const lows = vs.map(d => d.lo ?? d.value!);
    const highs = vs.map(d => d.hi ?? d.value!);
    out.unshift({
      day: chunk[0]!.day,
      value: vs.length ? vs.reduce((s, d) => s + d.value!, 0) / vs.length : null,
      lo: vs.length ? Math.min(...lows) : undefined,
      hi: vs.length ? Math.max(...highs) : undefined,
      n: vs.reduce((s, d) => s + d.n, 0),
    });
  }
  return out;
}

function seriesFor(m: MetricDef, xs: Sample[], range: Range) {
  if (range === 'D') return hourlySeries(m, xs, startOfDay(Date.now()));
  if (range === 'W') return dailySeries(m, xs, 7);
  if (range === 'M') return dailySeries(m, xs, 30);
  return weekly(dailySeries(m, xs, 182));
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

function bpClass(sys: number, dia: number) {
  if (sys > 180 || dia > 120) return { label: 'Hypertensive crisis', tone: 'alarm' };
  if (sys >= 140 || dia >= 90) return { label: 'High, stage 2', tone: 'alarm' };
  if (sys >= 130 || dia >= 80) return { label: 'High, stage 1', tone: 'watch' };
  if (sys >= 120) return { label: 'Elevated', tone: 'watch' };
  return { label: 'Normal', tone: 'ok' };
}

export function MetricDetail({ ctx, m }: { ctx: HealthCtx; m: MetricDef }) {
  const { h, pins, togglePin } = ctx;
  const xs = h.get(m.id);
  const today = startOfDay(Date.now());
  const intraday = xs.filter(s => s.at >= today).length >= 3;
  const [range, setRange] = useState<Range>(intraday && m.agg === 'range' ? 'D' : 'W');
  const [sel, setSel] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const isBp = m.id === 'bp_systolic';
  const isSleep = m.id === 'sleep_asleep';

  const series = useMemo(() => {
    const base = seriesFor(m, xs, range);
    if (!isBp) return base;
    const dia = seriesFor(METRIC.bp_diastolic!, h.get('bp_diastolic'), range);
    return base.map((d, i) => (d.value === null ? d : { ...d, lo: dia[i]?.value ?? d.value, hi: d.value }));
  }, [m, xs, range, isBp, h]);

  const stack: StackPart[] | undefined = useMemo(() => {
    if (!isSleep || range === 'D') return undefined;
    return STAGES.map(s => ({ key: s.id, color: s.color, values: seriesFor(METRIC[s.id]!, h.get(s.id), range).map(d => d.value) }));
  }, [isSleep, range, h]);
  const hasStages = !!stack?.some(p => p.values.some(v => v));

  const kind: ChartKind = isBp || m.agg === 'range' ? 'range' : m.agg === 'sum' || m.agg === 'count' ? 'bars' : range === 'W' || range === 'D' ? 'dots' : 'line';
  const goal =
    range === 'D' ? undefined
    : m.id === 'active_energy' ? RING_GOALS.move
    : m.id === 'exercise_minutes' ? RING_GOALS.exercise
    : m.id === 'stand_hours' ? RING_GOALS.stand
    : undefined;
  const fixed: [number, number] | undefined = m.id === 'mood' ? [-3, 3] : m.id === 'menstrual_flow' ? [0, 4] : undefined;

  const fmtPoint = (d: DayValue) => {
    if (d.value === null) return '–';
    if (isBp) return `${Math.round(d.hi ?? d.value)}/${Math.round(d.lo ?? d.value)}`;
    if (m.agg === 'range' && d.lo !== undefined && d.hi !== undefined && d.lo !== d.hi) return `${fmtValue(m, d.lo)}–${fmtValue(m, d.hi)}`;
    return fmtValue(m, d.value);
  };
  const pointDate = (d: DayValue) =>
    range === 'D' ? new Date(d.day).toLocaleTimeString([], { hour: 'numeric' })
    : range === '6M' ? `Week of ${shortDate(d.day)}`
    : new Date(d.day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const summary = (() => {
    const withData = series.filter(d => d.value !== null);
    if (withData.length === 0) return { label: 'No data', value: '–' };
    if (isBp) {
      return { label: 'Average', value: `${Math.round(meanOf(withData)!)}/${Math.round(withData.reduce((s, d) => s + (d.lo ?? 0), 0) / withData.length)}` };
    }
    if (m.agg === 'range') {
      const lo = Math.min(...withData.map(d => d.lo ?? d.value!));
      const hi = Math.max(...withData.map(d => d.hi ?? d.value!));
      return { label: 'Range', value: `${fmtValue(m, lo)}–${fmtValue(m, hi)}` };
    }
    if (m.agg === 'count' || (m.agg === 'sum' && range === 'D')) {
      return { label: 'Total', value: fmtValue(m, withData.reduce((s, d) => s + d.value!, 0)) };
    }
    if (m.id === 'menstrual_flow') return { label: 'Period days', value: String(withData.filter(d => (d.value ?? 0) > 0).length) };
    return { label: m.agg === 'sum' ? 'Daily average' : 'Average', value: fmtValue(m, meanOf(withData)!) };
  })();

  const span = (() => {
    if (range === 'D') return 'Today';
    const first = series[0]!.day;
    const last = series[series.length - 1]!.day;
    return `${shortDate(first)} – ${shortDate(last)}, ${new Date(last).getFullYear()}`;
  })();

  const xLabel = (d: DayValue, i: number) => {
    const date = new Date(d.day);
    if (range === 'D') return i % 6 === 0 ? date.toLocaleTimeString([], { hour: 'numeric' }) : null;
    if (range === 'W') return date.toLocaleDateString([], { weekday: 'short' });
    if (range === 'M') return i % 7 === 2 ? shortDate(d.day) : null;
    const prev = series[i - 1];
    return !prev || new Date(prev.day).getMonth() !== date.getMonth() ? date.toLocaleDateString([], { month: 'short' }) : null;
  };

  const shownSel = sel !== null ? series[sel] : undefined;
  const selStack = sel !== null && stack ? stack.reduce((s, p) => s + (p.values[sel] ?? 0), 0) : 0;
  const unit = isBp ? 'mmHg' : fmtUnit(m);
  const pinned = pins.includes(m.id);
  const canAdd = !!m.manual && m.id !== 'mood' && m.id !== 'menstrual_flow';

  return (
    <div className="hpage" style={catStyle(m.category)}>
      <div className="hpage__head hpage__head--metric">
        <span className="kicker hpage__cat">
          <CategoryIcon id={m.category} />
          {m.category === 'vitals' ? 'Vitals' : m.category.charAt(0).toUpperCase() + m.category.slice(1)}
        </span>
        <h1 className="hpage__title">{m.label}</h1>
        <div className="hpage__actions">
          <button className={`btn btn--ghost hpin ${pinned ? 'hpin--on' : ''}`} onClick={() => togglePin(m.id)} aria-pressed={pinned}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
            </svg>
            {pinned ? 'Pinned' : 'Pin to Summary'}
          </button>
          {canAdd && (
            <button className="btn btn--primary" onClick={() => setAdding(true)}>
              Add Data
            </button>
          )}
        </div>
      </div>

      <div className="hcard hdetail">
        <div className="seg hrange" role="tablist">
          {(['D', 'W', 'M', '6M'] as Range[]).map(r => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              className={`seg__btn ${range === r ? 'seg__btn--on' : ''}`}
              onClick={() => {
                setRange(r);
                setSel(null);
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="hdetail__stat">
          <span className="hdetail__label">{shownSel ? (isSleep && stack ? 'Asleep' : m.agg === 'sum' && range !== 'D' ? 'Total' : m.agg === 'range' ? 'Range' : 'Value') : summary.label}</span>
          <span className="hvalue hvalue--lg">
            {shownSel ? (stack ? hoursMinutes(selStack - (stack[3]!.values[sel!] ?? 0)) : fmtPoint(shownSel)) : summary.value}
            {unit && <small>{unit}</small>}
          </span>
          <span className="muted small">{shownSel ? pointDate(shownSel) : span}</span>
        </div>
        <MetricChart
          series={series}
          kind={kind}
          stack={hasStages ? stack : undefined}
          shown={isSleep || isBp ? undefined : v => toShown(m, v)}
          tickText={m.id === 'mood' ? v => String(v) : m.id === 'menstrual_flow' ? v => FLOW_LABEL[v]?.charAt(0) ?? '' : isSleep ? v => `${v}h` : undefined}
          xLabel={xLabel}
          color="var(--cat)"
          goal={goal}
          fixed={fixed}
          selected={sel}
          onSelect={setSel}
        />
        {hasStages && (
          <ul className="hlegend">
            {STAGES.map(s => {
              const avg = meanOf(seriesFor(METRIC[s.id]!, h.get(s.id), range));
              return (
                <li key={s.id}>
                  <i style={{ background: s.color }} />
                  {s.label}
                  <span className="muted">{avg === null ? '–' : hoursMinutes(avg)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isBp && <BpCard ctx={ctx} />}
      {m.id === 'blood_glucose' && <GlucoseCard xs={xs} />}
      {m.id === 'mood' && <MoodLogger ctx={ctx} />}
      {m.id === 'menstrual_flow' && <CycleCard ctx={ctx} />}

      <div className="hcard habout">
        <h2>About {m.label}</h2>
        <p>{m.about}</p>
      </div>

      <SourcesFor ctx={ctx} xs={xs} />
      <RecentData ctx={ctx} m={m} xs={xs} />

      {adding && <AddData ctx={ctx} m={m} onClose={() => setAdding(false)} />}
    </div>
  );
}

function BpCard({ ctx }: { ctx: HealthCtx }) {
  const sys = ctx.h.get('bp_systolic');
  const last = sys[sys.length - 1];
  if (!last) return null;
  const dia = ctx.h.get('bp_diastolic').filter(s => Math.abs(s.at - last.at) < 60_000).pop();
  const c = bpClass(last.value, dia?.value ?? 0);
  return (
    <div className={`hcard hnote hnote--${c.tone}`}>
      <strong>
        Latest {Math.round(last.value)}/{dia ? Math.round(dia.value) : '–'} mmHg: {c.label}
      </strong>
      <span className="muted small">
        {whenText(last.at)} · Normal is under 120/80. Call your care team for readings over 180/120 or with headache, chest pain or vision changes.
      </span>
    </div>
  );
}

function GlucoseCard({ xs }: { xs: Sample[] }) {
  const recent = xs.filter(s => Date.now() - s.at < 14 * DAY_MS);
  if (recent.length < 4) return null;
  const inRange = recent.filter(s => s.value >= 70 && s.value <= 180).length / recent.length;
  const high = recent.filter(s => s.value > 180).length / recent.length;
  const low = recent.filter(s => s.value < 70).length / recent.length;
  return (
    <div className="hcard htir">
      <h2>Time in range · last 14 days</h2>
      <div className="htir__bar" aria-hidden>
        <i className="htir__low" style={{ flex: low }} />
        <i className="htir__in" style={{ flex: inRange }} />
        <i className="htir__high" style={{ flex: high }} />
      </div>
      <p className="small">
        <strong>{Math.round(inRange * 100)}%</strong> in range (70–180 mg/dL) · {Math.round(high * 100)}% high · {Math.round(low * 100)}% low. Most
        people with diabetes aim for more than 70% in range.
      </p>
    </div>
  );
}

const FEELINGS = ['Calm', 'Content', 'Hopeful', 'Grateful', 'Proud', 'Relieved', 'Tired', 'Stressed', 'Anxious', 'Worried', 'Frustrated', 'Sad', 'Irritable', 'In pain'];

function nowInput() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function MoodLogger({ ctx }: { ctx: HealthCtx }) {
  const log = useReducer(reducers.logHealthSample);
  const [level, setLevel] = useState(0);
  const [feeling, setFeeling] = useState('');
  const submit = () =>
    log({ patientId: ctx.patient.id, metric: 'mood', value: level, label: feeling, at: Timestamp.now() })
      .then(() => ctx.toast('Mood logged'))
      .catch(e => ctx.toast(`Could not save: ${String(e)}`));
  return (
    <div className="hcard hmood">
      <h2>How are you feeling right now?</h2>
      <div className="hmood__scale" role="radiogroup" aria-label="Mood">
        {[-3, -2, -1, 0, 1, 2, 3].map(v => (
          <button
            key={v}
            role="radio"
            aria-checked={level === v}
            className={`hmood__dot ${level === v ? 'hmood__dot--on' : ''}`}
            style={{ '--mood': `${(v + 3) / 6}` } as CSSProperties}
            onClick={() => setLevel(v)}
            title={MOOD_LABEL[v]}
          />
        ))}
      </div>
      <strong>{MOOD_LABEL[level]}</strong>
      <div className="chips">
        {FEELINGS.map(f => (
          <button key={f} className={`chip ${feeling === f ? 'chip--on' : ''}`} onClick={() => setFeeling(feeling === f ? '' : f)}>
            {f}
          </button>
        ))}
      </div>
      <button className="btn btn--primary" onClick={submit}>
        Log mood
      </button>
    </div>
  );
}

function CycleCard({ ctx }: { ctx: HealthCtx }) {
  const log = useReducer(reducers.logHealthSample);
  const c = cycle(ctx.h);
  const today = startOfDay(Date.now());
  const logged = new Map(ctx.h.get('menstrual_flow').map(s => [startOfDay(s.at), s.value]));
  const days = Array.from({ length: 42 }, (_, i) => today - (27 - i) * DAY_MS);
  const predicted = (d: number) => !!c && d >= c.next && d < c.next + c.periodLength * DAY_MS;
  const flow = (v: number) =>
    log({ patientId: ctx.patient.id, metric: 'menstrual_flow', value: v, label: '', at: Timestamp.now() })
      .then(() => ctx.toast(`Logged ${FLOW_LABEL[v]!.toLowerCase()} for today`))
      .catch(e => ctx.toast(`Could not save: ${String(e)}`));
  return (
    <div className="hcard hcycle">
      {c ? (
        <div className="hcycle__stats">
          <div>
            <span className="hdetail__label">Cycle day</span>
            <span className="hvalue">{c.cycleDay}</span>
          </div>
          <div>
            <span className="hdetail__label">Next period</span>
            <span className="hvalue">
              {c.daysUntil === 0 ? 'Today' : `${c.daysUntil}`}
              {c.daysUntil > 0 && <small>days · {shortDate(c.next)}</small>}
            </span>
          </div>
          <div>
            <span className="hdetail__label">Typical cycle</span>
            <span className="hvalue">
              {c.cycleLength}
              <small>days</small>
            </span>
          </div>
          <div>
            <span className="hdetail__label">Typical period</span>
            <span className="hvalue">
              {c.periodLength}
              <small>days</small>
            </span>
          </div>
        </div>
      ) : (
        <p className="muted">Log period days to see predictions.</p>
      )}
      <div className="hcycle__cal" aria-label="Last four weeks and the next two">
        {days.map(d => {
          const v = logged.get(d) ?? 0;
          return (
            <span
              key={d}
              className={`hcycle__day ${v > 0 ? 'hcycle__day--flow' : ''} ${predicted(d) ? 'hcycle__day--predicted' : ''} ${d === today ? 'hcycle__day--today' : ''}`}
              title={`${shortDate(d)}${v > 0 ? ` · ${FLOW_LABEL[Math.round(v)]}` : predicted(d) ? ' · predicted' : ''}`}
            >
              {new Date(d).getDate()}
            </span>
          );
        })}
      </div>
      <div className="hcycle__log">
        <span className="small muted">Log today:</span>
        <div className="chips">
          {FLOW_LABEL.map((label, v) => (
            <button key={label} className="chip" onClick={() => flow(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SourcesFor({ ctx, xs }: { ctx: HealthCtx; xs: Sample[] }) {
  const counts = new Map<string, number>();
  for (const s of xs) counts.set(s.device || 'Unknown', (counts.get(s.device || 'Unknown') ?? 0) + 1);
  if (counts.size === 0) return null;
  return (
    <div className="hcard">
      <h2 className="hcard__h">Data sources</h2>
      <ul className="hlist">
        {[...counts].map(([device, n]) => (
          <li key={device}>
            <button className="hrow" onClick={() => ctx.open({ kind: 'sources' })}>
              <span>{device}</span>
              <span className="muted small">{n.toLocaleString()} readings</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentData({ ctx, m, xs }: { ctx: HealthCtx; m: MetricDef; xs: Sample[] }) {
  const remove = useReducer(reducers.deleteHealthSample);
  const [all, setAll] = useState(false);
  if (!xs.length) return null;
  const list = [...xs].reverse().slice(0, all ? 200 : 8);
  const dia = m.id === 'bp_systolic' ? ctx.h.get('bp_diastolic') : [];
  return (
    <div className="hcard">
      <h2 className="hcard__h">All recorded data</h2>
      <ul className="hdata">
        {list.map(s => {
          const pair = dia.find(d => Math.abs(d.at - s.at) < 60_000);
          return (
            <li key={String(s.id)}>
              <span className="hdata__value">
                {m.id === 'bp_systolic' && pair ? `${Math.round(s.value)}/${Math.round(pair.value)}` : fmtValue(m, s.value)}
                <small>{m.id === 'bp_systolic' ? 'mmHg' : fmtUnit(m)}</small>
                {s.label && <span className="hdata__label">{s.label}</span>}
              </span>
              <span className="muted small">
                {new Date(s.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {s.device}
              </span>
              {s.source === 'manual' && (
                <button
                  className="hdata__del"
                  aria-label="Delete reading"
                  onClick={() => {
                    void remove({ id: s.id });
                    if (pair) void remove({ id: pair.id });
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {xs.length > 8 && (
        <button className="hlink" onClick={() => setAll(a => !a)}>
          {all ? 'Show less' : `Show all ${Math.min(xs.length, 200).toLocaleString()}`}
        </button>
      )}
    </div>
  );
}

const WORKOUTS = ['Walking', 'Physical therapy', 'Strength training', 'Cycling', 'Swimming', 'Yoga', 'Wheelchair pace', 'Other'];

function AddData({ ctx, m, onClose }: { ctx: HealthCtx; m: MetricDef; onClose: () => void }) {
  const log = useReducer(reducers.logHealthSample);
  const isBp = m.id === 'bp_systolic';
  const isSleep = m.category === 'sleep';
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [label, setLabel] = useState(m.id === 'workouts' ? 'Walking' : '');
  const [when, setWhen] = useState(nowInput);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const at = Timestamp.fromDate(new Date(when));
    const entries: Array<{ metric: string; value: number }> = [];
    const x = parseFloat(a);
    const y = parseFloat(b);
    if (isBp) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return setError('Enter both numbers.');
      entries.push({ metric: 'bp_systolic', value: x }, { metric: 'bp_diastolic', value: y });
    } else if (isSleep) {
      const hours = (Number.isFinite(x) ? x : 0) + (Number.isFinite(y) ? y : 0) / 60;
      if (hours <= 0) return setError('Enter how long you slept.');
      entries.push({ metric: m.id, value: hours });
    } else {
      if (!Number.isFinite(x)) return setError('Enter a number.');
      entries.push({ metric: m.id, value: fromShown(m, x) });
    }
    for (const e of entries) {
      const def = METRIC[e.metric]!;
      if (e.value < def.min || e.value > def.max) {
        return setError(`${def.label} should be between ${num(toShown(def, def.min), 0)} and ${num(toShown(def, def.max), 0)} ${showUnit(def)}.`);
      }
    }
    setBusy(true);
    try {
      for (const e of entries) await log({ patientId: ctx.patient.id, metric: e.metric, value: e.value, label, at });
      ctx.toast(`${m.label} added`);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop hsheet" onClick={e => e.target === e.currentTarget && onClose()}>
      <form
        className="sheet hsheet__card"
        onSubmit={e => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="sheet__head">
          <div>
            <span className="kicker">Add Data</span>
            <h2 className="hsheet__title">{m.label}</h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        {isBp ? (
          <div className="hsheet__row">
            <label className="field">
              <span className="field__label">Systolic</span>
              <input className="input" inputMode="numeric" autoFocus value={a} onChange={e => setA(e.target.value)} placeholder="120" />
            </label>
            <label className="field">
              <span className="field__label">Diastolic</span>
              <input className="input" inputMode="numeric" value={b} onChange={e => setB(e.target.value)} placeholder="80" />
            </label>
            <span className="hsheet__unit">mmHg</span>
          </div>
        ) : isSleep ? (
          <div className="hsheet__row">
            <label className="field">
              <span className="field__label">Hours</span>
              <input className="input" inputMode="numeric" autoFocus value={a} onChange={e => setA(e.target.value)} placeholder="7" />
            </label>
            <label className="field">
              <span className="field__label">Minutes</span>
              <input className="input" inputMode="numeric" value={b} onChange={e => setB(e.target.value)} placeholder="30" />
            </label>
          </div>
        ) : (
          <div className="hsheet__row">
            <label className="field">
              <span className="field__label">{m.label}</span>
              <input className="input" inputMode="decimal" autoFocus value={a} onChange={e => setA(e.target.value)} />
            </label>
            <span className="hsheet__unit">{showUnit(m)}</span>
          </div>
        )}
        {m.id === 'workouts' && (
          <div className="field">
            <span className="field__label">Type</span>
            <div className="chips">
              {WORKOUTS.map(w => (
                <button type="button" key={w} className={`chip ${label === w ? 'chip--on' : ''}`} onClick={() => setLabel(w)}>
                  {w}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="field">
          <span className="field__label">Date and time</span>
          <input className="input" type="datetime-local" value={when} max={nowInput()} onChange={e => setWhen(e.target.value)} />
        </label>
        {error && <p className="error small">{error}</p>}
        <div className="sheet__foot">
          <p className="muted small">Saved to your record and shared with your care team.</p>
          <button className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}
