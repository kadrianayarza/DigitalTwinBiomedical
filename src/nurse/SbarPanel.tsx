import { useEffect, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Alert, SbarReport } from '../module_bindings/types';
import { PRIORITY_LABEL, REASON_LABEL, clock, timeAgo } from '../lib/format';

type Props = { alert: Alert; report: SbarReport | undefined };

const FIELDS = [
  ['situation', 'S · Situation'],
  ['background', 'B · Background'],
  ['assessment', 'A · Assessment'],
  ['recommendation', 'R · Recommendation'],
] as const;

type Draft = Record<(typeof FIELDS)[number][0], string>;

export function SbarPanel({ alert, report }: Props) {
  const ack = useReducer(reducers.ackAlert);
  const escalate = useReducer(reducers.escalateAlert);
  const resolve = useReducer(reducers.resolveAlert);
  const approve = useReducer(reducers.approveSbar);
  const regenerate = useReducer(reducers.regenerateSbar);

  const [draft, setDraft] = useState<Draft>({ situation: '', background: '', assessment: '', recommendation: '' });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!report || dirty) return;
    setDraft({
      situation: report.situation,
      background: report.background,
      assessment: report.assessment,
      recommendation: report.recommendation,
    });
  }, [report, dirty]);

  useEffect(() => setDirty(false), [alert.id]);

  const codes = alert.reasonCodes.split(',').filter(Boolean);
  const ruleCount = codes.filter(c => !c.startsWith('ML_')).length;
  const pending = !report || report.status === 'pending';
  const approved = report?.status === 'approved';
  const isAi = report && report.model && report.model !== 'template';

  const ai = pending
    ? { state: 'wait', value: 'Drafting' }
    : alert.raisedBy === 'rules+claude'
      ? { state: 'alarm', value: `Raised to ${PRIORITY_LABEL[alert.priority] ?? alert.priority}` }
      : isAi
        ? { state: 'ok', value: `Suggests ${PRIORITY_LABEL[report!.suggestedPriority] ?? 'no change'}` }
        : { state: 'off', value: 'Template' };
  const nurse = approved
    ? { state: 'ok', value: 'Approved' }
    : alert.status === 'open'
      ? { state: 'wait', value: 'Awaiting review' }
      : { state: 'ok', value: alert.status === 'escalated' ? 'Escalated' : 'Acknowledged' };

  return (
    <div className={`alert-card alert-card--${alert.priority} ${alert.status === 'open' ? 'alert-card--open' : ''}`}>
      <div className="alert-card__head">
        <span className="alert-card__prio">{PRIORITY_LABEL[alert.priority] ?? alert.priority}</span>
        <span className="mono small alert-card__when">
          {timeAgo(alert.createdAt)} · {alert.status}
          {alert.ackedByName ? ` · ${alert.ackedByName}` : ''}
        </span>
      </div>

      <div className="triad" role="group" aria-label="Safety checks">
        <div className="triad__unit triad__unit--alarm">
          <span className="triad__name">Rules</span>
          <span className="triad__val">
            {ruleCount > 0 && `${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'} fired`}
            {ruleCount > 0 && ruleCount < codes.length && ' + model'}
            {ruleCount === 0 && 'Risk model'}
          </span>
        </div>
        <div className={`triad__unit triad__unit--${ai.state}`}>
          <span className="triad__name">AI</span>
          <span className="triad__val">{ai.value}</span>
        </div>
        <div className={`triad__unit triad__unit--${nurse.state}`}>
          <span className="triad__name">Nurse</span>
          <span className="triad__val">{nurse.value}</span>
        </div>
      </div>

      <ul className="reasons">
        {codes.map(c => (
          <li key={c}>{REASON_LABEL[c] ?? c}</li>
        ))}
      </ul>

      <div className="alert-card__actions">
        <button className="btn" disabled={alert.status !== 'open'} onClick={() => void ack({ alertId: alert.id })}>
          Acknowledge
        </button>
        <button
          className="btn btn--warn"
          disabled={alert.status === 'escalated' || alert.status === 'resolved'}
          onClick={() => void escalate({ alertId: alert.id, note: 'Escalated to physician on call' })}
        >
          Escalate to physician
        </button>
        <button
          className="btn btn--ghost"
          disabled={alert.status === 'resolved'}
          onClick={() => void resolve({ alertId: alert.id, note: 'Resolved after nurse follow-up' })}
        >
          Resolve
        </button>
      </div>

      <div className="sbar">
        <div className="sbar__head">
          <div className="panel__title">SBAR handoff</div>
          {pending ? (
            <span className="tag tag--pulse">Drafting…</span>
          ) : approved ? (
            <span className="tag tag--ok">
              Approved by {report!.approvedByName} · {clock(report!.updatedAt)}
            </span>
          ) : (
            <span className={`tag ${isAi ? 'tag--ai' : ''}`}>
              {isAi ? 'AI draft' : 'Template draft'} · needs approval
            </span>
          )}
        </div>

        {FIELDS.map(([key, label]) => (
          <label key={key} className="sbar__field">
            <span className="sbar__label">{label}</span>
            <textarea
              rows={2}
              value={draft[key]}
              disabled={pending || approved}
              onChange={e => {
                setDirty(true);
                setDraft(d => ({ ...d, [key]: e.target.value }));
              }}
            />
          </label>
        ))}

        {report && !pending && report.uncertainties && (
          <div className="sbar__note">
            <div className="sbar__label">Uncertainties</div>
            <ul>
              {report.uncertainties.split('\n').filter(Boolean).map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        )}
        {report && !pending && report.questions && (
          <div className="sbar__note">
            <div className="sbar__label">Ask the patient</div>
            <ul>
              {report.questions.split('\n').filter(Boolean).map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        )}

        {!approved && (
          <div className="sbar__actions">
            <button
              className="btn btn--primary"
              disabled={pending || !report}
              onClick={() => {
                if (!report) return;
                void approve({ sbarId: report.id, ...draft });
                setDirty(false);
              }}
            >
              {dirty ? 'Approve with edits' : 'Approve'}
            </button>
            <button
              className="btn btn--ghost"
              disabled={pending}
              onClick={() => {
                setDirty(false);
                void regenerate({ alertId: alert.id });
              }}
            >
              Redraft
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
