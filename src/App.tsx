import { Suspense, lazy, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from './module_bindings';
import { DataProvider, useData } from './lib/data';
import { currentRole, goToRole, type Role } from './lib/role';
import { careLabel, daysSince } from './lib/format';
import { Brand } from './components/ui';
import { useAdoptPatientParam } from './components/RoleSwitch';
import { PatientView } from './patient/PatientView';
import { NurseDashboard } from './nurse/NurseDashboard';

const LandingTwin = lazy(() => import('./twin/LandingTwin'));

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
      <main className="landing__hero">
        <div className="landing__copy">
          <div className="kicker">Symptom tracking · Early detection · Outcome simulation · Remote monitoring</div>
          <h1 className="titlecard titlecard--hero">
            <span className="titlecard__line">Digital Twin</span>
            <span className="titlecard__line titlecard__line--sub">Biomedical</span>
          </h1>
          <p className="landing__lead">
            A living 3D twin for care at home. Patients track symptoms where they feel them, catch complications
            early, and see how their recovery can unfold, while their nurse monitors remotely and approves every
            AI-drafted handoff.
          </p>
          <div className="landing__choices">
            <button className="choice" onClick={() => goToRole('patient')}>
              <span className="choice__code">Access 01</span>
              <span className="choice__title">I'm a patient</span>
              <span className="choice__desc">Check in from home</span>
            </button>
            <button className="choice" onClick={() => goToRole('nurse')}>
              <span className="choice__code">Access 02</span>
              <span className="choice__title">I'm a medical professional</span>
              <span className="choice__desc">Open the follow-up console</span>
            </button>
          </div>
        </div>
        <div className="landing__twin" aria-hidden>
          <Suspense fallback={null}>
            <LandingTwin />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function RoleGate({ role }: { role: Role }) {
  const data = useData();
  useAdoptPatientParam(role);
  if (!data.connected || !data.patientsReady) {
    return (
      <div className="connecting" role="status">
        <Brand />
        <span className="connecting__text">Connecting</span>
      </div>
    );
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
      <main className="landing__inner landing__inner--narrow">
        <button className="btn btn--ghost back" onClick={() => goToRole(null)}>
          ← Back
        </button>
        {role === 'nurse' ? (
          <>
            <div className="kicker">Access 02 · Nurse</div>
            <h1 className="titlecard titlecard--sm">Sign in</h1>
            <form
              className="signin"
              onSubmit={e => {
                e.preventDefault();
                void join(0n, name);
              }}
            >
              <label className="field">
                <span className="field__label">Your name</span>
                <input className="input" value={name} onChange={e => setName(e.target.value)} />
              </label>
              <button type="submit" className="btn btn--primary btn--lg" disabled={!name.trim()}>
                Open console
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="kicker">Access 01 · Patient</div>
            <h1 className="titlecard titlecard--sm">Who's checking in?</h1>
            <div className="landing__choices landing__choices--list">
              {data.patients.map(p => (
                <button key={String(p.id)} className="choice choice--row" onClick={() => void join(p.id, p.name)}>
                  <span className="choice__title">{p.name}</span>
                  <span className="choice__desc">
                    {careLabel(p)} · day {daysSince(p.surgeryAt)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}
