import type { RiskScore } from '../module_bindings/types';
import { Sparkline } from '../components/Sparkline';
import { Panel } from '../components/ui';
import { MODEL_CARD, RISK_LEVEL_LABEL, THRESHOLDS, driverValue, parseRisk, pct } from '../lib/risk';

export function RiskCard({ risk }: { risk: RiskScore | undefined }) {
  if (!risk) {
    return (
      <Panel title="Deterioration risk" code={<span className="tag tag--ai">Model · advisory</span>} className="risk">
        <p className="muted small">Waiting for pod readings…</p>
      </Panel>
    );
  }
  const r = parseRisk(risk);
  const top = Math.max(THRESHOLDS.high * 1.4, ...r.history);
  return (
    <Panel
      title="Deterioration risk"
      code={<span className="tag tag--ai">Model · advisory</span>}
      className={`risk risk--${r.level}`}
    >
      <div className="risk__head">
        <div className="risk__value mono">
          {pct(r.prob)}
          <span className="risk__unit">chance of sepsis onset in 6 h</span>
        </div>
        <span className={`risk__level risk__level--${r.level}`}>{RISK_LEVEL_LABEL[r.level] ?? r.level}</span>
      </div>
      <Sparkline values={r.history} min={0} max={top} baseline={THRESHOLDS.elevated} color="var(--purple)" />
      <div className="risk__scale mono">
        <span>Last {r.history.length} readings</span>
        <span>
          Elevated ≥ {pct(THRESHOLDS.elevated)} · High ≥ {pct(THRESHOLDS.high)}
        </span>
      </div>
      {r.drivers.length > 0 && (
        <ul className="risk__drivers">
          {r.drivers.map(d => (
            <li key={d.feature} className={d.effect > 0 ? 'risk__up' : 'risk__down'}>
              <span className="risk__arrow" aria-label={d.effect > 0 ? 'raises risk' : 'lowers risk'}>
                {d.effect > 0 ? '▲' : '▼'}
              </span>
              <span className="risk__label">{d.label}</span>
              <span className="mono">{driverValue(d)}</span>
            </li>
          ))}
        </ul>
      )}
      <details className="risk__about">
        <summary>About this model</summary>
        <p>
          Gradient-boosted trees on hourly vital-sign trends, trained on ICU stays from one hospital in the PhysioNet
          2019 sepsis challenge. On a second hospital it never saw, AUROC {MODEL_CARD.auroc} versus{' '}
          {MODEL_CARD.aurocNews2} for NEWS2. It flags about half of sepsis cases a median 8 hours ahead and has many
          false alarms, so it can raise a review but never lowers a rule or triggers an emergency.
        </p>
        <p>
          Not validated for home monitoring. The pod is simulated and each 5-second reading stands in for one hour, so
          trends play out in minutes.
        </p>
      </details>
    </Panel>
  );
}
