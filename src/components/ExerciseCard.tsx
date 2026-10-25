import { useState, type FormEvent } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { exerciseFor, useData } from '../lib/data';
import { timeAgo } from '../lib/format';
import { EXERCISE_DAYS, EXERCISE_INTENSITIES } from '../lib/voice';
import { Panel } from './ui';

/** One small true thing per day, so the tab teaches while it tracks. */
const TIPS = [
  'A 30-minute walk lowers blood sugar for hours afterwards.',
  'Two strength sessions a week slow bone and muscle loss at any age.',
  'Exercise deepens sleep: active days fall asleep faster.',
  'A 10-minute walk after a meal blunts the blood-sugar spike.',
  'Easy movement most days beats one heroic workout a week.',
  'Muscle built in training burns extra calories even at rest.',
  'Rehydration matters most in the hour right after a session.',
  'Regular movement is one of the few proven ways to lift mood.',
];

const INTENSITY_LABEL: Record<string, string> = {
  light: 'Light',
  moderate: 'Moderate',
  hard: 'Hard',
};

/** Milliseconds of this week's Monday, so "this week" counts from Monday morning. */
function mondayMs(now: Date) {
  const day = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
}

type Entry = ReturnType<typeof exerciseFor>[number];

/**
 * The weekly workout plan and the sessions actually logged. The patient or any
 * care-team member can plan, tick off, log, and remove workouts; the bar shows
 * minutes moved against the plan for the current week.
 */
export function ExerciseCard({
  patientId,
  collapsible = true,
}: {
  patientId: bigint;
  collapsible?: boolean;
}) {
  const data = useData();
  const save = useReducer(reducers.saveExerciseEntry);
  const del = useReducer(reducers.deleteExerciseEntry);
  const entries = exerciseFor(data, patientId);
  const plan = entries.filter(e => e.status === 'planned');
  const done = entries.filter(e => e.status === 'done');

  const now = new Date();
  const today = (now.getDay() + 6) % 7;
  const weekStart = mondayMs(now);
  const doneThisWeek = done.filter(e => Number(e.createdAt.microsSinceUnixEpoch / 1000n) >= weekStart);
  const plannedMinutes = plan.reduce((sum, e) => sum + e.minutes, 0);
  const doneMinutes = doneThisWeek.reduce((sum, e) => sum + e.minutes, 0);
  const pct =
    plannedMinutes > 0 ? Math.min(100, Math.round((doneMinutes / plannedMinutes) * 100)) : 0;
  const tip = TIPS[Math.floor(Date.now() / 86_400_000) % TIPS.length]!;

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState({
    day: String(today),
    activity: '',
    minutes: '30',
    intensity: 'moderate',
  });

  const saveOne = async (
    status: 'planned' | 'done',
    day: number,
    activity: string,
    minutes: number,
    intensity: string
  ) => {
    setBusy(true);
    setError(null);
    try {
      await save({
        id: 0n,
        patientId,
        status,
        activity,
        minutes,
        intensity,
        day,
        note: '',
        source: 'form',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minutes = parseInt(d.minutes, 10);
    if (!d.activity.trim() || !(minutes >= 1 && minutes <= 600)) return;
    await saveOne('planned', Number(d.day), d.activity.trim(), minutes, d.intensity);
    setD(p => ({ ...p, activity: '' }));
    setAdding(false);
  };

  const logItNow = async () => {
    const minutes = parseInt(d.minutes, 10);
    if (!d.activity.trim() || !(minutes >= 1 && minutes <= 600)) return;
    await saveOne('done', today, d.activity.trim(), minutes, d.intensity);
    setD(p => ({ ...p, activity: '' }));
    setAdding(false);
  };

  const markDone = (row: Entry) =>
    void saveOne('done', today, row.activity, row.minutes, row.intensity).catch(() => {});

  const starterPlan = async () => {
    setBusy(true);
    setError(null);
    try {
      const starters: Array<[number, string, number, string]> = [
        [0, 'Walk', 30, 'moderate'],
        [2, 'Walk', 30, 'moderate'],
        [4, 'Walk', 30, 'moderate'],
        [1, 'Stretch', 15, 'light'],
        [5, 'Cycle', 20, 'light'],
      ];
      for (const [day, activity, minutes, intensity] of starters) {
        await save({ id: 0n, patientId, status: 'planned', activity, minutes, intensity, day, note: '', source: 'form' });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const grouped = EXERCISE_DAYS.map((name, day) => ({
    day,
    name,
    rows: plan.filter(e => e.day === day),
  })).filter(g => g.rows.length > 0);

  return (
    <Panel
      title="Exercise"
      code={plannedMinutes > 0 ? `${doneMinutes} of ${plannedMinutes} min` : 'Move · Learn · Repeat'}
      className="exercise"
      collapsible={collapsible}
    >
      <div className="exercise__meter">
        <div className="exercise__meterbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="muted small">
          {plannedMinutes > 0
            ? `${doneMinutes} of ${plannedMinutes} planned minutes moved this week`
            : 'No plan yet. Add workouts, or just tell the assistant.'}
        </span>
      </div>

      {grouped.length === 0 ? (
        <div className="exercise__empty">
          <p className="muted small">
            Build a weekly plan — three walks are a fine start. Tick a workout off when you do it, and the bar fills
            up.
          </p>
          <button className="btn" disabled={busy} onClick={() => void starterPlan()}>
            Use the starter plan
          </button>
        </div>
      ) : (
        <ul className="exercise__plan">
          {grouped.map(g => (
            <li key={g.day} className="exercise__group">
              <span className="exercise__day muted small mono">{g.name.slice(0, 3)}</span>
              <ul className="exercise__slots">
                {g.rows.map(row => (
                  <li key={String(row.id)} className="exercise__slot">
                    <span className="exercise__main">
                      <strong>
                        {row.activity} · {row.minutes} min
                      </strong>
                      <span className="muted small">{INTENSITY_LABEL[row.intensity] ?? row.intensity}</span>
                    </span>
                    <span className="exercise__slotbtns">
                      <button
                        className="btn btn--ghost"
                        title={`Log this ${row.activity} as done today`}
                        disabled={busy}
                        onClick={() => markDone(row)}
                      >
                        Did it
                      </button>
                      <button
                        className="btn btn--ghost lifestyle__del"
                        title="Remove from the plan"
                        onClick={() => void del({ id: row.id }).catch(() => {})}
                      >
                        ×
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {doneThisWeek.length > 0 && (
        <>
          <p className="muted small exercise__donehead">Logged this week</p>
          <ul className="exercise__done">
            {doneThisWeek.slice(0, 8).map(row => (
              <li key={String(row.id)} className="exercise__donerow">
                <span className="exercise__main">
                  <strong>
                    {row.activity} · {row.minutes} min
                  </strong>
                  <span className="muted small">
                    {[EXERCISE_DAYS[row.day]?.slice(0, 3), row.source === 'voice' && 'from the assistant']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="muted small mono">{timeAgo(row.createdAt)}</span>
                <button
                  className="btn btn--ghost lifestyle__del"
                  title="Remove this log"
                  onClick={() => void del({ id: row.id }).catch(() => {})}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {adding ? (
        <form className="exercise__form" onSubmit={submit}>
          <div className="exercise__grid">
            <select
              className="input"
              aria-label="Day of the week"
              value={d.day}
              onChange={e => setD(p => ({ ...p, day: e.target.value }))}
            >
              {EXERCISE_DAYS.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Activity — e.g. Run, Yoga, Gym"
              value={d.activity}
              onChange={e => setD(p => ({ ...p, activity: e.target.value }))}
              required
            />
            <input
              className="input"
              inputMode="numeric"
              placeholder="Minutes"
              value={d.minutes}
              onChange={e => setD(p => ({ ...p, minutes: e.target.value }))}
              required
            />
          </div>
          <div className="chips exercise__prio">
            {EXERCISE_INTENSITIES.map(i => (
              <button
                key={i}
                type="button"
                className={`chip ${d.intensity === i ? 'chip--on' : ''}`}
                aria-pressed={d.intensity === i}
                onClick={() => setD(p => ({ ...p, intensity: i }))}
              >
                {INTENSITY_LABEL[i] ?? i}
              </button>
            ))}
          </div>
          <div className="exercise__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy || !d.activity.trim()}>
              Add to plan
            </button>
            <button type="button" className="btn" disabled={busy || !d.activity.trim()} onClick={() => void logItNow()}>
              Log it today
            </button>
          </div>
          {error && <p className="error small">{error}</p>}
        </form>
      ) : (
        <div className="exercise__bar">
          <span className="muted small">
            <strong className="exercise__learn">Learn:</strong> {tip}
          </span>
          <button className="btn" onClick={() => setAdding(true)}>
            Add workout
          </button>
        </div>
      )}

      {error && !adding && <p className="error small">{error}</p>}
    </Panel>
  );
}
