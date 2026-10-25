import { useMemo, useState } from 'react';
import type { LibraryEntry } from '../module_bindings/types';
import { useData } from '../lib/data';
import { LIB_KINDS, LIB_KIND_LABEL, searchLibrary } from '../lib/library';

/** Searchable reference library page for the nurse console. */
export function LibraryPage({
  onOpen,
  onNew,
  onClose,
}: {
  onOpen: (slug: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const data = useData();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');

  const entries = useMemo(
    () => searchLibrary(data.libraryEntries, query).filter(e => kind === 'all' || e.kind === kind),
    [data.libraryEntries, query, kind]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of data.libraryEntries) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [data.libraryEntries]);

  return (
    <div className="library">
      <header className="library__head">
        <div>
          <div className="kicker">Reference library</div>
          <h1 className="titlecard">Medications, labs, conditions, and devices</h1>
        </div>
        <div className="library__actions">
          <button className="btn btn--primary" onClick={onNew}>
            New entry
          </button>
          <button className="btn btn--ghost" onClick={onClose}>
            Back to patients
          </button>
        </div>
      </header>

      <div className="library__bar">
        <input
          className="input"
          placeholder="Search a name, brand, or topic — e.g. “apixaban”, “kidney”, “A1c”"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="chips">
          {['all', ...LIB_KINDS].map(k => (
            <button key={k} className={`chip ${kind === k ? 'chip--on' : ''}`} onClick={() => setKind(k)}>
              {k === 'all'
                ? `All (${data.libraryEntries.length})`
                : `${LIB_KIND_LABEL[k] ?? k} (${counts[k] ?? 0})`}
            </button>
          ))}
        </div>
      </div>

      <ul className="library__list">
        {entries.map(e => (
          <LibraryRow key={e.slug} entry={e} onOpen={() => onOpen(e.slug)} />
        ))}
        {entries.length === 0 && (
          <li className="muted library__empty">No entries match “{query}”.</li>
        )}
      </ul>
    </div>
  );
}

function LibraryRow({ entry, onOpen }: { entry: LibraryEntry; onOpen: () => void }) {
  return (
    <li>
      <button className="library__row" onClick={onOpen}>
        <span className={`library__kind library__kind--${entry.kind}`}>
          {(LIB_KIND_LABEL[entry.kind] ?? entry.kind).slice(0, 3)}
        </span>
        <span className="library__main">
          <strong>{entry.name}</strong>
          <span className="muted small">{entry.category || entry.summary}</span>
        </span>
        <span className="muted small">{entry.curated ? 'Curated' : 'Care team'}</span>
      </button>
    </li>
  );
}
