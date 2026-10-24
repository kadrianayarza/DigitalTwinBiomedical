import { useMemo, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Alert } from '../module_bindings/types';
import { activeAlertFor, symptomsFor, useData, vitalsFor } from '../lib/data';
import { PRIORITY_LABEL, SCENARIO_LABEL, careLabel, clock, daysSince, isSurgical, timeAgo, usesWheelchair } from '../lib/format';
import { TwinViewer, type TwinPin, type TwinPointer } from '../twin/TwinViewer';
import { buildHotspots } from '../twin/hotspots';
import { regionLabel } from '../twin/bodyModel';
import { PodVitals } from '../components/PodVitals';
import { Brand, Hex, Panel, SeverityHex, type HexTone } from '../components/ui';
import { RoleSwitch } from '../components/RoleSwitch';
import { SbarPanel } from './SbarPanel';
import { ImpactBar } from './ImpactBar';

const PRIORITY_TONE: Record<string, HexTone> = {
  emergency: 'alarm',
  same_day: 'alarm',
  review_24h: 'watch',
  routine: 'info',
};

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
        <Brand sub="Nurse console" />
        <ImpactBar />
        <div className="topbar__who">
          <strong>{data.me?.name}</strong>
        </div>
        {selected && (
          <RoleSwitch to="patient" patientId={selected.id} patientName={selected.name} />
        )}
      </header>

      <div className="nurse__grid">
        <aside className="census panel">
          <header className="panel__head">
            <h2 className="panel__title">Patients</h2>
            <span className="panel__code">{census.length} at home</span>
          </header>
          <div className="census__list">
            {census.map(({ p, alert }) => {
              const v = vitalsFor(data, p.id).at(-1);
              const online = data.profiles.some(u => u.role === 'patient' && u.patientId === p.id && u.online);
              return (
                <button
                  key={String(p.id)}
                  className={`census__row ${selected?.id === p.id ? 'census__row--on' : ''} ${
                    alert?.status === 'open' ? 'census__row--open' : ''
                  }`}
                  onClick={() => setSelectedId(p.id)}
                  aria-pressed={selected?.id === p.id}
                >
                  <PriorityHex alert={alert} />
                  <span className="census__body">
                    <span className="census__top">
                      <span className="census__name">{p.name}</span>
                      {online && <span className="census__online">Online</span>}
                    </span>
                    <span className="census__prio">{alert ? PRIORITY_LABEL[alert.priority] : 'Stable'}</span>
                    <span className="census__meta mono">
                      {p.age}y · {careLabel(p)} · D{String(daysSince(p.surgeryAt)).padStart(2, '0')}
                      {v && ` · HR ${v.hr.toFixed(0)}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
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

function PriorityHex({ alert }: { alert: Alert | undefined }) {
  if (!alert) return <Hex tone="ok" label="Stable" />;
  return <Hex tone={PRIORITY_TONE[alert.priority] ?? 'info'} label={PRIORITY_LABEL[alert.priority]} />;
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
  const top = alerts[0];

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
    .map(p => ({ id: p.identity.toHexString(), name: p.name, x: p.x, y: p.y, z: p.z, color: '#0f8a4d' }));

  return (
    <>
      <section className="detail">
        <header className="detail__head">
          <div className="kicker">
            Patient {String(patient.id).padStart(4, '0')} · {isSurgical(patient) ? 'Post-op day' : 'Monitoring day'}{' '}
            {daysSince(patient.surgeryAt)}
          </div>
          <h1 className="titlecard titlecard--name">{patient.name}</h1>
          <div className="detail__meta mono">
            {patient.age} y · {careLabel(patient)} · at home
            {top && (
              <span className={`detail__flag detail__flag--${PRIORITY_TONE[top.priority] ?? 'info'}`}>
                {PRIORITY_LABEL[top.priority]}
              </span>
            )}
          </div>
        </header>

        <div className="detail__body">
          <div className="detail__twin">
            <TwinViewer
              side={patient.side === 'left' ? 'left' : 'right'}
              pins={pins}
              pointers={pointers}
              selectedPinId={selectedPin}
              onSelectPin={onSelectPin}
              onHover={onHover}
              twinUrl={patient.twinUrl}
              seated={usesWheelchair(patient)}
              hotspots={buildHotspots({ vitals, audience: 'nurse' })}
              compact
            />
          </div>
          <Panel title="Check-ins" code={`${symptoms.length} total`} className="detail__timeline">
            {symptoms.length === 0 ? (
              <p className="muted">No check-ins yet.</p>
            ) : (
              <ul className="list">
                {symptoms.slice(0, 8).map(s => (
                  <li key={String(s.id)}>
                    <button
                      className={`list__row list__row--click ${selectedPin === String(s.id) ? 'list__row--on' : ''}`}
                      onClick={() => onSelectPin(String(s.id))}
                    >
                      <SeverityHex severity={s.severity} />
                      <span className="list__main">
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
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {(s.chestPain || s.shortnessOfBreath) && (
                          <span className="list__danger">Chest pain or breathing trouble reported</span>
                        )}
                      </span>
                      <span className="mono muted small">{clock(s.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <PodVitals vitals={vitals} detailed />
      </section>

      <aside className="rail">
        <div className="rail__head">
          <h2 className="panel__title">Alerts</h2>
          <span className="panel__code">
            {alerts.length} active{resolvedCount > 0 && ` · ${resolvedCount} resolved`}
          </span>
        </div>
        {alerts.length === 0 ? (
          <div className="panel rail__empty">
            <Hex tone="ok" /> No active alerts.
          </div>
        ) : (
          alerts.map(a => (
            <SbarPanel key={String(a.id)} alert={a} report={data.reports.find(r => r.alertId === a.id)} />
          ))
        )}

        <Panel title="Audit trail" code="Read-only log" className="auditpanel">
          <ol className="audit">
            {audit.map(e => (
              <li key={String(e.id)}>
                <span className="audit__ts">{clock(e.ts)}</span>
                <span className="audit__line">
                  <span className="audit__actor">{e.actorName}</span> {e.action.replace(/_/g, ' ')}
                  {e.detail && <span className="audit__detail"> · {e.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <details className="panel demo">
          <summary>Demo controls</summary>
          <div className="demo__row">
            <span className="small muted">Simulated pod pattern for {patient.name.split(' ')[0]}</span>
            <div className="chips">
              {Object.entries(SCENARIO_LABEL).map(([k, label]) => (
                <button
                  key={k}
                  className={`chip ${sim?.scenario === k ? 'chip--on' : ''}`}
                  aria-pressed={sim?.scenario === k}
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
