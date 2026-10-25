import type { Patient } from '../module_bindings/types';
import { historyFor, labsFor, useData } from '../lib/data';
import { formatLabValue, timeAgo } from '../lib/format';
import { LibLink } from '../library/LibLink';
import { FLAG_PATIENT_LABEL, FLAG_TONE, HISTORY_CATEGORIES, HISTORY_LABEL } from '../lib/library';
import { Disclosure } from '../components/ui';

/** Collapsed health record: recent labs and history, in plain language. */
export function HealthRecordCard({
  patient,
  onOpenLibrary,
}: {
  patient: Patient;
  onOpenLibrary: (slug: string) => void;
}) {
  const data = useData();
  const labs = labsFor(data, patient.id);
  const history = historyFor(data, patient.id);

  return (
    <details className="panel healthcard">
      <summary>
        <span className="healthcard__summary">
          <span className="healthcard__title">Your health record</span>
          <span className="muted small">
            {labs.length} lab result{labs.length === 1 ? '' : 's'} · {history.length} history note
            {history.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="healthcard__chevron" aria-hidden />
      </summary>
      <div className="healthcard__body">
        <Disclosure label="Recent lab results" count={labs.length} className="healthcard__section">
          {labs.length === 0 ? (
            <p className="muted small">No lab results yet.</p>
          ) : (
            <ul className="healthcard__labs">
              {labs.slice(0, 6).map(l => (
                <li key={String(l.id)} className="healthcard__lab">
                  <span className={`flagchip flagchip--${FLAG_TONE[l.flag] ?? 'off'}`}>
                    {FLAG_PATIENT_LABEL[l.flag] || 'Recorded'}
                  </span>
                  <span className="healthcard__labmain">
                    {l.slug ? (
                      <LibLink slug={l.slug} onOpen={onOpenLibrary}>
                        {l.name}
                      </LibLink>
                    ) : (
                      l.name
                    )}
                    <strong className="mono">
                      {formatLabValue(l.value)} {l.unit}
                    </strong>
                  </span>
                  <span className="muted small">{timeAgo(l.resultedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>

        <Disclosure label="Health history" count={history.length} className="healthcard__section">
          {history.length === 0 ? (
            <p className="muted small">No health history recorded.</p>
          ) : (
            HISTORY_CATEGORIES.map(c => {
              const rows = history.filter(h => h.category === c);
              if (rows.length === 0) return null;
              return (
                <div key={c}>
                  <div className="sbar__label">{HISTORY_LABEL[c]}</div>
                  <ul className="healthcard__history">
                    {rows.map(h => (
                      <li key={String(h.id)}>
                        {h.slug ? (
                          <LibLink slug={h.slug} onOpen={onOpenLibrary}>
                            {h.title}
                          </LibLink>
                        ) : (
                          <strong>{h.title}</strong>
                        )}
                        {h.detail && <span className="muted small"> — {h.detail}</span>}
                        {h.whenText && <span className="muted small mono"> ({h.whenText})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </Disclosure>

        <p className="muted small healthcard__hint">
          Underlined terms have plain-language explanations: tap twice to read them.
        </p>
      </div>
    </details>
  );
}
