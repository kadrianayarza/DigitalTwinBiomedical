import { Suspense, lazy, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from './module_bindings';
import { DataProvider, myFamilyAccess, useData } from './lib/data';
import { currentRole, goToLogin, onLoginPage, type Role } from './lib/role';
import { careLabel, daysSince } from './lib/format';
import { Brand } from './components/ui';
import { useAdoptPatientParam } from './components/RoleSwitch';
import { ThemeSwitch } from './components/ThemeSwitch';
import { PatientView } from './patient/PatientView';
import { NurseDashboard } from './nurse/NurseDashboard';
import { FamilyView } from './family/FamilyView';
import {
  formatInviteCode,
  isValidEmail,
  normalizeEmail,
  normalizeInviteCode,
  passwordProblem,
} from '../spacetimedb/src/family.ts';
import { Login } from './Login';

const LandingTwin = lazy(() => import('./twin/LandingTwin'));

export default function App() {
  const role = currentRole();
  if (!role) return onLoginPage() ? <Login /> : <Landing />;
  return (
    <DataProvider>
      <RoleGate role={role} />
    </DataProvider>
  );
}

function Landing() {
  return (
    <div className="landing">
      <div className="landing__actions">
        <ThemeSwitch />
        <button className="btn btn--primary landing__login" onClick={goToLogin}>
          Log in
        </button>
      </div>
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
  if (role === 'family') {
    const access = data.me?.role === 'family' ? myFamilyAccess(data) : undefined;
    const followed = access && data.patients.find(p => p.id === access.patientId);
    if (access?.status === 'active' && followed) return <FamilyView access={access} patient={followed} />;
    return <FamilySignIn removed={access?.status === 'revoked'} />;
  }
  if (!data.me || data.me.role !== role) return <Onboarding role={role} />;
  if (role === 'nurse') return <NurseDashboard />;
  const patient = data.patients.find(p => p.id === data.me!.patientId);
  if (!patient) return <Onboarding role={role} />;
  return <PatientView key={String(patient.id)} patient={patient} />;
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
        <button className="btn btn--ghost back" onClick={goToLogin}>
          ← Back
        </button>
        {role === 'nurse' ? (
          <>
            <div className="kicker">Demo 02 · Nurse</div>
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
            <div className="kicker">Demo 01 · Patient</div>
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

/**
 * Family members join with the code the patient gave them. Once they save a login,
 * they can sign back in on any device without a new code.
 */
function FamilySignIn({ removed }: { removed: boolean }) {
  const data = useData();
  const redeem = useReducer(reducers.redeemFamilyInvite);
  const saveLogin = useReducer(reducers.setFamilyLogin);
  const signIn = useReducer(reducers.signInFamily);
  const [mode, setMode] = useState<'invite' | 'login'>('invite');
  const [name, setName] = useState('');
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Failed sign-ins come back through a view, so only show notices newer than the last one seen.
  const [seenNotice, setSeenNotice] = useState<bigint | null>(null);
  const clean = normalizeInviteCode(code);
  const notice = data.familySignin[0];
  const noticeText =
    notice && notice.at.microsSinceUnixEpoch !== seenNotice && !busy && mode === 'login' ? notice.message : null;

  const wantsLogin = email.trim() !== '' || password !== '';
  const loginProblem = !wantsLogin
    ? null
    : !isValidEmail(normalizeEmail(email))
      ? 'Enter a valid email address'
      : passwordProblem(password);

  const switchMode = (next: 'invite' | 'login') => {
    setMode(next);
    setError(null);
    setPassword('');
    setSeenNotice(notice?.at.microsSinceUnixEpoch ?? null);
  };

  const submitInvite = async () => {
    setBusy(true);
    setError(null);
    try {
      await redeem({ code: clean, displayName: name });
      // If this fails the member is still in; their page offers to save the login again.
      if (wantsLogin && !loginProblem) await saveLogin({ email, password }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async () => {
    setSeenNotice(notice?.at.microsSinceUnixEpoch ?? null);
    setBusy(true);
    setError(null);
    try {
      await signIn({ email, password });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <main className="landing__inner landing__inner--narrow">
        <button className="btn btn--ghost back" onClick={goToLogin}>
          ← Back
        </button>
        <div className="kicker">Access 03 · Family</div>
        <h1 className="titlecard titlecard--sm">{mode === 'invite' ? "Follow someone's recovery" : 'Welcome back'}</h1>
        <div className="seg familysignin__mode" role="tablist" aria-label="How do you want to sign in?">
          <button
            role="tab"
            aria-selected={mode === 'invite'}
            className={mode === 'invite' ? 'seg__btn seg__btn--on' : 'seg__btn'}
            onClick={() => switchMode('invite')}
          >
            I have an invite code
          </button>
          <button
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'seg__btn seg__btn--on' : 'seg__btn'}
            onClick={() => switchMode('login')}
          >
            I already have a login
          </button>
        </div>
        {removed ? (
          <p className="banner banner--info" role="status">
            Your access was turned off by the patient or their care team. If they send you a new code, enter it below.
          </p>
        ) : mode === 'invite' ? (
          <p className="landing__lead familysignin__lead">
            Ask the person you care for to open <strong>Family access</strong> in their app and send you a code. You
            will see the updates they chose to share and get a message if something major changes.
          </p>
        ) : (
          <p className="landing__lead familysignin__lead">
            Use the email and password you saved when you first joined. This works on any phone or computer.
          </p>
        )}
        {mode === 'invite' ? (
          <form
            className="signin"
            onSubmit={e => {
              e.preventDefault();
              void submitInvite();
            }}
          >
            <label className="field">
              <span className="field__label">Your name</span>
              <input
                className="input"
                value={name}
                autoComplete="name"
                placeholder="For example, Ana Becker"
                onChange={e => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Invite code</span>
              <input
                className="input familysignin__code mono"
                value={code}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="one-time-code"
                placeholder="ABC-234"
                maxLength={12}
                onChange={e => setCode(e.target.value)}
                onBlur={() => clean.length === 6 && setCode(formatInviteCode(clean))}
              />
            </label>
            <fieldset className="familysignin__save">
              <legend className="field__label">Save a login (optional)</legend>
              <p className="muted small familysignin__hint">
                So you can sign in again on another phone or computer without a new code.
              </p>
              <label className="field">
                <span className="field__label">Email</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  autoComplete="email"
                  placeholder="you@example.com"
                  onChange={e => setEmail(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Password</span>
                <input
                  className="input"
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  onChange={e => setPassword(e.target.value)}
                />
              </label>
              {loginProblem && <p className="muted small">{loginProblem}</p>}
            </fieldset>
            <button
              type="submit"
              className="btn btn--primary btn--lg"
              disabled={busy || !name.trim() || clean.length !== 6 || !!loginProblem}
            >
              {busy ? 'Checking…' : 'Start following'}
            </button>
          </form>
        ) : (
          <form
            className="signin"
            onSubmit={e => {
              e.preventDefault();
              void submitLogin();
            }}
          >
            <label className="field">
              <span className="field__label">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                autoComplete="username"
                placeholder="you@example.com"
                onChange={e => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={e => setPassword(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="btn btn--primary btn--lg"
              disabled={busy || !isValidEmail(normalizeEmail(email)) || !password}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="muted small">
              Forgot it? Ask the person you follow for a new invite code, then save a new login.
            </p>
          </form>
        )}
        {(error || noticeText) && (
          <p className="error" role="alert">
            {error ?? noticeText}
          </p>
        )}
        <p className="muted small">
          You can only see what the patient shares with you. They can turn your access off at any time.
        </p>
      </main>
    </div>
  );
}
