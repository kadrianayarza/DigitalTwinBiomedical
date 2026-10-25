import { useState, type FormEvent } from 'react';
import { Timestamp } from 'spacetimedb';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { SystemAssessment } from '../module_bindings/types';
import { regionLabel } from '../twin/bodyModel';
import {
  ASSESSMENT_NORMAL,
  ASSESSMENT_PROMPT,
  ASSESSMENT_SHORT,
  ASSESSMENT_STATUSES,
  ASSESSMENT_STATUS_LABEL,
  ASSESSMENT_SYSTEMS,
  assessmentLabel,
  statusLabel,
  type AssessmentStatus,
  type AssessmentSystem,
} from '../lib/assessment';

type Props = {
  patientId: bigint;
  patientName: string;
  /** Tapped twin region, '' when opened from the list. */
  region?: string;
  /** Correcting an existing row (marker click); otherwise a fresh assessment. */
  existing?: SystemAssessment;
  /** Pre-picked system, from the tapped region or the panel. */
  system: AssessmentSystem;
  onClose: () => void;
};

/** One head-to-toe finding: system, status, and findings, opened by a tap on the 3D model. */
export function AssessmentSheet({ patientId, patientName, region = '', existing, system, onClose }: Props) {
  const save = useReducer(reducers.saveSystemAssessment);
  const [sys, setSys] = useState<AssessmentSystem>(existing && isSys(existing.system) ? existing.system : system);
  const [status, setStatus] = useState<AssessmentStatus>(
    existing && isStatus(existing.status) ? existing.status : 'normal'
  );
  const [findings, setFindings] = useState(existing?.findings ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save({
        id: existing?.id ?? 0n,
        patientId,
        system: sys,
        status,
        findings,
        region: existing?.region || region,
        assessedAt: existing?.assessedAt ?? new Timestamp(BigInt(Date.now()) * 1000n),
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
      <form className="sheet" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <header className="sheet__head">
          <div>
            <div className="kicker">
              {existing ? 'Edit assessment' : 'Nursing assessment'} · {patientName}
            </div>
            <h2 className="sheet__title">{assessmentLabel(sys)}</h2>
            <p className="muted small">
              {region ? `Tapped: ${regionLabel(region)}` : 'Whole-system finding'} · {ASSESSMENT_PROMPT[sys]}
            </p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </header>

        <div className="field__label">Body system</div>
        <div className="chips assess__chips">
          {ASSESSMENT_SYSTEMS.map(s => (
            <button
              key={s}
              type="button"
              className={`chip ${sys === s ? 'chip--on' : ''}`}
              aria-pressed={sys === s}
              title={assessmentLabel(s)}
              onClick={() => setSys(s)}
            >
              {ASSESSMENT_SHORT[s]}
            </button>
          ))}
        </div>

        <div className="field__label">Finding</div>
        <div className="chips">
          {ASSESSMENT_STATUSES.map(s => (
            <button
              key={s}
              type="button"
              className={`chip ${status === s ? 'chip--on' : ''} ${s === 'abnormal' && status === s ? 'chip--danger' : ''}`}
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                if (s === 'normal' && !findings.trim()) setFindings(ASSESSMENT_NORMAL[sys]);
              }}
            >
              {ASSESSMENT_STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <textarea
          className="input assess__findings"
          rows={4}
          placeholder={`Findings — e.g. ${ASSESSMENT_NORMAL[sys].toLowerCase()}`}
          value={findings}
          onChange={e => setFindings(e.target.value)}
          required
        />
        {status === 'normal' && findings.trim() && findings !== ASSESSMENT_NORMAL[sys] && (
          <button
            type="button"
            className="btn btn--ghost assess__fill"
            onClick={() => setFindings(ASSESSMENT_NORMAL[sys])}
          >
            Use the standard normal wording
          </button>
        )}

        {error && <p className="error">{error}</p>}

        <footer className="sheet__foot">
          <p className="muted small">
            Saved to the chart as {assessmentLabel(sys)} · {statusLabel(status)}.
          </p>
          <button type="submit" className="btn btn--primary btn--lg" disabled={busy || !findings.trim()}>
            {existing ? 'Save changes' : 'Save assessment'}
          </button>
        </footer>
      </form>
    </div>
  );
}

const isSys = (v: string): v is AssessmentSystem =>
  (ASSESSMENT_SYSTEMS as readonly string[]).includes(v);

const isStatus = (v: string): v is AssessmentStatus =>
  (ASSESSMENT_STATUSES as readonly string[]).includes(v);
