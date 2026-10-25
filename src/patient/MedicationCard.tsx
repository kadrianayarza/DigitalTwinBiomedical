import { useEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { MedDose, Medication, Patient } from '../module_bindings/types';
import { dosesFor, medicationsFor, useData } from '../lib/data';
import { clock, tsMs } from '../lib/format';
import {
  GLUCOSE_HIGH_MGDL,
  GLUCOSE_LOW_MGDL,
  isInsulin,
  patientMedicationInfo,
  upcomingSlots,
} from '../lib/meds';
import { Panel } from '../components/ui';

const ACTIONABLE_MS = 12 * 3_600_000;

type Permission = NotificationPermission | 'unsupported';
const notificationPermission = (): Permission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

/** Calls `onRemind` once per dose as it becomes due, and shows a system notification when allowed. */
export function useDoseReminders(patientId: bigint, onRemind: (message: string) => void) {
  const data = useData();
  const seen = useRef(new Set<string>());
  const doses = dosesFor(data, patientId);
  useEffect(() => {
    for (const d of doses) {
      const key = String(d.id);
      if (d.status !== 'due' || seen.current.has(key)) continue;
      seen.current.add(key);
      const m = data.medications.find(x => x.id === d.medicationId);
      if (!m?.active || !m.remindersOn) continue;
      const message = `Time for ${m.name}, ${m.dose}`;
      onRemind(message);
      if (notificationPermission() === 'granted') {
        new Notification('Medicine reminder', { body: message, tag: `dose-${key}` });
      }
    }
  }, [doses, data.medications, onRemind]);
}

export function MedicationCard({ patient }: { patient: Patient }) {
  const data = useData();
  const [permission, setPermission] = useState<Permission>(notificationPermission);
  const meds = medicationsFor(data, patient.id);
  if (meds.length === 0) return null;

  const doses = dosesFor(data, patient.id);
  const now = Date.now();
  const open = doses
    .filter(
      d =>
        (d.status === 'due' || (d.status === 'missed' && now - tsMs(d.scheduledFor) < ACTIONABLE_MS)) &&
        meds.some(m => m.id === d.medicationId)
    )
    .reverse();
  const upcoming = meds
    .flatMap(m => upcomingSlots(m, 24, now).map(t => ({ m, t })))
    .filter(x => !doses.some(d => d.medicationId === x.m.id && tsMs(d.scheduledFor) === x.t))
    .sort((a, b) => a.t - b.t)
    .slice(0, 5);

  return (
    <Panel
      title="Your medicines"
      code={open.length ? `${open.length} due` : `${meds.length} active`}
      className="medcard"
      collapsible
    >
      {open.map(d => (
        <DoseCheck key={String(d.id)} dose={d} med={meds.find(m => m.id === d.medicationId)!} />
      ))}

      {upcoming.length > 0 && (
        <>
          <div className="sbar__label">Coming up</div>
          <ul className="list">
            {upcoming.map(({ m, t }) => (
              <li key={`${m.id}-${t}`} className="list__row medcard__next">
                <span className="mono small">
                  {new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="list__main">
                  {m.name}
                  <span className="muted small">{m.dose}</span>
                </span>
                <span />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="medcard__drug-list">
        <div className="sbar__label">Learn about your medicines · tap a medicine or its arrow</div>
        {meds.map(m => {
          const info = patientMedicationInfo(m, data.libraryEntries, data.librarySections);
          return (
            <details
              key={String(m.id)}
              className="med__more medcard__drug"
            >
              <summary className="medcard__drug-summary">
                <span>{m.name}</span>
                <span className="small muted">
                  {m.dose} · {m.route}
                </span>
              </summary>
              <div className="medcard__drug-body">
                <section className="medcard__drug-section">
                  <div className="sbar__label">Why you may be taking it</div>
                  {info.patientSummary ? (
                    <p className="small">{info.patientSummary}</p>
                  ) : info.uses.length === 0 ? (
                    <p className="small muted">The reason for this prescription is not listed here. Ask your care team.</p>
                  ) : null}
                  {info.uses.length > 0 && (
                    <>
                      <p className="tiny muted">Common reasons include:</p>
                      <ul className="small">
                        {info.uses.map((use, i) => (
                          <li key={i}>{use}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {(info.patientSummary || info.uses.length > 0) && (
                    <p className="tiny muted">
                      These are common uses, not a confirmation of why it was prescribed to you. Your care team can
                      explain your specific treatment plan.
                    </p>
                  )}
                </section>

                {m.instructions && (
                  <section className="medcard__drug-section">
                    <div className="sbar__label">How to take it</div>
                    <p className="small">{m.instructions}</p>
                  </section>
                )}

                <div className="med__cols">
                  <section className="medcard__drug-section">
                    <div className="sbar__label">Side effects</div>
                    {info.sideEffects.length > 0 ? (
                      <ul className="small">
                        {info.sideEffects.map((effect, i) => (
                          <li key={i}>{effect}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="small muted">No side-effect information has been recorded.</p>
                    )}
                  </section>
                  <section className="medcard__drug-section">
                    <div className="sbar__label">Contraindications and cautions</div>
                    {info.contraindications.length > 0 ? (
                      <ul className="small med__contra">
                        {info.contraindications.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="small muted">
                        No contraindication information has been recorded. Ask your care team about your conditions,
                        allergies, and other medicines.
                      </p>
                    )}
                  </section>
                </div>

                {info.entry?.sourceUrl && (
                  <p className="tiny muted medcard__source">
                    Reference:{' '}
                    <a href={info.entry.sourceUrl} target="_blank" rel="noreferrer">
                      {info.entry.sourceName}
                    </a>
                  </p>
                )}
              </div>
            </details>
          );
        })}
        <p className="tiny muted">
          Do not stop or change a medicine without talking with your care team. Call 911 for a severe reaction or
          trouble breathing.
        </p>
      </div>

      {permission === 'default' && (
        <button className="btn btn--ghost" onClick={() => void Notification.requestPermission().then(setPermission)}>
          Turn on dose reminders
        </button>
      )}
    </Panel>
  );
}

function DoseCheck({ dose, med }: { dose: MedDose; med: Medication }) {
  const logDose = useReducer(reducers.logDose);
  const [glucose, setGlucose] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const g = parseFloat(glucose);
  const hasG = Number.isFinite(g) && g > 0;
  const low = hasG && g < GLUCOSE_LOW_MGDL;
  const high = hasG && g >= GLUCOSE_HIGH_MGDL;
  const needsG = med.requiresGlucose;

  const send = (status: 'taken' | 'skipped') => {
    setBusy(true);
    setError(null);
    logDose({ doseId: dose.id, status, glucoseMgDl: hasG ? g : 0, note: '' })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={`dose ${dose.status === 'missed' ? 'dose--missed' : ''}`}>
      <div className="dose__head">
        <div>
          <strong>{med.name}</strong>
          <div className="mono small muted">
            {med.dose} · {dose.status === 'missed' ? 'missed' : 'due'} {clock(dose.scheduledFor)}
          </div>
        </div>
        {isInsulin(med.kind) && <span className="tag tag--insulin">Insulin</span>}
      </div>
      {med.instructions && <p className="small muted dose__instr">{med.instructions}</p>}

      {needsG && (
        <label className="field">
          <span className="field__label">Blood sugar now (mg/dL)</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder="e.g. 120"
            value={glucose}
            onChange={e => setGlucose(e.target.value)}
          />
        </label>
      )}
      {low && (
        <div className="banner banner--emergency" role="alert">
          <span className="banner__title">Low blood sugar</span>
          <span>
            Follow your low blood sugar plan now, and check with your care team before taking insulin. Your nurse is
            alerted when you send this.
          </span>
        </div>
      )}
      {high && (
        <div className="banner banner--info" role="status">
          Your blood sugar is high. Your nurse is alerted when you send this. If you are vomiting, very drowsy, or have
          trouble breathing, call 911.
        </div>
      )}
      {error && <p className="error small">{error}</p>}

      <div className="dose__actions">
        <button className="btn btn--primary" disabled={busy || (needsG && !hasG)} onClick={() => send('taken')}>
          {dose.status === 'missed' ? 'I took it late' : 'I took it'}
        </button>
        <button className="btn btn--ghost" disabled={busy} onClick={() => send('skipped')}>
          Skip
        </button>
      </div>
    </div>
  );
}
