import { useState } from 'react';
import { Timestamp } from 'spacetimedb';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { CategoryIcon } from './icons';
import { DOSES_PER_DAY, SCHEDULES, medicationLog, whenText } from './model';
import { catStyle, type HealthCtx } from './HealthApp';

export function Medications({ ctx }: { ctx: HealthCtx }) {
  const { h, patient, toast } = ctx;
  const log = useReducer(reducers.logHealthSample);
  const remove = useReducer(reducers.removeMedication);
  const [adding, setAdding] = useState(false);

  const dose = (name: string, taken: boolean) =>
    log({ patientId: patient.id, metric: 'medication', value: taken ? 1 : 0, label: name, at: Timestamp.now() })
      .then(() => toast(taken ? `Logged ${name}` : `Marked ${name} as skipped`))
      .catch(e => toast(`Could not save: ${String(e)}`));

  return (
    <div className="hpage" style={catStyle('medications')}>
      <div className="hpage__head hpage__head--metric">
        <span className="kicker hpage__cat">
          <CategoryIcon id="medications" />
          Category
        </span>
        <h1 className="hpage__title">Medications</h1>
        <div className="hpage__actions">
          <button className="btn btn--primary" onClick={() => setAdding(a => !a)}>
            {adding ? 'Close' : 'Add a Medication'}
          </button>
        </div>
      </div>

      {adding && <AddMedication ctx={ctx} onDone={() => setAdding(false)} />}

      {h.medications.length === 0 && !adding && (
        <div className="hcard hempty">
          <CategoryIcon id="medications" />
          <h2>No medications yet</h2>
          <p className="muted">Add your medications to log doses, see what you missed and share it with your care team.</p>
        </div>
      )}

      <div className="hmeds">
        {h.medications.map(med => {
          const l = medicationLog(h, med.name);
          const perDay = DOSES_PER_DAY[med.schedule] ?? 0;
          const takenToday = l.today.filter(x => x.value > 0).length;
          const logged7 = l.taken7 + l.skipped7;
          return (
            <div key={String(med.id)} className="hcard hmed">
              <div className="hmed__head">
                <span className="hmed__pill" aria-hidden>
                  <CategoryIcon id="medications" />
                </span>
                <div className="hmed__name">
                  <strong>{med.name}</strong>
                  <span className="muted small">
                    {med.dose ? `${med.dose} · ` : ''}
                    {med.schedule}
                  </span>
                </div>
                <button className="hlink hmed__remove" onClick={() => void remove({ id: med.id })}>
                  Remove
                </button>
              </div>
              <div className="hmed__today">
                {perDay > 0 ? (
                  <span className="hmed__doses" aria-label={`${takenToday} of ${perDay} doses today`}>
                    {Array.from({ length: perDay }, (_, i) => (
                      <i key={i} className={i < takenToday ? 'on' : ''} />
                    ))}
                    <span className="small">
                      {takenToday} of {perDay} today
                    </span>
                  </span>
                ) : (
                  <span className="small muted">{l.today.length ? `Taken ${l.today.length}× today` : 'As needed · none today'}</span>
                )}
                <div className="hmed__btns">
                  <button className="btn btn--primary" onClick={() => dose(med.name, true)}>
                    Taken
                  </button>
                  {perDay > 0 && (
                    <button className="btn" onClick={() => dose(med.name, false)}>
                      Skipped
                    </button>
                  )}
                </div>
              </div>
              <div className="hmed__foot small muted">
                {logged7 > 0 ? (
                  <>
                    Last 7 days: {l.taken7} taken
                    {l.skipped7 > 0 && <strong className="hmed__missed"> · {l.skipped7} skipped</strong>}
                  </>
                ) : (
                  'Nothing logged in the last 7 days'
                )}
                {l.last && ` · last logged ${whenText(l.last.at).replace('Yesterday', 'yesterday')}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddMedication({ ctx, onDone }: { ctx: HealthCtx; onDone: () => void }) {
  const add = useReducer(reducers.addMedication);
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [schedule, setSchedule] = useState<string>(SCHEDULES[0]);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="hcard haddmed"
      onSubmit={e => {
        e.preventDefault();
        if (!name.trim()) return setError('Enter the medication name and strength.');
        add({ patientId: ctx.patient.id, name, dose, schedule })
          .then(() => {
            ctx.toast(`Added ${name.trim()}`);
            onDone();
          })
          .catch(err => setError(String(err)));
      }}
    >
      <label className="field">
        <span className="field__label">Medication and strength</span>
        <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Lisinopril 10 mg" />
      </label>
      <label className="field">
        <span className="field__label">How to take it</span>
        <input className="input" value={dose} onChange={e => setDose(e.target.value)} placeholder="1 tablet with breakfast" />
      </label>
      <div className="field">
        <span className="field__label">Schedule</span>
        <div className="chips">
          {SCHEDULES.map(s => (
            <button type="button" key={s} className={`chip ${schedule === s ? 'chip--on' : ''}`} onClick={() => setSchedule(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error small">{error}</p>}
      <button className="btn btn--primary">Add</button>
    </form>
  );
}
