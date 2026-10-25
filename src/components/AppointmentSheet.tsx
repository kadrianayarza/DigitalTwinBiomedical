import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Appointment } from '../module_bindings/types';
import {
  APPT_DURATIONS,
  APPT_KIND_LABEL,
  APPT_KINDS,
  APPT_MODES,
  APPT_MODE_LABEL,
  APPT_STATUS_LABEL,
  fromLocalInput,
  nextSlot,
  toLocalInput,
  type ApptStatus,
} from '../lib/appointments';

type Props = {
  patientId: bigint;
  patientName: string;
  mode: 'patient' | 'nurse';
  /** Present when an existing row is being rescheduled or updated. */
  existing?: Appointment;
  onClose: () => void;
};

/**
 * Book one appointment, or reschedule an existing one. The fields stay a short menu of
 * chips plus a time picker, so a booking is a handful of taps. On an existing row only
 * the time can change (rescheduling); everything else is set when it is booked.
 */
export function AppointmentSheet({ patientId, patientName, mode, existing, onClose }: Props) {
  const book = useReducer(reducers.bookAppointment);
  const reschedule = useReducer(reducers.rescheduleAppointment);
  const setStatus = useReducer(reducers.setAppointmentStatus);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [kind, setKind] = useState<string>(existing?.kind ?? 'follow_up');
  const [when, setWhen] = useState(existing ? toLocalInput(existing.whenAt) : nextSlot());
  const [duration, setDuration] = useState<number>(existing?.durationMin ?? 30);
  const [apptMode, setApptMode] = useState<string>(existing?.mode ?? 'video');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await op();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    void run(() =>
      existing
        ? reschedule({ id: existing.id, whenAt: fromLocalInput(when), durationMin: duration })
        : book({
            patientId,
            title,
            kind,
            whenAt: fromLocalInput(when),
            durationMin: duration,
            mode: apptMode,
            location,
            notes,
          })
    );

  const booked = existing?.status === 'booked';
  const canSave = !busy && when !== '' && (existing !== undefined || title.trim() !== '');

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet apptsheet" onClick={e => e.stopPropagation()}>
        <header className="sheet__head">
          <div>
            <div className="kicker">Appointments · {patientName}</div>
            <h2 className="sheet__title">{existing ? existing.title : 'Book an appointment'}</h2>
            {existing ? (
              <p className="muted small">
                Rescheduling changes the time only. {APPT_STATUS_LABEL[existing.status as ApptStatus] ?? existing.status} · booked by {existing.createdBy}.
              </p>
            ) : (
              <p className="muted small">
                {mode === 'patient'
                  ? 'A visit, call, or lab draw. Overlaps with something already booked are stopped, so the schedule stays clean.'
                  : 'Coordinate from here: booked times cannot overlap for this patient.'}
              </p>
            )}
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <label className="field">
          <span className="field__label">What is it?</span>
          <input
            className="input"
            placeholder="e.g. Follow-up with Dr. Reyes"
            value={title}
            disabled={!!existing}
            onChange={e => setTitle(e.target.value)}
          />
        </label>

        <div className="field__label">Type</div>
        <div className="chips">
          {APPT_KINDS.map(k => (
            <button
              key={k}
              type="button"
              className={`chip ${kind === k ? 'chip--on' : ''}`}
              aria-pressed={kind === k}
              disabled={!!existing}
              onClick={() => setKind(k)}
            >
              {APPT_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="apptsheet__when">
          <label className="field">
            <span className="field__label">When</span>
            <input
              className="input"
              type="datetime-local"
              value={when}
              onChange={e => setWhen(e.target.value)}
            />
          </label>
          <div className="field">
            <span className="field__label">Length</span>
            <div className="chips">
              {APPT_DURATIONS.map(d => (
                <button
                  key={d}
                  type="button"
                  className={`chip ${duration === d ? 'chip--on' : ''}`}
                  aria-pressed={duration === d}
                  onClick={() => setDuration(d)}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="field__label">How</div>
        <div className="chips">
          {APPT_MODES.map(m => (
            <button
              key={m}
              type="button"
              className={`chip ${apptMode === m ? 'chip--on' : ''}`}
              aria-pressed={apptMode === m}
              disabled={!!existing}
              onClick={() => setApptMode(m)}
            >
              {APPT_MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="field__label">Where</span>
          <input
            className="input"
            placeholder={apptMode === 'video' ? 'The link arrives before the visit' : apptMode === 'phone' ? 'Who calls whom' : 'Clinic or address'}
            value={location}
            disabled={!!existing}
            onChange={e => setLocation(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Notes (optional)</span>
          <textarea
            className="input"
            rows={2}
            placeholder="What to bring, or what the visit is for"
            value={notes}
            disabled={!!existing}
            onChange={e => setNotes(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <footer className="sheet__foot apptsheet__foot">
          {existing && booked && (
            <div className="apptsheet__actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => void run(() => setStatus({ id: existing.id, status: 'cancelled' }))}
              >
                Cancel appointment
              </button>
              {mode === 'nurse' && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => void run(() => setStatus({ id: existing.id, status: 'done' }))}
                >
                  Mark completed
                </button>
              )}
            </div>
          )}
          <button type="button" className="btn btn--primary btn--lg" disabled={!canSave} onClick={save}>
            {existing ? 'Save new time' : 'Book appointment'}
          </button>
        </footer>
      </div>
    </div>
  );
}
