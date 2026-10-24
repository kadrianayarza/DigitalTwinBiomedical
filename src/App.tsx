import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from './module_bindings';
import { DataProvider, useData } from './lib/data';
import { currentRole, goToRole, type Role } from './lib/role';
import { daysSince } from './lib/format';
import { PatientView } from './patient/PatientView';
import { NurseDashboard } from './nurse/NurseDashboard';

export default function App() {
  const role = currentRole();
  if (!role) return <Landing />;
  return (
    <DataProvider>
      <RoleGate role={role} />
    </DataProvider>
  );
}

function Landing() {
  return (
    <div className="landing">
      <div className="landing__card">
        <div className="brand brand--lg">TwinCare</div>
        <p className="landing__lead">
          A live 3D twin for knee-replacement recovery at home. Patients tap or talk to report symptoms; their nurse
          sees it instantly, with an AI-drafted handoff to review.
        </p>
        <div className="landing__choices">
          <button className="choice" onClick={() => goToRole('patient')}>
            <span className="choice__title">I'm a patient</span>
            <span className="muted">Check in from home</span>
          </button>
          <button className="choice" onClick={() => goToRole('nurse')}>
            <span className="choice__title">I'm a nurse</span>
            <span className="muted">Open the follow-up dashboard</span>
          </button>
        </div>
        <p className="muted small">Prototype with fictional patients. Not a medical device.</p>
      </div>
    </div>
  );
}

function RoleGate({ role }: { role: Role }) {
  const data = useData();
  if (!data.connected || !data.patientsReady) {
    return <div className="center muted">Connecting…</div>;
  }
  if (!data.me || data.me.role !== role) return <Onboarding role={role} />;
  if (role === 'nurse') return <NurseDashboard />;
  const patient = data.patients.find(p => p.id === data.me!.patientId);
  if (!patient) return <Onboarding role={role} />;
  return <PatientView patient={patient} />;
}

function Onboarding({ role }: { role: Role }) {
  const data = useData();
  const setProfile = useReducer(reducers.setProfile);
  const [name, setName] = useState(role === 'nurse' ? 'Marcus, RN' : '');
  const [error, setError] = useState<string | null>(null);

  const join = (patientId: bigint, displayName: string) =>
    setProfile({ name: displayName, role, patientId }).catch(e => setError(String(e)));

  return (
    <div className="landing">
      <div className="landing__card">
        <button className="btn btn--ghost back" onClick={() => goToRole(null)}>
          ← Back
        </button>
        {role === 'nurse' ? (
          <>
            <h2>Nurse sign-in</h2>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            <button className="btn btn--primary btn--lg" onClick={() => void join(0n, name)}>
              Open dashboard
            </button>
          </>
        ) : (
          <>
            <h2>Who's checking in?</h2>
            <div className="landing__choices landing__choices--list">
              {data.patients.map(p => (
                <button key={String(p.id)} className="choice" onClick={() => void join(p.id, p.name)}>
                  <span className="choice__title">{p.name}</span>
                  <span className="muted">
                    {p.side} knee · day {daysSince(p.surgeryAt)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
