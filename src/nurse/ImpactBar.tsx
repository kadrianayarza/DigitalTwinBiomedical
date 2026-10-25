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

  const open = data.alerts.filter(a => a.status === 'open').length;

  const metrics = [
    { label: 'Open alerts', value: String(open) },
    { label: 'Median ack time', value: medianAck === null ? '–' : duration(medianAck) },
    { label: 'Checked in (24 h)', value: `${checkedIn.size}/${data.patients.length}` },
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
