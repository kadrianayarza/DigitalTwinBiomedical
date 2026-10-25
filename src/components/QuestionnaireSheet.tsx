import { useMemo, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { CRISIS_LINES, GAD7_QUESTIONS, MH_KIND_LABEL, MH_OPTIONS, PHQ9_QUESTIONS } from '../lib/mentalHealth';

type Props = {
  patientId: bigint;
  patientName: string;
  kind: 'phq9' | 'gad7';
  /** The patient self-reports; the nurse administers on any chart. */
  mode: 'patient' | 'nurse';
  onClose: () => void;
};

/**
 * The standard PHQ-9 or GAD-7 questionnaire as a one-question-per-row form with the
 * shared 0-3 frequency options. Saving writes one mental-health check-in and runs the
 * red-flag rules on the server: a positive item 9 (or crisis wording anywhere) raises
 * an emergency alert, and the patient sees the crisis lines immediately.
 */
export function QuestionnaireSheet({ patientId, patientName, kind, mode, onClose }: Props) {
  const log = useReducer(reducers.logMentalHealthCheckIn);
  const questions = useMemo(() => (kind === 'phq9' ? PHQ9_QUESTIONS : GAD7_QUESTIONS), [kind]);
  const [answers, setAnswers] = useState<Array<number | null>>(() => questions.map(() => null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = answers.every(a => a !== null);
  const score = answers.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  // PHQ-9 item 9 asks about thoughts of self-harm; any nonzero answer is a red flag.
  const item9Index = kind === 'phq9' ? questions.length - 1 : -1;
  const item9 = item9Index >= 0 ? (answers[item9Index] ?? 0) : 0;
  const crisis = item9 > 0;

  const save = async () => {
    if (!answered) return;
    setBusy(true);
    setError(null);
    try {
      await log({
        patientId,
        kind,
        score,
        item9,
        sleepHours: 0,
        notes: '',
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
      <div className="sheet quizsheet" onClick={e => e.stopPropagation()}>
        <header className="sheet__head">
          <div>
            <div className="kicker">
              {MH_KIND_LABEL[kind]} · {patientName}
            </div>
            <h2 className="sheet__title">Over the last 2 weeks, how often have you been bothered by:</h2>
            <p className="muted small">
              {mode === 'patient'
                ? 'Answer honestly - your care team only gets involved when a check-in needs follow-up.'
                : 'Read each item to the patient and record their answer.'}
            </p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <ol className="quizsheet__list">
          {questions.map((q, qi) => (
            <li key={String(qi)} className={`quizsheet__item ${qi === item9Index ? 'quizsheet__item--nine' : ''}`}>
              <div className="quizsheet__q">
                {qi === item9Index && <span className="chip chip--danger">Item 9 · sensitive</span>}
                {q}
              </div>
              <div className="chips">
                {MH_OPTIONS.map((opt, oi) => (
                  <button
                    key={opt}
                    type="button"
                    className={`chip ${answers[qi] === oi ? 'chip--on' : ''}`}
                    aria-pressed={answers[qi] === oi}
                    onClick={() => setAnswers(cur => cur.map((a, i) => (i === qi ? oi : a)))}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>

        {crisis && (
          <div className="quizsheet__crisis" role="alert">
            <div className="quizsheet__crisis-title">
              {mode === 'patient'
                ? 'You are not alone - help is available right now:'
                : 'Share these crisis resources with the patient now:'}
            </div>
            <ul className="quizsheet__crisis-lines">
              {CRISIS_LINES.map(line => (
                <li key={line.label}>
                  <strong>{line.label}</strong>
                  <span className="muted"> — {line.detail}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {mode === 'patient'
                ? 'Saving this answer tells your care team to reach out today. If you think you may act on these thoughts, call 911 or go to the nearest emergency room.'
                : 'Saving this answer raises an emergency alert to the team. Assess safety now and follow your suicide-risk protocol.'}
            </p>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <footer className="sheet__foot">
          <span className="muted small">
            {answered ? `Score: ${score}${kind === 'phq9' ? '/27' : '/21'}` : 'Answer every question to save'}
          </span>
          <button type="button" className="btn btn--primary btn--lg" disabled={busy || !answered} onClick={() => void save()}>
            Save check-in
          </button>
        </footer>
      </div>
    </div>
  );
}
