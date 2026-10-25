import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { LibraryEntry } from '../module_bindings/types';
import { sectionsFor, useData } from '../lib/data';
import { timeAgo } from '../lib/format';
import { LIB_KIND_LABEL, rangeText, relatedEntries } from '../lib/library';

/** The side library: full reference for one entry, audience-aware. */
export function LibraryDrawer({
  slug,
  audience,
  onNavigate,
  onClose,
  onEdit,
}: {
  slug: string;
  audience: 'nurse' | 'patient';
  onNavigate: (slug: string) => void;
  onClose: () => void;
  onEdit?: (entry: LibraryEntry) => void;
}) {
  const data = useData();
  const importFda = useReducer(reducers.importFdaLabel);
  const delEntry = useReducer(reducers.deleteLibraryEntry);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entry = data.libraryEntries.find(e => e.slug === slug);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="libdrawer-backdrop" onClick={onClose}>
      <aside className="libdrawer" role="dialog" aria-label="Medical library" onClick={e => e.stopPropagation()}>
        {!entry ? (
          <div className="libdrawer__inner">
            <p className="muted">No library entry for this term yet.</p>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <header className="libdrawer__head">
              <div>
                <div className="kicker">
                  {LIB_KIND_LABEL[entry.kind] ?? entry.kind}
                  {entry.curated ? ' · Curated reference' : ' · Care-team entry'}
                </div>
                <h2 className="libdrawer__title">{entry.name}</h2>
                {entry.category && <div className="muted small">{entry.category}</div>}
              </div>
              <button className="btn btn--ghost" onClick={onClose}>
                Close
              </button>
            </header>

            <div className="libdrawer__body">
              <p className="libdrawer__summary">
                {audience === 'patient' ? entry.patientSummary || entry.summary : entry.summary}
              </p>

              {entry.kind === 'lab' && audience === 'nurse' && (
                <p className="libdrawer__range mono small">
                  Reference {rangeText(entry) || 'not defined'}
                  {entry.criticalLow != null && ` · critical < ${entry.criticalLow}`}
                  {entry.criticalHigh != null && ` · critical ≥ ${entry.criticalHigh}`}
                </p>
              )}

              {sectionsFor(data, entry.id)
                .filter(s => audience === 'nurse' || s.patient)
                .map(s => (
                  <section key={String(s.id)} className="libsection">
                    <h3 className="libsection__head">{s.heading}</h3>
                    <p className="libsection__body">{s.body}</p>
                  </section>
                ))}

              {relatedEntries(data, entry).length > 0 && (
                <div className="libdrawer__related">
                  <div className="sbar__label">Related</div>
                  <div className="chips">
                    {relatedEntries(data, entry).map(r => (
                      <button key={r.slug} className="chip" onClick={() => onNavigate(r.slug)}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="libdrawer__source small muted">
                Source:{' '}
                <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                  {entry.sourceName}
                </a>
                {audience === 'nurse' && <> · updated {timeAgo(entry.updatedAt)} by {entry.updatedBy}</>}
              </p>

              {audience === 'nurse' && (
                <div className="libdrawer__actions">
                  {onEdit && (
                    <button className="btn" disabled={busy} onClick={() => onEdit(entry)}>
                      Edit
                    </button>
                  )}
                  {entry.kind === 'medication' && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await importFda({ entryId: entry.id });
                          setNote('Import requested. Label sections will appear in a few seconds.');
                        })
                      }
                    >
                      Import FDA label
                    </button>
                  )}
                  {!entry.curated && (
                    <button
                      className="btn btn--danger"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`Delete the "${entry.name}" library entry?`)) return;
                        void run(async () => {
                          await delEntry({ id: entry.id });
                          onClose();
                        });
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}

              {note && <p className="small muted">{note}</p>}
              {error && <p className="error small">{error}</p>}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
