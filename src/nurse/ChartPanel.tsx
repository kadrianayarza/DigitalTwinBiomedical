import { useMemo, useState, type FormEvent } from 'react';
import { Timestamp } from 'spacetimedb';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { devicesFor, historyFor, labsFor, useData } from '../lib/data';
import { formatLabValue, timeAgo } from '../lib/format';
import { DevicesSection } from '../components/DevicesCard';
import { LibLink } from '../library/LibLink';
import {
  FLAG_LABEL,
  FLAG_TONE,
  HISTORY_CATEGORIES,
  HISTORY_LABEL,
  labFlag,
  matchEntry,
  rangeText,
} from '../lib/library';
import { Disclosure, Hex, Panel } from '../components/ui';

/** Patient chart: lab results and health history, entered by the care team. */
export function ChartPanel({
  patientId,
  patientName,
  onOpenLibrary,
}: {
  patientId: bigint;
  patientName: string;
  onOpenLibrary: (slug: string) => void;
}) {
  const data = useData();
  const labs = labsFor(data, patientId);
  const history = historyFor(data, patientId);
  const devices = devicesFor(data, patientId);

  return (
    <Panel title="Chart" code={`${labs.length} labs · ${history.length} history · ${devices.length} devices`} className="chart" collapsible>
      <Disclosure label="Lab results" count={labs.length}>
        <LabsTab patientId={patientId} patientName={patientName} onOpenLibrary={onOpenLibrary} />
      </Disclosure>
      <Disclosure label="Health history" count={history.length}>
        <HistoryTab patientId={patientId} onOpenLibrary={onOpenLibrary} />
      </Disclosure>
      <Disclosure label="Devices and equipment" count={devices.length}>
        <DevicesSection patientId={patientId} patientName={patientName} mode="nurse" onOpenLibrary={onOpenLibrary} />
      </Disclosure>
    </Panel>
  );
}

function LabsTab({
  patientId,
  patientName,
  onOpenLibrary,
}: {
  patientId: bigint;
  patientName: string;
  onOpenLibrary: (slug: string) => void;
}) {
  const data = useData();
  const addLab = useReducer(reducers.addLabResult);
  const delLab = useReducer(reducers.deleteLabResult);
  const labs = labsFor(data, patientId);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState({ name: '', value: '', unit: '', notes: '' });

  const labEntries = useMemo(
    () => data.libraryEntries.filter(e => e.kind === 'lab'),
    [data.libraryEntries]
  );
  const matched = d.name.trim() ? matchEntry(labEntries, d.name.trim(), 'lab') : undefined;
  const preview = (() => {
    const v = parseFloat(d.value);
    if (!matched || !Number.isFinite(v)) return '';
    return labFlag(v, matched);
  })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = parseFloat(d.value);
    if (!Number.isFinite(v)) {
      setError('Enter the result as a number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addLab({
        patientId,
        name: d.name,
        value: v,
        unit: d.unit || matched?.unit || '',
        notes: d.notes,
        resultedAt: new Timestamp(BigInt(Date.now()) * 1000n),
      });
      setD({ name: '', value: '', unit: '', notes: '' });
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {labs.length === 0 ? (
        <p className="muted small">No lab results recorded for {patientName} yet.</p>
      ) : (
        <ul className="chart__labs">
          {labs.map(l => (
            <li key={String(l.id)} className="chart__lab">
              <Hex tone={FLAG_TONE[l.flag] ?? 'off'} label={FLAG_LABEL[l.flag] ?? 'Recorded'} />
              <span className="chart__labmain">
                {l.slug ? (
                  <LibLink slug={l.slug} onOpen={onOpenLibrary}>
                    {l.name}
                  </LibLink>
                ) : (
                  <strong>{l.name}</strong>
                )}
                <strong className="mono">
                  {formatLabValue(l.value)} {l.unit}
                </strong>
                {l.notes && <span className="muted small">{l.notes}</span>}
              </span>
              <span className="chart__labmeta muted small">
                {timeAgo(l.resultedAt)} · {l.enteredBy}
              </span>
              <button
                className="btn btn--ghost chart__del"
                title="Remove result"
                onClick={() => void delLab({ id: l.id }).catch(() => {})}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="labform" onSubmit={submit}>
          <datalist id="labnames">
            {labEntries.map(e => (
              <option key={e.slug} value={e.name} />
            ))}
          </datalist>
          <div className="labform__grid">
            <input
              className="input"
              list="labnames"
              placeholder="Lab, e.g. Potassium"
              value={d.name}
              onChange={e => setD(p => ({ ...p, name: e.target.value }))}
              required
            />
            <input
              className="input"
              inputMode="decimal"
              placeholder="Result"
              value={d.value}
              onChange={e => setD(p => ({ ...p, value: e.target.value }))}
              required
            />
            <input
              className="input"
              placeholder={matched?.unit || 'Unit'}
              value={d.unit}
              onChange={e => setD(p => ({ ...p, unit: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Notes (optional)"
              value={d.notes}
              onChange={e => setD(p => ({ ...p, notes: e.target.value }))}
            />
          </div>
          <div className="labform__row">
            <span className="small muted">
              {matched ? (
                <>
                  {matched.name} · reference {rangeText(matched) || 'not defined'}
                  {preview && (
                    <>
                      {' '}
                      · flags as <strong>{FLAG_LABEL[preview]}</strong>
                    </>
                  )}
                </>
              ) : (
                'Unrecognized lab name: it will be stored without a reference range.'
              )}
            </span>
            <span className="labform__buttons">
              <button type="button" className="btn btn--ghost" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Save result
              </button>
            </span>
          </div>
          {error && <p className="error small">{error}</p>}
        </form>
      ) : (
        <div className="chart__bar">
          <span className="small muted">Results flag against the library’s reference ranges.</span>
          <button className="btn" onClick={() => setAdding(true)}>
            Enter lab result
          </button>
        </div>
      )}
    </>
  );
}

function HistoryTab({
  patientId,
  onOpenLibrary,
}: {
  patientId: bigint;
  onOpenLibrary: (slug: string) => void;
}) {
  const data = useData();
  const save = useReducer(reducers.saveHistoryItem);
  const del = useReducer(reducers.deleteHistoryItem);
  const items = historyFor(data, patientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState({ category: 'medical', title: '', detail: '', whenText: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save({
        id: 0n,
        patientId,
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
    <>
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
                  </span>
                  {h.whenText && <span className="muted small mono">{h.whenText}</span>}
                  <button
                    className="btn btn--ghost chart__del"
                    title="Remove"
                    onClick={() => void del({ id: h.id }).catch(() => {})}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {items.length === 0 && <p className="muted small">No history recorded yet.</p>}
    </>
  );
}
