import { useMemo, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Patient } from '../module_bindings/types';
import { activeAlertFor, symptomsFor, useData, vitalsFor } from '../lib/data';
import { daysSince, timeAgo } from '../lib/format';
import { TwinViewer, type TwinPin, type TwinPointer } from '../twin/TwinViewer';
import { regionLabel } from '../twin/bodyModel';
import { PodVitals } from '../components/PodVitals';
import { SymptomSheet, type SymptomDraft } from './SymptomSheet';

export function PatientView({ patient }: { patient: Patient }) {
  const data = useData();
  const logSymptom = useReducer(reducers.logSymptom);
  const updatePointer = useReducer(reducers.updatePointer);
  const [pending, setPending] = useState<{ region: string; point: [number, number, number] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const symptoms = symptomsFor(data, patient.id);
  const vitals = vitalsFor(data, patient.id);
  const alert = activeAlertFor(data, patient.id);
  const day = daysSince(patient.surgeryAt);
  const firstName = patient.name.split(' ')[0];

  const pins: TwinPin[] = useMemo(() => {
    const list: TwinPin[] = symptoms.slice(0, 12).map(s => ({
      id: String(s.id),
      x: s.x,
      y: s.y,
      z: s.z,
      severity: s.severity,
      label: `${regionLabel(s.region)} · ${s.severity}/10`,
    }));
    if (pending) {
      list.push({
        id: 'pending',
        x: pending.point[0],
        y: pending.point[1],
        z: pending.point[2],
        severity: 0,
        label: regionLabel(pending.region),
        pending: true,
      });
    }
    return list;
  }, [symptoms, pending]);

  const pointers: TwinPointer[] = data.presence
    .filter(p => p.patientId === patient.id && p.pointing && p.role === 'nurse')
    .map(p => ({ id: p.identity.toHexString(), name: p.name, x: p.x, y: p.y, z: p.z, color: '#3e63dd' }));

  const submit = (d: SymptomDraft) => {
    if (!pending) return;
    const f = parseFloat(d.bodyTempF);
    const bodyTempC = Number.isFinite(f) && f > 90 ? ((f - 32) * 5) / 9 : 0;
    void logSymptom({
      patientId: patient.id,
      region: pending.region,
      x: pending.point[0],
      y: pending.point[1],
      z: pending.point[2],
      onset: d.onset,
      provocation: d.provocation,
      quality: d.quality.toLowerCase(),
      radiation: d.radiation,
      severity: d.severity,
      timing: d.timing,
      swelling: d.swelling,
      warmth: d.warmth,
      redness: d.redness,
      shortnessOfBreath: d.shortnessOfBreath,
      chestPain: d.chestPain,
      bodyTempC,
      notes: d.notes,
      source: 'tap',
    }).catch(e => setToast(`Could not send: ${String(e)}`));
    setPending(null);
    setToast('Sent to your nurse');
    window.setTimeout(() => setToast(null), 2500);
  };

  const status = (() => {
    if (!alert) return null;
    if (alert.priority === 'emergency' && alert.status === 'open') return 'emergency';
    if (alert.status === 'open') return 'notified';
    return 'reviewed';
  })();

  return (
    <div className="patient">
      <header className="topbar">
        <div className="brand">TwinCare</div>
        <div className="topbar__who">
          <strong>Hi {firstName}</strong>
          <span className="muted">
            Day {day} after {patient.side} knee replacement
          </span>
        </div>
        <span className={`dot ${data.connected ? 'dot--on' : ''}`} title={data.connected ? 'Live' : 'Offline'} />
      </header>

      {status === 'emergency' && (
        <div className="banner banner--emergency banner--sticky">
          <strong>Call 911 now</strong> if you have chest pain or trouble breathing. Your nurse has been alerted.
        </div>
      )}
      {status === 'notified' && (
        <div className="banner banner--info">Your care team has been notified and will review your check-in.</div>
      )}
      {status === 'reviewed' && (
        <div className="banner banner--ok">
          {alert?.ackedByName || 'Your nurse'} has reviewed your check-in
          {alert?.status === 'escalated' ? ' and is contacting your surgeon.' : '.'}
        </div>
      )}

      <main className="patient__main">
        <section className="patient__twin">
          <div className="hint">Tap where it hurts</div>
          <TwinViewer
            side={patient.side === 'left' ? 'left' : 'right'}
            pins={pins}
            pointers={pointers}
            onTap={(region, point) => setPending({ region, point })}
            onHover={p =>
              void updatePointer({
                patientId: patient.id,
                x: p?.[0] ?? 0,
                y: p?.[1] ?? 0,
                z: p?.[2] ?? 0,
                pointing: !!p,
              }).catch(() => {})
            }
          />
        </section>

        <aside className="patient__side">
          <PodVitals vitals={vitals} />

          <div className="card">
            <div className="card__title">Your check-ins</div>
            {symptoms.length === 0 ? (
              <p className="muted">No check-ins yet. Tap your body where you feel something.</p>
            ) : (
              <ul className="list">
                {symptoms.slice(0, 6).map(s => (
                  <li key={String(s.id)} className="list__row">
                    <span className={`sev sev--${s.severity >= 7 ? 'hi' : s.severity >= 4 ? 'mid' : 'lo'}`}>
                      {s.severity}
                    </span>
                    <span>
                      {regionLabel(s.region)}
                      <span className="muted small"> · {s.quality || 'pain'}</span>
                    </span>
                    <span className="muted small">{timeAgo(s.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </main>

      {pending && <SymptomSheet region={pending.region} onCancel={() => setPending(null)} onSubmit={submit} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
