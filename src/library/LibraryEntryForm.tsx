import { useState, type FormEvent, type ReactNode } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { LibraryEntry } from '../module_bindings/types';
import { sectionsFor, useData } from '../lib/data';
import { LIB_KINDS, LIB_KIND_LABEL } from '../lib/library';

type SectionDraft = { heading: string; body: string; patient: boolean };

type Draft = {
  kind: string;
  name: string;
  aliases: string;
  category: string;
  summary: string;
  patientSummary: string;
  unit: string;
  refLow: string;
  refHigh: string;
  criticalLow: string;
  criticalHigh: string;
  related: string;
  sourceName: string;
  sourceUrl: string;
  sections: SectionDraft[];
};

const BLANK: Draft = {
  kind: 'medication',
  name: '',
  aliases: '',
  category: '',
  summary: '',
  patientSummary: '',
  unit: '',
  refLow: '',
  refHigh: '',
  criticalLow: '',
  criticalHigh: '',
  related: '',
  sourceName: '',
  sourceUrl: '',
  sections: [
    { heading: 'Used for', body: '', patient: true },
    { heading: 'Common side effects', body: '', patient: true },
    { heading: 'Clinical notes', body: '', patient: false },
  ],
};

const fromEntry = (e: LibraryEntry): Draft => ({
  kind: e.kind,
  name: e.name,
  aliases: e.aliases,
  category: e.category,
  summary: e.summary,
  patientSummary: e.patientSummary,
  unit: e.unit,
  refLow: e.refLow != null ? String(e.refLow) : '',
  refHigh: e.refHigh != null ? String(e.refHigh) : '',
  criticalLow: e.criticalLow != null ? String(e.criticalLow) : '',
  criticalHigh: e.criticalHigh != null ? String(e.criticalHigh) : '',
  related: e.related,
  sourceName: e.sourceName,
  sourceUrl: e.sourceUrl,
  sections: [],
});

/** Add or edit a library entry (nurse only). */
export function LibraryEntryForm({
  existing,
  onClose,
}: {
  existing?: LibraryEntry;
  onClose: () => void;
}) {
  const data = useData();
  const save = useReducer(reducers.saveLibraryEntry);
  const [d, setD] = useState<Draft>(() =>
    existing
      ? {
          ...fromEntry(existing),
          sections: sectionsFor(data, existing.id).map(s => ({
            heading: s.heading,
            body: s.body,
            patient: s.patient,
          })),
        }
      : BLANK
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }));
  const setSection = (i: number, patch: Partial<SectionDraft>) =>
    setD(prev => ({ ...prev, sections: prev.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const num = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save({
        id: existing?.id ?? 0n,
        kind: d.kind,
        name: d.name,
        aliases: d.aliases,
        category: d.category,
        summary: d.summary,
        patientSummary: d.patientSummary,
        unit: d.unit,
        refLow: num(d.refLow),
        refHigh: num(d.refHigh),
        criticalLow: num(d.criticalLow),
        criticalHigh: num(d.criticalHigh),
        related: d.related,
        sourceName: d.sourceName,
        sourceUrl: d.sourceUrl,
        sections: d.sections,
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
      <form className="sheet libsform" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <header className="sheet__head">
          <div>
            <div className="kicker">{existing ? 'Edit library entry' : 'New library entry'}</div>
            <h2 className="sheet__title">{d.name || 'Untitled entry'}</h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </header>

        <div className="libsform__kind chips">
          {LIB_KINDS.map(k => (
            <button
              type="button"
              key={k}
              className={`chip ${d.kind === k ? 'chip--on' : ''}`}
              onClick={() => set('kind', k)}
            >
              {LIB_KIND_LABEL[k] ?? k}
            </button>
          ))}
        </div>

        <div className="libsform__grid">
          <Field label="Name">
            <input
              className="input"
              value={d.name}
              onChange={e => set('name', e.target.value)}
              placeholder={
                d.kind === 'medication'
                  ? 'e.g. Ibuprofen'
                  : d.kind === 'lab'
                    ? 'e.g. Ferritin'
                    : d.kind === 'device'
                      ? 'e.g. Shower chair'
                      : 'e.g. Anemia'
              }
              required
            />
          </Field>
          <Field label="Aliases (comma-separated)">
            <input
              className="input"
              value={d.aliases}
              onChange={e => set('aliases', e.target.value)}
              placeholder="Brand names, common terms"
            />
          </Field>
          <Field label="Category">
            <input
              className="input"
              value={d.category}
              onChange={e => set('category', e.target.value)}
              placeholder={
                d.kind === 'medication' ? 'e.g. Analgesic · NSAID' : d.kind === 'device' ? 'e.g. Mobility' : 'e.g. General · CBC'
              }
            />
          </Field>
          <Field label="Unit (labs)">
            <input className="input" value={d.unit} onChange={e => set('unit', e.target.value)} placeholder="mg/dL" />
          </Field>
        </div>

        {d.kind === 'lab' && (
          <div className="libsform__grid libsform__grid--4">
            <Field label="Ref low">
              <input className="input" value={d.refLow} onChange={e => set('refLow', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Ref high">
              <input className="input" value={d.refHigh} onChange={e => set('refHigh', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Critical low">
              <input className="input" value={d.criticalLow} onChange={e => set('criticalLow', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Critical high">
              <input className="input" value={d.criticalHigh} onChange={e => set('criticalHigh', e.target.value)} inputMode="decimal" />
            </Field>
          </div>
        )}

        <div className="libsform__grid">
          <Field label="Clinician summary">
            <textarea
              value={d.summary}
              onChange={e => set('summary', e.target.value)}
              rows={2}
              placeholder="One or two sentences for the care team"
              required
            />
          </Field>
          <Field label="Plain-language summary (patients see this)">
            <textarea
              value={d.patientSummary}
              onChange={e => set('patientSummary', e.target.value)}
              rows={2}
              placeholder="One or two simple sentences"
              required
            />
          </Field>
        </div>

        <div className="libsform__grid libsform__grid--3">
          <Field label="Related slugs (comma-separated)">
            <input className="input" value={d.related} onChange={e => set('related', e.target.value)} placeholder="metformin, a1c" />
          </Field>
          <Field label="Source name">
            <input
              className="input"
              value={d.sourceName}
              onChange={e => set('sourceName', e.target.value)}
              placeholder="e.g. MedlinePlus (NLM)"
            />
          </Field>
          <Field label="Source URL (https)">
            <input
              className="input"
              value={d.sourceUrl}
              onChange={e => set('sourceUrl', e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>

        <div className="sbar__label">Sections</div>
        {d.sections.map((s, i) => (
          <div key={i} className="libsform__section">
            <div className="libsform__sectionhead">
              <input
                className="input"
                value={s.heading}
                onChange={e => setSection(i, { heading: e.target.value })}
                placeholder="Heading"
                required
              />
              <button
                type="button"
                className={`chip ${s.patient ? 'chip--on' : ''}`}
                aria-pressed={s.patient}
                onClick={() => setSection(i, { patient: !s.patient })}
                title="Patient-visible section"
              >
                {s.patient ? 'Patient-visible' : 'Clinician-only'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setD(prev => ({ ...prev, sections: prev.sections.filter((_, j) => j !== i) }))}
              >
                Remove
              </button>
            </div>
            <textarea
              value={s.body}
              onChange={e => setSection(i, { body: e.target.value })}
              rows={2}
              placeholder="One line per point"
              required
            />
          </div>
        ))}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setD(prev => ({ ...prev, sections: [...prev.sections, { heading: '', body: '', patient: false }] }))}
        >
          Add section
        </button>

        {error && <p className="error">{error}</p>}

        <footer className="sheet__foot">
          <p className="muted small">
            Entries are shared by the whole care team. Cite a public source when you can.
          </p>
          <button type="submit" className="btn btn--primary btn--lg" disabled={busy || !d.name.trim()}>
            {existing ? 'Save changes' : 'Add entry'}
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
