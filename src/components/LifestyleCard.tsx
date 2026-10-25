import { useState, type FormEvent } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { lifestyleFor, useData } from '../lib/data';
import { timeAgo } from '../lib/format';
import { Panel } from './ui';

type Kind = 'diet' | 'sleep';

const COPY: Record<Kind, { title: string; code: string; placeholder: string; amount: string }> = {
  diet: {
    title: 'Diet',
    code: 'Meals and fluids',
    placeholder: 'e.g. Chicken soup and crackers',
    amount: 'Amount — e.g. 2 cups',
  },
  sleep: {
    title: 'Sleep',
    code: 'Rest',
    placeholder: 'e.g. Slept through, woke once at 3am',
    amount: 'How rested — e.g. refreshed',
  },
};

/** Diet or sleep log. Anyone on the care team, and the patient, can add entries. */
export function LifestyleCard({
  patientId,
  kind,
  collapsible = true,
}: {
  patientId: bigint;
  kind: Kind;
  collapsible?: boolean;
}) {
  const data = useData();
  const save = useReducer(reducers.saveLifestyleEntry);
  const del = useReducer(reducers.deleteLifestyleEntry);
  const copy = COPY[kind];
  const entries = lifestyleFor(data, patientId, kind);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState({ summary: '', amount: '', hours: '', whenText: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const hours = parseFloat(d.hours);
      await save({
        id: 0n,
        patientId,
        kind,
        summary: d.summary,
        amount: d.amount,
        hours: kind === 'sleep' && Number.isFinite(hours) ? hours : 0,
        whenText: d.whenText,
        source: 'form',
      });
      setD({ summary: '', amount: '', hours: '', whenText: '' });
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={copy.title}
      code={entries.length === 0 ? copy.code : `${entries.length} logged`}
      className={`lifestyle lifestyle--${kind}`}
      collapsible={collapsible}
    >
      {entries.length === 0 ? (
        <p className="muted small">
          Nothing logged yet. Add an entry, or just say it to the assistant and confirm it.
        </p>
      ) : (
        <ul className="lifestyle__list">
          {entries.slice(0, 8).map(entry => (
            <li key={String(entry.id)} className="lifestyle__row">
              <span className="lifestyle__main">
                <strong>{entry.summary}</strong>
                <span className="muted small">
                  {[
                    entry.amount,
                    kind === 'sleep' && entry.hours > 0 && `${entry.hours} h`,
                    entry.whenText,
                    entry.source === 'voice' && 'from the assistant',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="muted small mono">{timeAgo(entry.createdAt)}</span>
              <button
                className="btn btn--ghost lifestyle__del"
                title="Remove entry"
                onClick={() => void del({ id: entry.id }).catch(() => {})}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="lifestyle__form" onSubmit={submit}>
          <input
            className="input"
            placeholder={copy.placeholder}
            value={d.summary}
            onChange={e => setD(p => ({ ...p, summary: e.target.value }))}
            required
          />
          <div className="lifestyle__grid">
            <input
              className="input"
              placeholder={copy.amount}
              value={d.amount}
              onChange={e => setD(p => ({ ...p, amount: e.target.value }))}
            />
            {kind === 'sleep' && (
              <input
                className="input"
                inputMode="decimal"
                placeholder="Hours slept"
                value={d.hours}
                onChange={e => setD(p => ({ ...p, hours: e.target.value }))}
              />
            )}
            <input
              className="input"
              placeholder="When — e.g. breakfast, last night"
              value={d.whenText}
              onChange={e => setD(p => ({ ...p, whenText: e.target.value }))}
            />
          </div>
          <div className="lifestyle__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy || !d.summary.trim()}>
              Save
            </button>
          </div>
          {error && <p className="error small">{error}</p>}
        </form>
      ) : (
        <div className="lifestyle__bar">
          <span className="muted small">
            {kind === 'diet' ? 'Meals, snacks, and how much was drunk.' : 'Hours slept and how rested they feel.'}
          </span>
          <button className="btn" onClick={() => setAdding(true)}>
            Add entry
          </button>
        </div>
      )}
    </Panel>
  );
}
