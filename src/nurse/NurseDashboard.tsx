import { useMemo, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { activeAlertFor, symptomsFor, useData, vitalsFor } from '../lib/data';
import { PRIORITY_LABEL, SCENARIO_LABEL, clock, daysSince, timeAgo } from '../lib/format';
import { TwinViewer, type TwinPin, type TwinPointer } from '../twin/TwinViewer';
import { buildHotspots } from '../twin/hotspots';
import { regionLabel } from '../twin/bodyModel';
import { PodVitals } from '../components/PodVitals';
import { SbarPanel } from './SbarPanel';
import { ImpactBar } from './ImpactBar';

export function NurseDashboard() {
  const data = useData();
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const [selectedPin, setSelectedPin] = useState<string | undefined>();
  const updatePointer = useReducer(reducers.updatePointer);

  const census = useMemo(
    () =>
      [...data.patients]
        .map(p => ({ p, alert: activeAlertFor(data, p.id) }))
        .sort((a, b) => {
          const ra = a.alert ? a.alert.rank + (a.alert.status === 'open' ? 0.5 : 0) : -1;
          const rb = b.alert ? b.alert.rank + (b.alert.status === 'open' ? 0.5 : 0) : -1;
          return rb - ra || a.p.name.localeCompare(b.p.name);
        }),
    [data]
  );

  const selected = data.patients.find(p => p.id === selectedId) ?? census[0]?.p;

  return (
    <div className="nurse">
      <header className="topbar topbar--nurse">
        <div className="brand">
          TwinCare <span className="brand__sub">Nurse</span>
        </div>
        <ImpactBar />
        <div className="topbar__who">
          <strong>{data.me?.name}</strong>
          <span className={`dot ${data.connected ? 'dot--on' : ''}`} />
        </div>
      </header>

      <div className="nurse__grid">
        <aside className="census">
          <div className="census__title">Post-op patients ({census.length})</div>
          {census.map(({ p, alert }) => {
            const v = vitalsFor(data, p.id).at(-1);
            const online = data.profiles.some(u => u.role === 'patient' && u.patientId === p.id && u.online);
            return (
              <button
                key={String(p.id)}
                className={`census__row ${selected?.id === p.id ? 'census__row--on' : ''}`}
                onClick={() => setSelectedId(p.id)}
              >
                <div className="census__top">
                  <span className="census__name">
                    {online && <span className="dot dot--on dot--sm" title="Patient online now" />}
                    {p.name}
                  </span>
                  {alert ? (
                    <span className={`prio prio--${alert.priority} ${alert.status === 'open' ? 'prio--open' : ''}`}>
                      {PRIORITY_LABEL[alert.priority]}
                    </span>
                  ) : (
                    <span className="prio prio--routine">Stable</span>
                  )}
                </div>
                <div className="census__meta muted small">
                  {p.age} · {p.side === 'left' ? 'L' : 'R'} TKA · day {daysSince(p.surgeryAt)}
                  {v && (
                    <>
                      {' '}
                      · HR {v.hr.toFixed(0)} · {v.incisionTempC.toFixed(1)}°C
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </aside>

        {selected ? (
          <PatientDetail
            key={String(selected.id)}
            patientId={selected.id}
            selectedPin={selectedPin}
            onSelectPin={setSelectedPin}
            onHover={p =>
              void updatePointer({
                patientId: selected.id,
                x: p?.[0] ?? 0,
                y: p?.[1] ?? 0,
                z: p?.[2] ?? 0,
                pointing: !!p,
              }).catch(() => {})
            }
          />
        ) : (
          <div className="empty">No patients yet.</div>
        )}
      </div>
    </div>
  );
}

function PatientDetail({
  patientId,
  selectedPin,
  onSelectPin,
  onHover,
}: {
  patientId: bigint;
  selectedPin?: string;
  onSelectPin: (id: string) => void;
  onHover: (p: [number, number, number] | null) => void;
}) {
  const data = useData();
  const setScenario = useReducer(reducers.setScenario);
  const resetDemo = useReducer(reducers.resetDemo);
  const patient = data.patients.find(p => p.id === patientId)!;
  const symptoms = symptomsFor(data, patientId);
  const vitals = vitalsFor(data, patientId);
  const alerts = data.alerts
    .filter(a => a.patientId === patientId && a.status !== 'resolved')
    .sort((a, b) => b.rank - a.rank);
  const resolvedCount = data.alerts.filter(a => a.patientId === patientId && a.status === 'resolved').length;
  const audit = data.audit
    .filter(a => a.patientId === patientId)
    .sort((a, b) => (a.ts.microsSinceUnixEpoch < b.ts.microsSinceUnixEpoch ? 1 : -1))
    .slice(0, 25);
  const sim = data.sims.find(s => s.patientId === patientId);

  const pins: TwinPin[] = symptoms.slice(0, 12).map(s => ({
    id: String(s.id),
    x: s.x,
    y: s.y,
    z: s.z,
    severity: s.severity,
    label: `${regionLabel(s.region)} · ${s.severity}/10 · ${timeAgo(s.createdAt)}`,
  }));
  const pointers: TwinPointer[] = data.presence
    .filter(p => p.patientId === patientId && p.pointing && p.role === 'patient')
    .map(p => ({ id: p.identity.toHexString(), name: p.name, x: p.x, y: p.y, z: p.z, color: '#12a594' }));

  return (
    <>
      <section className="detail">
        <div className="detail__head">
          <div>
            <h1>{patient.name}</h1>
            <div className="muted">
              {patient.age} y · {patient.side} total knee replacement · day {daysSince(patient.surgeryAt)} at home
            </div>
          </div>
        </div>

        <div className="detail__body">
          <div className="detail__twin">
            <TwinViewer
              side={patient.side === 'left' ? 'left' : 'right'}
              pins={pins}
              pointers={pointers}
              selectedPinId={selectedPin}
              onSelectPin={onSelectPin}
              onHover={onHover}
              hotspots={buildHotspots({ side: patient.side === 'left' ? 'left' : 'right', vitals, audience: 'nurse' })}
              initialFocus="knee"
              compact
            />
          </div>
          <div className="detail__timeline card">
            <div className="card__title">Check-ins</div>
            {symptoms.length === 0 ? (
              <p className="muted">No check-ins yet.</p>
            ) : (
              <ul className="list">
                {symptoms.slice(0, 8).map(s => (
                  <li
                    key={String(s.id)}
                    className={`list__row list__row--click ${selectedPin === String(s.id) ? 'list__row--on' : ''}`}
                    onClick={() => onSelectPin(String(s.id))}
                  >
                    <span className={`sev sev--${s.severity >= 7 ? 'hi' : s.severity >= 4 ? 'mid' : 'lo'}`}>
                      {s.severity}
                    </span>
                    <span className="opqrst">
                      <strong>{regionLabel(s.region)}</strong>
                      <span className="muted small">
                        {[
                          s.quality,
                          s.onset && `since ${s.onset.toLowerCase()}`,
                          s.provocation && `worse: ${s.provocation.toLowerCase()}`,
                          s.radiation,
                          s.timing,
                          s.swelling && 'swelling',
                          s.warmth && 'warm',
                          s.redness && 'red',
                          s.bodyTempC > 0 && `${((s.bodyTempC * 9) / 5 + 32).toFixed(1)}°F`,
                          (s.chestPain || s.shortnessOfBreath) && '⚠ chest/breathing',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="muted small">{clock(s.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <PodVitals vitals={vitals} detailed />
      </section>

      <aside className="rail">
        <div className="rail__title">
          Alerts {resolvedCount > 0 && <span className="muted small">· {resolvedCount} resolved</span>}
        </div>
        {alerts.length === 0 ? (
          <div className="card muted">No active alerts.</div>
        ) : (
          alerts.map(a => (
            <SbarPanel key={String(a.id)} alert={a} report={data.reports.find(r => r.alertId === a.id)} />
          ))
        )}

        <div className="card">
          <div className="card__title">Audit trail</div>
          <ul className="audit">
            {audit.map(e => (
              <li key={String(e.id)}>
                <span className="muted small">{clock(e.ts)}</span>
                <span>
                  <strong>{e.actorName}</strong> {e.action.replace(/_/g, ' ')}
                  {e.detail && <span className="muted"> — {e.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <details className="card demo">
          <summary>Demo controls</summary>
          <div className="demo__row">
            <span className="small muted">Pod scenario for {patient.name.split(' ')[0]}</span>
            <div className="chips">
              {Object.entries(SCENARIO_LABEL).map(([k, label]) => (
                <button
                  key={k}
                  className={`chip ${sim?.scenario === k ? 'chip--on' : ''}`}
                  onClick={() => void setScenario({ patientId, scenario: k })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn btn--ghost"
            onClick={() => {
              if (confirm('Clear all check-ins, alerts, reports, and vitals?')) void resetDemo();
            }}
          >
            Reset demo data
          </button>
        </details>
      </aside>
    </>
  );
}
