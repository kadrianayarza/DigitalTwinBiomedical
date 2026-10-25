import { useState, type FormEvent } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Patient } from '../module_bindings/types';
import { historyFor, useData } from '../lib/data';
import { LibLink } from '../library/LibLink';
import { HISTORY_CATEGORIES, HISTORY_LABEL } from '../lib/library';
import { Panel } from '../components/ui';

type HistoryRow = ReturnType<typeof historyFor>[number];

/** Health history the patient can read and add to themselves. */
export function HistoryCard({
  patient,
  onOpenLibrary,
}: {
  patient: Patient;
  onOpenLibrary: (slug: string) => void;
}) {
  const data = useData();
  const save = useReducer(reducers.saveHistoryItem);
  const del = useReducer(reducers.deleteHistoryItem);
  const items = historyFor(data, patient.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState({ category: 'medical', title: '', detail: '', whenText: '' });

  // Items the patient added themselves, by hand or through the voice assistant.
  const isMine = (h: HistoryRow) => h.createdBy === patient.name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save({
        id: 0n,
        patientId: patient.id,
        category: d.category,
        title: d.title,
        detail: d.detail,
        whenText: d.whenText,
      });
      setD(p => ({ ...p, title: '', detail: '', whenText: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Your history"
      code={items.length === 0 ? 'Yours to add' : `${items.length} note${items.length === 1 ? '' : 's'}`}
      className="historycard"
      collapsible
    >
      <p className="muted small">
        Allergies, past conditions, family and social history. Add anything you remember, or just tell the
        assistant — your care team sees it in your chart.
      </p>

      <div className="historyform">
        <div className="chips">
          {HISTORY_CATEGORIES.map(c => (
            <button
              key={c}
              className={`chip ${d.category === c ? 'chip--on' : ''}`}
              onClick={() => setD(p => ({ ...p, category: c }))}
            >
              {HISTORY_LABEL[c]}
            </button>
          ))}
        </div>
        <form className="historyform__grid" onSubmit={submit}>
          <input
            className="input"
            placeholder={`Add to ${HISTORY_LABEL[d.category]?.toLowerCase() ?? 'history'} — e.g. ${
              d.category === 'allergy' ? 'Penicillin: hives' : d.category === 'social' ? 'Lives with spouse' : 'Type 2 diabetes'
            }`}
            value={d.title}
            onChange={e => setD(p => ({ ...p, title: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Detail (optional)"
            value={d.detail}
            onChange={e => setD(p => ({ ...p, detail: e.target.value }))}
          />
          <input
            className="input"
            placeholder="When — e.g. 2019"
            value={d.whenText}
            onChange={e => setD(p => ({ ...p, whenText: e.target.value }))}
          />
          <button className="btn btn--primary" disabled={busy || !d.title.trim()}>
            Add
          </button>
        </form>
        {error && <p className="error small">{error}</p>}
      </div>

      {HISTORY_CATEGORIES.map(c => {
        const rows = items.filter(h => h.category === c);
        if (rows.length === 0) return null;
        return (
          <div key={c} className="historygroup">
            <div className="sbar__label">{HISTORY_LABEL[c]}</div>
            <ul>
              {rows.map(h => (
                <li key={String(h.id)} className="historygroup__item">
                  <span className="historygroup__main">
                    {h.slug ? (
                      <LibLink slug={h.slug} onOpen={onOpenLibrary}>
                        {h.title}
                      </LibLink>
                    ) : (
                      <strong>{h.title}</strong>
                    )}
                    {h.detail && <span className="muted small">{h.detail}</span>}
                    {isMine(h) && <span className="muted small">you added this</span>}
                  </span>
                  {h.whenText && <span className="muted small mono">{h.whenText}</span>}
                  {isMine(h) && (
                    <button
                      className="btn btn--ghost chart__del"
                      title="Remove this note"
                      onClick={() => void del({ id: h.id }).catch(() => {})}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {items.length === 0 && <p className="muted small">Nothing recorded yet.</p>}
    </Panel>
  );
}
