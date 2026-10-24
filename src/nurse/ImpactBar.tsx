import { useData } from '../lib/data';
import { duration, tsMs } from '../lib/format';

/** Live impact metrics computed from SpacetimeDB tables (DESIGN_SPEC.md section 13.1). */
export function ImpactBar() {
  const data = useData();
  const now = Date.now();

  const ackTimes = data.alerts
    .filter(a => a.ackedAt)
    .map(a => tsMs(a.ackedAt!) - tsMs(a.createdAt))
    .sort((a, b) => a - b);
  const medianAck = ackTimes.length ? ackTimes[Math.floor(ackTimes.length / 2)]! : null;

  const checkedIn = new Set(
    data.symptoms.filter(s => now - tsMs(s.createdAt) < 86_400_000).map(s => String(s.patientId))
  );

  const approved = data.reports.filter(r => r.status === 'approved' && r.model && r.model !== 'template');
  const edited = approved.filter(r => r.editedByNurse).length;

  const open = data.alerts.filter(a => a.status === 'open').length;
  const claudeRaised = data.alerts.filter(a => a.raisedBy === 'rules+claude').length;

  const metrics = [
    { label: 'Open alerts', value: String(open) },
    { label: 'Median ack time', value: medianAck === null ? '–' : duration(medianAck) },
    { label: 'Checked in (24 h)', value: `${checkedIn.size}/${data.patients.length}` },
    {
      label: 'AI drafts edited',
      value: approved.length ? `${Math.round((edited / approved.length) * 100)}%` : '–',
    },
    { label: 'Raised by Claude', value: String(claudeRaised) },
  ];

  return (
    <div className="impact">
      {metrics.map(m => (
        <div key={m.label} className="impact__item">
          <div className="impact__value">{m.value}</div>
          <div className="impact__label">{m.label}</div>
        </div>
      ))}
    </div>
  );
}
