import { useState, type FormEvent } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Patient } from '../module_bindings/types';
import { devicesFor, useData } from '../lib/data';
import { timeAgo } from '../lib/format';
import { matchEntry } from '../lib/library';
import { LibLink } from '../library/LibLink';
import { Panel } from './ui';

type DeviceRow = ReturnType<typeof devicesFor>[number];
type Draft = { id: bigint; name: string; detail: string; sinceText: string };

const BLANK: Draft = { id: 0n, name: '', detail: '', sinceText: '' };

/**
 * Assistive devices and daily-living aids on one patient's chart. Shared by the patient
 * view (own equipment, delete only what they added) and the nurse chart (full control).
 */
export function DevicesSection({
  patientId,
  patientName,
  mode,
  onOpenLibrary,
}: {
  patientId: bigint;
  patientName: string;
  mode: 'patient' | 'nurse';
  onOpenLibrary: (slug: string) => void;
}) {
  const data = useData();
  const save = useReducer(reducers.saveAssistiveDevice);
  const del = useReducer(reducers.deleteAssistiveDevice);
  const confirm = useReducer(reducers.confirmAssistiveDevice);
  const devices = devicesFor(data, patientId);
  const [d, setD] = useState<Draft>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = d.id !== 0n;
  const deviceEntries = data.libraryEntries.filter(e => e.kind === 'device');
  const matched = d.name.trim() ? matchEntry(deviceEntries, d.name.trim(), 'device') : undefined;

  // Patients can change only the devices they added; the nurse can change anything.
  const canTouch = (x: DeviceRow) => mode === 'nurse' || x.createdBy === patientName;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save({
        id: d.id,
        patientId,
        name: d.name,
        detail: d.detail,
        sinceText: d.sinceText,
      });
      setD(BLANK);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="historyform">
        <form className="historyform__grid" onSubmit={submit}>
          <input
            className="input"
            list="devicenames"
            placeholder={editing ? 'Device name' : 'Add a device — e.g. Walker, Hearing aids, Home oxygen'}
            value={d.name}
            onChange={e => setD(p => ({ ...p, name: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Detail — e.g. 2 L/min, height, supplier (optional)"
            value={d.detail}
            onChange={e => setD(p => ({ ...p, detail: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Since — e.g. 2019 or after surgery"
            value={d.sinceText}
            onChange={e => setD(p => ({ ...p, sinceText: e.target.value }))}
          />
          <button className="btn btn--primary" disabled={busy || !d.name.trim()}>
            {editing ? 'Save' : 'Add'}
          </button>
        </form>
        <datalist id="devicenames">
          {deviceEntries.map(e => (
            <option key={e.slug} value={e.name} />
          ))}
        </datalist>
        <p className="muted small">
          {d.name.trim()
            ? matched
              ? `Will link to the ${matched.name} guide in the library.`
              : 'No specific guide for this one yet — the general equipment tips will show instead.'
            : 'Tap a device name to read how to use it safely.'}
        </p>
        {error && <p className="error small">{error}</p>}
      </div>

      {devices.length > 0 ? (
        <div className="historygroup">
          <div className="sbar__label">On the chart</div>
          <ul>
            {devices.map(x => (
              <li key={String(x.id)} className="historygroup__item">
                <span className="historygroup__main">
                  <LibLink slug={x.slug} onOpen={onOpenLibrary}>
                    {x.name}
                  </LibLink>
                  {x.detail && <span className="muted small">{x.detail}</span>}
                  {mode === 'patient' && !canTouch(x) && <span className="muted small">added by your care team</span>}
                  {mode === 'patient' && canTouch(x) && <span className="muted small">you added this</span>}
                  {mode === 'nurse' && x.createdBy !== 'Demo care team' && (
                    <span className="muted small">added by {x.createdBy}</span>
                  )}
                </span>
                <span className="muted small mono">
                  {x.sinceText}
                  {mode === 'nurse' && x.createdBy === 'Demo care team' ? ` · ${x.createdBy}` : ''}
                </span>
                {x.confirmedBy ? (
                  <span className="tag tag--ok" title={`Confirmed ${timeAgo(x.confirmedAt)}`}>
                    Confirmed
                  </span>
                ) : (
                  <button
                    className="chip chip--warn"
                    title="Confirm this device is in use"
                    onClick={() => void confirm({ id: x.id }).catch(() => {})}
                  >
                    Confirm
                  </button>
                )}
                {canTouch(x) && (
                  <>
                    <button
                      className="btn btn--ghost chart__del"
                      title="Edit this device"
                      onClick={() => setD({ id: x.id, name: x.name, detail: x.detail, sinceText: x.sinceText })}
                    >
                      ✎
                    </button>
                    <button
                      className="btn btn--ghost chart__del"
                      title="Remove"
                      onClick={() => void del({ id: x.id }).catch(() => {})}
                    >
                      ×
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted small">No devices recorded yet.</p>
      )}
    </>
  );
}

/** The patient-facing equipment card. */
export function DevicesCard({
  patient,
  onOpenLibrary,
}: {
  patient: Patient;
  onOpenLibrary: (slug: string) => void;
}) {
  const data = useData();
  const devices = devicesFor(data, patient.id);
  const unconfirmed = devices.filter(d => !d.confirmedBy).length;
  return (
    <Panel
      title="Your devices"
      code={
        devices.length === 0
          ? 'Yours to add'
          : unconfirmed > 0
            ? `${devices.length} on your chart · ${unconfirmed} to confirm`
            : `${devices.length} on your chart · all confirmed`
      }
      className="devicescard"
      collapsible
    >
      <p className="muted small">
        Walkers, hearing aids, oxygen — anything that helps you day to day. Tap a name once for a
        hint, twice for the full guide.
      </p>
      <DevicesSection
        patientId={patient.id}
        patientName={patient.name}
        mode="patient"
        onOpenLibrary={onOpenLibrary}
      />
    </Panel>
  );
}
