import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { SystemAssessment } from '../module_bindings/types';
import { assessmentsFor, useData } from '../lib/data';
import { timeAgo } from '../lib/format';
import {
  ASSESSMENT_SYSTEMS,
  assessmentLabel,
  latestBySystem,
  statusLabel,
  statusTone,
  type AssessmentSystem,
} from '../lib/assessment';
import { Hex, Panel } from '../components/ui';

/**
 * Head-to-toe nursing assessment: one row per body system, newest finding first.
 * The nurse can open a system here, or tap the 3D model to assess at that spot.
 */
export function AssessmentPanel({
  patientId,
  patientName,
  onOpenAssessment,
}: {
  patientId: bigint;
  patientName: string;
  onOpenAssessment: (system: AssessmentSystem, existing?: SystemAssessment) => void;
}) {
  const data = useData();
  const del = useReducer(reducers.deleteSystemAssessment);
  const rows = assessmentsFor(data, patientId);
  const latest = latestBySystem(rows);
  const done = latest.size;
  const abnormal = [...latest.values()].filter(a => a.status === 'abnormal').length;

  return (
    <Panel
      title="Nursing assessment"
      code={
        done === 0
          ? 'Not started'
          : `${done} of ${ASSESSMENT_SYSTEMS.length} systems${abnormal ? ` · ${abnormal} abnormal` : ''}`
      }
      className="assess"
      collapsible
    >
      <p className="muted small">
        System-by-system, head to toe. Tap the 3D model to assess at that spot, or open a
        system below. Findings land on {patientName.split(' ')[0]}&rsquo;s chart and in the
        triage brief.
      </p>

      <ul className="assess__list">
        {ASSESSMENT_SYSTEMS.map(sys => {
          const a = latest.get(sys);
          return (
            <li key={sys} className={`assess__row assess__row--${a?.status ?? 'none'}`}>
              <Hex
                tone={a ? statusTone(a.status) : 'off'}
                label={a ? `${assessmentLabel(sys)}: ${statusLabel(a.status)}` : `${assessmentLabel(sys)}: not assessed`}
              />
              <span className="assess__main">
                <strong>{assessmentLabel(sys)}</strong>
                {a?.findings && <span className="muted small">{a.findings}</span>}
                {a ? (
                  <span className="muted small mono">
                    {timeAgo(a.assessedAt)} · {a.assessedBy}
                  </span>
                ) : (
                  <span className="muted small">Not assessed yet</span>
                )}
              </span>
              <span className="assess__actions">
                <button className="btn" onClick={() => onOpenAssessment(sys, a)}>
                  {a ? 'Reassess' : 'Assess'}
                </button>
                {a && (
                  <button
                    className="btn btn--ghost chart__del"
                    title="Remove this finding"
                    onClick={() => void del({ id: a.id }).catch(() => {})}
                  >
                    ×
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
