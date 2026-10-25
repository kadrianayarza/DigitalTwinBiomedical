import { useState, type FormEvent, type ReactNode } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Medication } from '../module_bindings/types';
import {
  MED_KINDS,
  MED_KIND_LABEL,
  MED_PRESETS,
  MED_ROUTES,
  isInsulin,
  normalizeTimes,
  type MedPreset,
} from '../lib/meds';

type Draft = {
  name: string;
  kind: string;
  dose: string;
  route: string;
  instructions: string;
  sideEffects: string;
  contraindications: string;
  times: string[];
  remindersOn: boolean;
  requiresGlucose: boolean;
};

const BLANK: Draft = {
  name: '',
  kind: 'other',
  dose: '',
  route: 'oral',
  instructions: '',
  sideEffects: '',
  contraindications: '',
  times: ['08:00'],
  remindersOn: true,
  requiresGlucose: false,
};

const fromMed = (m: Medication): Draft => ({
  name: m.name,
  kind: m.kind,
  dose: m.dose,
  route: m.route,
  instructions: m.instructions,
  sideEffects: m.sideEffects,
  contraindications: m.contraindications,
  times: m.scheduleTimes.split(','),
  remindersOn: m.remindersOn,
  requiresGlucose: m.requiresGlucose,
});

const fromPreset = (p: MedPreset): Draft => ({
  name: p.name,
  kind: p.kind,
  dose: p.dose,
  route: p.route,
  instructions: p.instructions,
  sideEffects: p.sideEffects.join('\n'),
  contraindications: p.contraindications.join('\n'),
  times: p.times.split(','),
  remindersOn: true,
  requiresGlucose: p.requiresGlucose,
});

type Props = {
  patientId: bigint;
  patientName: string;
  existing?: Medication;
  others: readonly Medication[];
  onClose: () => void;
};

export function MedicationSheet({ patientId, patientName, existing, others, onClose }: Props) {
  const save = useReducer(reducers.saveMedication);
  const [d, setD] = useState<Draft>(existing ? fromMed(existing) : BLANK);
  const [preset, setPreset] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }));

  let timesError: string | null = null;
  try {
    normalizeTimes(d.times.join(','));
  } catch (e) {
    timesError = (e as Error).message;
  }

  const overlaps = others.filter(
    o =>
      o.id !== existing?.id &&
      (o.name.trim().toLowerCase() === d.name.trim().toLowerCase() || (isInsulin(d.kind) && o.kind === d.kind))
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save({
        id: existing?.id ?? 0n,
        patientId,
        name: d.name,
        kind: d.kind,
        dose: d.dose,
        route: d.route,
        instructions: d.instructions,
        sideEffects: d.sideEffects,
        contraindications: d.contraindications,
        scheduleTimes: d.times.join(','),
        tzOffsetMin: new Date().getTimezoneOffset(),
        remindersOn: d.remindersOn,
        requiresGlucose: d.requiresGlucose,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet medsheet" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <header className="sheet__head">
          <div>
            <div className="kicker">
              {existing ? 'Edit medication' : 'New medication'} · {patientName}
            </div>
            <h2 className="sheet__title medsheet__title">{d.name || 'Medication'}</h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </header>

        {!existing && (
          <Field label="Start from a template">
            <div className="chips">
              {MED_PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  className={`chip ${preset === p.key ? 'chip--on' : ''}`}
                  aria-pressed={preset === p.key}
                  onClick={() => {
                    setPreset(p.key);
                    setD(fromPreset(p));
                  }}
                >
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                className={`chip ${preset === '' ? 'chip--on' : ''}`}
                aria-pressed={preset === ''}
                onClick={() => {
                  setPreset('');
                  setD(BLANK);
                }}
              >
                Custom
              </button>
            </div>
            <span className="tiny muted">
              Template text is a starting point. Check it against current prescribing information and the patient's
              history.
            </span>
          </Field>
        )}

        <div className="medsheet__grid">
          <Field label="Name">
            <input className="input" value={d.name} onChange={e => set('name', e.target.value)} required />
          </Field>
          <Field label="Type">
            <select
              className="input"
              value={d.kind}
              onChange={e => {
                const kind = e.target.value;
                setD(prev => ({ ...prev, kind, requiresGlucose: isInsulin(kind) || prev.requiresGlucose }));
              }}
            >
              {MED_KINDS.map(k => (
                <option key={k} value={k}>
                  {MED_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dose">
            <input
              className="input"
              placeholder="e.g. 10 units, 500 mg"
              value={d.dose}
              onChange={e => set('dose', e.target.value)}
              required
            />
          </Field>
          <Field label="Route">
            <select className="input" value={d.route} onChange={e => set('route', e.target.value)}>
              {MED_ROUTES.map(r => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Schedule (patient's local time)">
          <div className="medsheet__times">
            {d.times.map((t, i) => (
              <span key={i} className="medsheet__time">
                <input
                  type="time"
                  className="input"
                  value={t}
                  aria-label={`Dose time ${i + 1}`}
                  onChange={e => set('times', d.times.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {d.times.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    aria-label={`Remove dose time ${i + 1}`}
                    onClick={() => set('times', d.times.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            <button
              type="button"
              className="btn"
              disabled={d.times.length >= 8}
              onClick={() => set('times', [...d.times, '12:00'])}
            >
              Add time
            </button>
          </div>
          {timesError && <span className="error small">{timesError}</span>}
        </Field>

        <div className="chips">
          <label className="check">
            <input type="checkbox" checked={d.remindersOn} onChange={e => set('remindersOn', e.target.checked)} />
            Remind the patient when a dose is due
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={d.requiresGlucose}
              onChange={e => set('requiresGlucose', e.target.checked)}
            />
            Require a blood glucose reading before logging a dose
          </label>
        </div>

        <Field label="Instructions for the patient">
          <textarea rows={2} value={d.instructions} onChange={e => set('instructions', e.target.value)} />
        </Field>
        <div className="medsheet__grid medsheet__grid--2">
          <Field label="Side effects (one per line)">
            <textarea rows={6} value={d.sideEffects} onChange={e => set('sideEffects', e.target.value)} />
          </Field>
          <Field label="Contraindications (one per line)">
            <textarea rows={6} value={d.contraindications} onChange={e => set('contraindications', e.target.value)} />
          </Field>
        </div>

        {overlaps.length > 0 && (
          <div className="banner banner--info" role="status">
            Already active for {patientName}: {overlaps.map(o => `${o.name} ${o.dose}`).join(', ')}. Check for a
            duplicate before saving.
          </div>
        )}
        {error && <p className="error">{error}</p>}

        <footer className="sheet__foot">
          <p className="muted small">
            Saving records this in the audit trail. Dose reminders start at the next scheduled time.
          </p>
          <button
            type="submit"
            className="btn btn--primary btn--lg"
            disabled={busy || !d.name.trim() || !d.dose.trim() || !!timesError}
          >
            {existing ? 'Save changes' : 'Add medication'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {children}
    </div>
  );
}
