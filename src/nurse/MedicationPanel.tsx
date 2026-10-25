import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { MedDose, Medication } from '../module_bindings/types';
import { dosesFor, medicationsFor, useData } from '../lib/data';
import { clock, timeAgo } from '../lib/format';
import {
  DOSE_LABEL,
  DOSE_TONE,
  MED_KIND_LABEL,
  glucoseTone,
  isInsulin,
  splitLines,
  upcomingSlots,
  utcLabel,
} from '../lib/meds';
import { Hex, Panel } from '../components/ui';
import { MedicationSheet } from './MedicationSheet';

export function MedicationPanel({ patientId, patientName }: { patientId: bigint; patientName: string }) {
  const data = useData();
  const stop = useReducer(reducers.stopMedication);
  const [editing, setEditing] = useState<Medication | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meds = medicationsFor(data, patientId);
  const doses = dosesFor(data, patientId);
  const logged = doses.filter(d => d.status !== 'due');
  const lastGlucose = doses.find(d => d.glucoseMgDl > 0);
  const nameOf = (d: MedDose) => data.medications.find(m => m.id === d.medicationId)?.name ?? 'Medication';

  return (
    <Panel title="Medications" code={`${meds.length} active`} className="meds" collapsible>
      <div className="meds__bar">
        <span className="small muted">
          {lastGlucose ? (
            <>
              Last glucose{' '}
              <strong className={`glucose glucose--${glucoseTone(lastGlucose.glucoseMgDl)}`}>
                {Math.round(lastGlucose.glucoseMgDl)} mg/dL
              </strong>{' '}
              · {timeAgo(lastGlucose.loggedAt ?? lastGlucose.scheduledFor)}
            </>
          ) : (
            'No glucose readings yet'
          )}
        </span>
        <button className="btn" onClick={() => setEditing('new')}>
          Add medication
        </button>
      </div>
      {error && <p className="error small">{error}</p>}

      {meds.length === 0 ? (
        <p className="muted">No active medications.</p>
      ) : (
        <ul className="meds__list">
          {meds.map(m => (
            <MedRow
              key={String(m.id)}
              med={m}
              doses={doses.filter(d => d.medicationId === m.id)}
              onEdit={() => setEditing(m)}
              onStop={() => {
                if (!confirm(`Stop ${m.name} for ${patientName}?`)) return;
                setError(null);
                void stop({ id: m.id }).catch(e => setError(e instanceof Error ? e.message : String(e)));
              }}
            />
          ))}
        </ul>
      )}

      {logged.length > 0 && (
        <>
          <div className="sbar__label meds__loghead">Dose log</div>
          <ul className="list">
            {logged.slice(0, 8).map(d => (
              <li key={String(d.id)} className="list__row">
                <Hex tone={DOSE_TONE[d.status] ?? 'off'} label={DOSE_LABEL[d.status]} />
                <span className="list__main">
                  <strong>{nameOf(d)}</strong>
                  <span className="muted small">
                    {[
                      DOSE_LABEL[d.status],
                      d.glucoseMgDl > 0 && `glucose ${Math.round(d.glucoseMgDl)} mg/dL`,
                      d.note,
                      d.loggedBy && `by ${d.loggedBy}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="mono muted small">{clock(d.scheduledFor)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <MedicationSheet
          patientId={patientId}
          patientName={patientName}
          existing={editing === 'new' ? undefined : editing}
          others={meds}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

function MedRow({
  med,
  doses,
  onEdit,
  onStop,
}: {
  med: Medication;
  doses: MedDose[];
  onEdit: () => void;
  onStop: () => void;
}) {
  const logged = doses.filter(d => d.status !== 'due');
  const taken = logged.filter(d => d.status === 'taken').length;
  const missed = logged.filter(d => d.status === 'missed').length;
  const due = doses.find(d => d.status === 'due');
  const next = upcomingSlots(med, 48)[0];
  const sideEffects = splitLines(med.sideEffects);
  const contraindications = splitLines(med.contraindications);

  return (
    <li className="med">
      <div className="med__head">
        <div className="med__title">
          <strong>{med.name}</strong>
          <span className="mono small muted">
            {med.dose} · {med.route}
          </span>
        </div>
        <span className={`tag ${isInsulin(med.kind) ? 'tag--insulin' : ''}`}>{MED_KIND_LABEL[med.kind] ?? med.kind}</span>
      </div>

      <div className="med__times">
        {med.scheduleTimes.split(',').map(t => (
          <span key={t} className="med__time mono">
            {t}
          </span>
        ))}
        {med.tzOffsetMin !== new Date().getTimezoneOffset() && (
          <span className="med__time mono" title="Schedule time zone differs from your clock">
            {utcLabel(med.tzOffsetMin)}
          </span>
        )}
        <span className="small muted">
          {due
            ? `Due now (${clock(due.scheduledFor)})`
            : next
              ? `Next ${new Date(next).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
              : ''}
          {med.remindersOn ? ' · reminders on' : ' · reminders off'}
          {med.requiresGlucose && ' · glucose check'}
        </span>
      </div>

      <div className="small muted">
        {logged.length
          ? `${taken} of ${logged.length} doses taken in the last 7 days${missed ? ` · ${missed} missed` : ''}`
          : 'No doses logged yet'}
        {' · '}by {med.prescribedBy}
      </div>

      <details className="med__more">
        <summary>Instructions, side effects, contraindications</summary>
        {med.instructions && <p className="small">{med.instructions}</p>}
        <div className="med__cols">
          <div>
            <div className="sbar__label">Side effects</div>
            {sideEffects.length ? (
              <ul className="small">
                {sideEffects.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : (
              <p className="small muted">None recorded</p>
            )}
          </div>
          <div>
            <div className="sbar__label">Contraindications</div>
            {contraindications.length ? (
              <ul className="small med__contra">
                {contraindications.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : (
              <p className="small muted">None recorded</p>
            )}
          </div>
        </div>
      </details>

      <div className="med__actions">
        <button className="btn btn--ghost" onClick={onEdit}>
          Edit
        </button>
        <button className="btn btn--ghost" onClick={onStop}>
          Stop
        </button>
      </div>
    </li>
  );
}
