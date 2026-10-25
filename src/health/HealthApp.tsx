import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CATEGORIES, METRIC, METRICS, type HealthCategory, type MetricDef } from '../../spacetimedb/src/health';
import type { Patient } from '../module_bindings/types';
import { useData } from '../lib/data';
import { usesWheelchair } from '../lib/format';
import { CategoryIcon } from './icons';
import { Rings, Trend } from './Charts';
import {
  DAY_MS,
  RING_GOALS,
  dailySeries,
  headline,
  healthFor,
  highlights,
  loadPins,
  medicationLog,
  DOSES_PER_DAY,
  rings,
  savePins,
  startOfDay,
  type PatientHealth,
} from './model';
import { MetricDetail } from './MetricDetail';
import { Medications } from './Medications';
import { Sources } from './Sources';

export type Page =
  | { kind: 'summary' }
  | { kind: 'browse' }
  | { kind: 'category'; id: HealthCategory }
  | { kind: 'metric'; id: string }
  | { kind: 'medications' }
  | { kind: 'sources' };

export type HealthCtx = {
  patient: Patient;
  h: PatientHealth;
  viewer: 'patient' | 'nurse';
  open: (p: Page) => void;
  pins: string[];
  togglePin: (id: string) => void;
  toast: (msg: string) => void;
};

export const catStyle = (c: HealthCategory) => ({ '--cat': `var(--cat-${c})` }) as CSSProperties;

export function HealthApp({ patient, viewer, onClose, initial }: { patient: Patient; viewer: 'patient' | 'nurse'; onClose: () => void; initial?: Page }) {
  const data = useData();
  const h = useMemo(() => healthFor(data, patient.id), [data, patient.id]);
  const [stack, setStack] = useState<Page[]>([initial ?? { kind: 'summary' }]);
  const [pins, setPins] = useState(() => loadPins(patient.id, patient.procedure));
  const [note, setNote] = useState<string | null>(null);
  const main = useRef<HTMLElement>(null);
  const page = stack[stack.length - 1]!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.hsheet')) return;
      if (stack.length > 1) setStack(s => s.slice(0, -1));
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stack.length, onClose]);

  useEffect(() => main.current?.scrollTo({ top: 0 }), [stack]);

  const ctx: HealthCtx = {
    patient,
    h,
    viewer,
    pins,
    open: p => setStack(s => [...s, p]),
    togglePin: id => {
      const next = pins.includes(id) ? pins.filter(x => x !== id) : [...pins, id];
      setPins(next);
      savePins(patient.id, next);
    },
    toast: msg => {
      setNote(msg);
      window.setTimeout(() => setNote(n => (n === msg ? null : n)), 2600);
    },
  };

  const root = (p: Page) => setStack([p]);
  const tab = page.kind === 'summary' ? 'summary' : page.kind === 'sources' ? 'sources' : page.kind === 'medications' ? 'medications' : 'browse';
  const firstName = patient.name.split(' ')[0];

  return (
    <div className="health" role="dialog" aria-modal="true" aria-label={`Health record for ${patient.name}`}>
      <div className="health__window">
        <nav className="health__nav" aria-label="Health sections">
          <div className="health__who">
            <span className="health__app">Health</span>
            <span className="muted small">{viewer === 'nurse' ? patient.name : `${firstName}'s data`}</span>
          </div>
          {(
            [
              ['summary', 'Summary'],
              ['browse', 'Browse'],
              ['medications', 'Medications'],
              ['sources', 'Sources'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`health__tab ${tab === id ? 'health__tab--on' : ''}`}
              onClick={() => root({ kind: id } as Page)}
              aria-current={tab === id ? 'page' : undefined}
            >
              <CategoryIcon id={id === 'medications' ? 'medications' : id} />
              <span>{label}</span>
            </button>
          ))}
          <div className="health__cats">
            {CATEGORIES.filter(c => c.id !== 'medications').map(c => (
              <button
                key={c.id}
                className={`health__cat ${page.kind === 'category' && page.id === c.id ? 'health__cat--on' : ''}`}
                style={catStyle(c.id)}
                onClick={() => root({ kind: 'category', id: c.id })}
              >
                <CategoryIcon id={c.id} />
                {c.label}
              </button>
            ))}
          </div>
        </nav>

        <main className="health__main" ref={main}>
          <header className="health__bar">
            {stack.length > 1 ? (
              <button className="health__back" onClick={() => setStack(s => s.slice(0, -1))}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M15 5l-7 7 7 7" />
                </svg>
                Back
              </button>
            ) : (
              <span />
            )}
            <button className="health__close" onClick={onClose} aria-label="Close Health">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          {page.kind === 'summary' && <Summary ctx={ctx} />}
          {page.kind === 'browse' && <Browse ctx={ctx} />}
          {page.kind === 'category' && <Category ctx={ctx} id={page.id} />}
          {page.kind === 'metric' && (page.id === 'medication' ? <Medications ctx={ctx} /> : <MetricDetail key={page.id} ctx={ctx} m={METRIC[page.id]!} />)}
          {page.kind === 'medications' && <Medications ctx={ctx} />}
          {page.kind === 'sources' && <Sources ctx={ctx} />}
        </main>
      </div>
      {note && <div className="toast health__toast">{note}</div>}
    </div>
  );
}

function dateLine() {
  return new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function Summary({ ctx }: { ctx: HealthCtx }) {
  const { h, open, pins } = ctx;
  const [editing, setEditing] = useState(false);
  const empty = h.byMetric.size === 0;
  const hl = useMemo(() => highlights(h), [h]);

  return (
    <div className="hpage">
      <div className="hpage__head">
        <span className="kicker">{dateLine()}</span>
        <h1 className="hpage__title">Summary</h1>
      </div>

      {empty ? (
        <div className="hcard hempty">
          <CategoryIcon id="sources" />
          <h2>No health data yet</h2>
          <p className="muted">
            Connect Apple Health, a Fitbit or Pixel Watch through Google Health, or add readings by hand. Your twin and care team see trends as
            soon as data arrives.
          </p>
          <button className="btn btn--primary" onClick={() => open({ kind: 'sources' })}>
            Add a source
          </button>
        </div>
      ) : (
        <>
          <ActivityCard ctx={ctx} />

          <section className="hsection">
            <div className="hsection__head">
              <h2>Pinned</h2>
              <button className="hlink" onClick={() => setEditing(e => !e)}>
                {editing ? 'Done' : 'Edit'}
              </button>
            </div>
            {editing ? (
              <PinEditor ctx={ctx} />
            ) : (
              <div className="hgrid">
                {pins.map(id => METRIC[id]).filter((m): m is MetricDef => !!m).map(m => (
                  <MetricCard key={m.id} ctx={ctx} m={m} />
                ))}
              </div>
            )}
          </section>

          {hl.length > 0 && (
            <section className="hsection">
              <div className="hsection__head">
                <h2>Highlights</h2>
              </div>
              <div className="hgrid hgrid--wide">
                {hl.map(x => (
                  <button key={x.metric.id} className="hcard hhl" style={catStyle(x.metric.category)} onClick={() => open({ kind: 'metric', id: x.metric.id })}>
                    <span className="hcard__label">
                      <CategoryIcon id={x.metric.category} />
                      {x.metric.label}
                    </span>
                    <p>{x.text}</p>
                    <Trend values={x.recent.map(d => d.value)} color="var(--cat)" kind={x.metric.agg === 'sum' ? 'bars' : 'line'} w={360} />
                  </button>
                ))}
              </div>
            </section>
          )}

          {h.medications.length > 0 && <MedsToday ctx={ctx} />}
        </>
      )}
    </div>
  );
}

function ActivityCard({ ctx }: { ctx: HealthCtx }) {
  const { h, open, patient } = ctx;
  const today = startOfDay(Date.now());
  const r = rings(h, today);
  const roll = usesWheelchair(patient);
  const week = Array.from({ length: 7 }, (_, i) => today - (6 - i) * DAY_MS);
  if (!h.get('active_energy').length && !h.get('exercise_minutes').length) return null;
  const frac = (x: typeof r): [number, number, number] => [x.move / RING_GOALS.move, x.exercise / RING_GOALS.exercise, x.stand / RING_GOALS.stand];
  return (
    <button className="hcard hactivity" style={catStyle('activity')} onClick={() => open({ kind: 'metric', id: 'active_energy' })}>
      <span className="hcard__label">
        <CategoryIcon id="activity" />
        Activity
      </span>
      <div className="hactivity__body">
        <Rings fractions={frac(r)} />
        <dl className="hactivity__stats">
          <div style={{ '--ring': 'var(--ring-move)' } as CSSProperties}>
            <dt>Move</dt>
            <dd>
              {Math.round(r.move)}/{RING_GOALS.move}
              <small>kcal</small>
            </dd>
          </div>
          <div style={{ '--ring': 'var(--ring-exercise)' } as CSSProperties}>
            <dt>Exercise</dt>
            <dd>
              {Math.round(r.exercise)}/{RING_GOALS.exercise}
              <small>min</small>
            </dd>
          </div>
          <div style={{ '--ring': 'var(--ring-stand)' } as CSSProperties}>
            <dt>{roll ? 'Roll' : 'Stand'}</dt>
            <dd>
              {Math.round(r.stand)}/{RING_GOALS.stand}
              <small>hr</small>
            </dd>
          </div>
        </dl>
      </div>
      <div className="hactivity__week">
        {week.map(day => (
          <span key={day} className="hactivity__day">
            <Rings fractions={frac(rings(h, day))} size={34} />
            <small>{new Date(day).toLocaleDateString([], { weekday: 'narrow' })}</small>
          </span>
        ))}
      </div>
    </button>
  );
}

export function MetricCard({ ctx, m }: { ctx: HealthCtx; m: MetricDef }) {
  const { h, open } = ctx;
  const head = headline(h, m);
  const xs = h.get(m.id);
  const trend = m.agg === 'count' || !xs.length ? [] : dailySeries(m, xs, 14).map(d => d.value);
  return (
    <button className="hcard hmetric" style={catStyle(m.category)} onClick={() => open({ kind: 'metric', id: m.id })}>
      <span className="hcard__label">
        <CategoryIcon id={m.category} />
        {m.label}
        {head && <span className="hcard__when">{head.when}</span>}
      </span>
      {head ? (
        <span className="hmetric__row">
          <span className="hvalue">
            {head.value}
            {head.unit && <small>{head.unit}</small>}
          </span>
          {trend.length > 0 && <Trend values={trend} color="var(--cat)" kind={m.agg === 'sum' ? 'bars' : 'line'} />}
        </span>
      ) : (
        <span className="muted small">No data</span>
      )}
    </button>
  );
}

function PinEditor({ ctx }: { ctx: HealthCtx }) {
  const { h, pins, togglePin } = ctx;
  const options = METRICS.filter(m => h.byMetric.has(m.id) || pins.includes(m.id)).filter(m => !m.id.startsWith('sleep_') || m.id === 'sleep_asleep');
  return (
    <ul className="hpins">
      {options.map(m => (
        <li key={m.id} style={catStyle(m.category)}>
          <label className="check">
            <input type="checkbox" checked={pins.includes(m.id)} onChange={() => togglePin(m.id)} />
            <CategoryIcon id={m.category} />
            {m.label}
          </label>
        </li>
      ))}
    </ul>
  );
}

function MedsToday({ ctx }: { ctx: HealthCtx }) {
  const { h, open } = ctx;
  const due = h.medications.reduce((s, m) => s + (DOSES_PER_DAY[m.schedule] ?? 0), 0);
  const taken = h.medications.reduce((s, m) => s + medicationLog(h, m.name).today.filter(x => x.value > 0).length, 0);
  return (
    <section className="hsection">
      <div className="hsection__head">
        <h2>Medications</h2>
      </div>
      <button className="hcard hmetric" style={catStyle('medications')} onClick={() => open({ kind: 'medications' })}>
        <span className="hcard__label">
          <CategoryIcon id="medications" />
          Today
        </span>
        <span className="hmetric__row">
          <span className="hvalue">
            {taken}
            <small>of {due} scheduled doses logged</small>
          </span>
        </span>
        <span className="hmeds-mini">
          {h.medications.map(m => (
            <span key={String(m.id)} className="muted small">
              {m.name} · {m.schedule.toLowerCase()}
            </span>
          ))}
        </span>
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Browse and categories
// ---------------------------------------------------------------------------

function Browse({ ctx }: { ctx: HealthCtx }) {
  const { h, open } = ctx;
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const results = query ? METRICS.filter(m => !['bp_diastolic'].includes(m.id) && `${m.label} ${m.category}`.toLowerCase().includes(query)) : [];
  return (
    <div className="hpage">
      <div className="hpage__head">
        <h1 className="hpage__title">Browse</h1>
      </div>
      <input className="input hsearch" type="search" placeholder="Search health data" value={q} onChange={e => setQ(e.target.value)} />
      {query ? (
        <ul className="hlist">
          {results.length === 0 && <li className="muted">No matches</li>}
          {results.map(m => (
            <li key={m.id}>
              <button className="hrow" style={catStyle(m.category)} onClick={() => open({ kind: 'metric', id: m.id })}>
                <CategoryIcon id={m.category} />
                <span>{m.label}</span>
                <span className="muted small">{h.byMetric.has(m.id) ? 'Has data' : 'No data'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="hlist hlist--cats">
          {CATEGORIES.map(c => {
            const n = METRICS.filter(m => m.category === c.id && h.byMetric.has(m.id)).length;
            return (
              <li key={c.id}>
                <button
                  className="hrow"
                  style={catStyle(c.id)}
                  onClick={() => open(c.id === 'medications' ? { kind: 'medications' } : { kind: 'category', id: c.id })}
                >
                  <CategoryIcon id={c.id} />
                  <span>{c.label}</span>
                  <span className="muted small">{n ? `${n} with data` : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Metrics shown on category pages; the sleep stages and diastolic pressure live inside their parent views. */
const LISTED = (m: MetricDef) => !['sleep_deep', 'sleep_core', 'sleep_rem', 'sleep_awake', 'bp_diastolic'].includes(m.id);

function Category({ ctx, id }: { ctx: HealthCtx; id: HealthCategory }) {
  const { h, open } = ctx;
  const cat = CATEGORIES.find(c => c.id === id)!;
  const metrics = METRICS.filter(m => m.category === id && LISTED(m));
  const withData = metrics.filter(m => h.byMetric.has(m.id));
  const without = metrics.filter(m => !h.byMetric.has(m.id));
  return (
    <div className="hpage" style={catStyle(id)}>
      <div className="hpage__head">
        <span className="kicker hpage__cat">
          <CategoryIcon id={id} />
          Category
        </span>
        <h1 className="hpage__title">{cat.label}</h1>
      </div>
      {withData.length > 0 && (
        <div className="hgrid">
          {withData.map(m => (
            <MetricCard key={m.id} ctx={ctx} m={m} />
          ))}
        </div>
      )}
      {without.length > 0 && (
        <section className="hsection">
          <div className="hsection__head">
            <h2>No data available</h2>
          </div>
          <ul className="hlist">
            {without.map(m => (
              <li key={m.id}>
                <button className="hrow" onClick={() => open({ kind: 'metric', id: m.id })}>
                  <span>{m.label}</span>
                  <span className="muted small">{m.manual ? 'Add data' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
