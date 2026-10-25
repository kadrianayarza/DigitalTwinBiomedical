import { useMemo, useState, type CSSProperties } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { mentalHealthFor, useData } from '../lib/data';
import { timeAgo } from '../lib/format';
import {
  MH_KIND_LABEL,
  MH_MAX_SCORE,
  MOOD_SCALE,
  bandLabel,
  isElevatedWithLittleSleep,
  moodLabel,
  type MhKind,
} from '../lib/mentalHealth';
import { Panel } from './ui';
import { QuestionnaireSheet } from './QuestionnaireSheet';

const MOOD_ACCENT: Record<string, string> = {
  '-3': '#dc1f34',
  '-2': '#e05c4f',
  '-1': '#d97706',
  '0': '#8a8f98',
  '1': '#1a73e8',
  '2': '#7c4dcc',
  '3': '#9333ea',
};

/**
 * Mood and mental health for one chart: a daily bipolar mood log, PHQ-9 and GAD-7
 * screenings, and the recent trend. Shared by the patient view (self-report) and the
 * nurse chart (administer). Red flags raise the shared alert flow, which pushes
 * crisis lines to the patient and notifies the family.
 */
export function MentalHealthCard({
  patientId,
  patientName,
  mode,
}: {
  patientId: bigint;
  patientName: string;
  mode: 'patient' | 'nurse';
}) {
  const data = useData();
  const log = useReducer(reducers.logMentalHealthCheckIn);
  const rows = useMemo(() => mentalHealthFor(data, patientId), [data, patientId]);
  const [mood, setMood] = useState<number | null>(null);
  const [sleep, setSleep] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'phq9' | 'gad7' | null>(null);

  const latestPhq9 = rows.find(r => r.kind === 'phq9');
  const latestGad7 = rows.find(r => r.kind === 'gad7');
  const latestMood = rows.find(r => r.kind === 'mood');
  const moodDays = rows.filter(r => r.kind === 'mood').slice(0, 7).reverse();

  const code = latestPhq9
    ? `PHQ-9 ${latestPhq9.score} · ${bandLabel(latestPhq9.band)}`
    : latestGad7
      ? `GAD-7 ${latestGad7.score} · ${bandLabel(latestGad7.band)}`
      : latestMood
        ? `Mood ${latestMood.score >= 0 ? '+' : ''}${latestMood.score} · ${moodLabel(latestMood.score)}`
        : 'Not started';

  const elevated = latestMood && isElevatedWithLittleSleep(latestMood.score, latestMood.sleepHours);

  const saveMood = async () => {
    if (mood === null) return;
    setBusy(true);
    setError(null);
    try {
      const hours = parseFloat(sleep);
      await log({
        patientId,
        kind: 'mood',
        score: mood,
        item9: 0,
        sleepHours: Number.isFinite(hours) ? hours : 0,
        notes: note,
      });
      setMood(null);
      setSleep('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Mood and mental health" code={code} className="mhcard" collapsible>
      <p className="muted small">
        {mode === 'patient'
          ? 'A daily mood note and short check-ins for depression (PHQ-9) and anxiety (GAD-7). Anything worrying goes to your care team right away, with help lines when it matters.'
          : `${patientName.split(' ')[0]}'s mood log and screening scores. Positive item 9 or crisis wording raises an emergency alert automatically.`}
      </p>

      <div className="field__label">How has today felt?</div>
      <div className="chips mhcard__mood">
        {MOOD_SCALE.map(m => (
          <button
            key={m.value}
            type="button"
            className={`chip chip--mood ${mood === m.value ? 'chip--on' : ''}`}
            aria-pressed={mood === m.value}
            style={{ '--mood': MOOD_ACCENT[String(m.value)] } as CSSProperties}
            onClick={() => setMood(m.value)}
          >
            {m.value >= 0 ? `+${m.value}` : String(m.value)} · {m.label}
          </button>
        ))}
      </div>
      <div className="mhcard__moodrow">
        <input
          className="input"
          inputMode="decimal"
          placeholder="Hours slept, e.g. 4.5 (optional)"
          value={sleep}
          onChange={e => setSleep(e.target.value)}
        />
        <input
          className="input"
          placeholder={mode === 'patient' ? 'A line about today (optional)' : 'Context from the visit (optional)'}
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <button className="btn btn--primary" disabled={busy || mood === null} onClick={() => void saveMood()}>
          Log mood day
        </button>
      </div>

      <div className="mhcard__screens">
        <button type="button" className="btn" onClick={() => setSheet('phq9')}>
          PHQ-9 · depression check
        </button>
        <button type="button" className="btn" onClick={() => setSheet('gad7')}>
          GAD-7 · anxiety check
        </button>
      </div>

      {moodDays.length > 0 && (
        <>
          <div className="field__label">Mood trail, oldest to newest</div>
          <div className="mhcard__trail" aria-hidden>
            {moodDays.map((r, i) => (
              <span
                key={String(r.id)}
                className={`mhbar ${r.score < 0 ? 'mhbar--low' : r.score > 0 ? 'mhbar--high' : ''}`}
                style={{ height: `${14 + Math.abs(r.score) * 11}px`, background: MOOD_ACCENT[String(r.score)] }}
                title={`${moodLabel(r.score)} · ${r.sleepHours ? `${r.sleepHours} h sleep` : 'sleep not noted'} · ${timeAgo(r.createdAt)}`}
                data-i={i}
              />
            ))}
          </div>
        </>
      )}

      {elevated && (
        <p className="mhcard__flag">
          Latest day: mood {moodLabel(latestMood!.score).toLowerCase()} with only {latestMood!.sleepHours} h of sleep.
          The care team has a red flag for possible activation.
        </p>
      )}

      {error && <p className="error small">{error}</p>}

      <div className="sbar__label">Recent check-ins</div>
      {rows.length === 0 ? (
        <p className="muted small">No mood logs or screenings yet.</p>
      ) : (
        <ul className="mhcard__list">
          {rows.slice(0, 8).map(r => (
            <li key={String(r.id)} className="mhcard__row">
              <span className="mhcard__rowmain">
                <strong>{MH_KIND_LABEL[r.kind as MhKind] ?? r.kind}</strong>
                {r.kind === 'mood' ? (
                  <span className="muted small">
                    {moodLabel(r.score)}
                    {r.sleepHours > 0 ? ` · ${r.sleepHours} h sleep` : ''}
                  </span>
                ) : (
                  <span className={`mhcard__band mhcard__band--${r.band}`}>{bandLabel(r.band)}</span>
                )}
                {r.kind === 'phq9' && r.item9 > 0 && (
                  <span className="chip chip--danger chip--on">Item 9: {r.item9}/3 — self-harm thoughts flagged</span>
                )}
                {r.notes && <span className="muted small">{r.notes}</span>}
              </span>
              <span className="muted small mono">
                {r.kind === 'mood' ? r.score : `${r.score}/${MH_MAX_SCORE[r.kind as MhKind]}`} · {timeAgo(r.createdAt)} · {r.createdBy}
              </span>
            </li>
          ))}
        </ul>
      )}

      {sheet && (
        <QuestionnaireSheet
          patientId={patientId}
          patientName={patientName}
          kind={sheet}
          mode={mode}
          onClose={() => setSheet(null)}
        />
      )}
    </Panel>
  );
}
