import { useRef, useState, type FormEvent } from 'react';
import { goToRole } from './lib/role';
import { Brand } from './components/ui';
import { ThemeSwitch } from './components/ThemeSwitch';

type Mode = 'login' | 'signup';

export function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [notice, setNotice] = useState(false);
  const demoRef = useRef<HTMLElement>(null);

  // Real accounts aren't wired up yet; every sign-in path points at the demo access below.
  const pointToDemo = () => {
    setNotice(true);
    demoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    demoRef.current?.classList.remove('login__demo--flash');
    void demoRef.current?.offsetWidth;
    demoRef.current?.classList.add('login__demo--flash');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    pointToDemo();
  };

  return (
    <div className="landing">
      <div className="landing__actions">
        <ThemeSwitch />
      </div>
      <button className="btn btn--ghost back login__back" onClick={() => goToRole(null)}>
        ← Back
      </button>
      <main className="landing__inner login">
        <div className="login__head">
          <Brand />
          <h1 className="login__title">{mode === 'login' ? 'Log in' : 'Create your account'}</h1>
          <p className="muted">
            {mode === 'login'
              ? 'Welcome back. Choose how you want to sign in.'
              : 'For patients and care teams. Your health system may set this up for you.'}
          </p>
        </div>

        <div className="login__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'login'}
            className={`login__tab ${mode === 'login' ? 'login__tab--on' : ''}`}
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            role="tab"
            aria-selected={mode === 'signup'}
            className={`login__tab ${mode === 'signup' ? 'login__tab--on' : ''}`}
            onClick={() => setMode('signup')}
          >
            Create account
          </button>
        </div>

        <div className="login__providers">
          <button className="btn login__provider" onClick={pointToDemo}>
            <GoogleIcon />
            Continue with Google
          </button>
          <button className="btn login__provider" onClick={pointToDemo}>
            <MicrosoftIcon />
            Continue with Microsoft
          </button>
          <button className="btn login__provider" onClick={pointToDemo}>
            <HospitalIcon />
            Continue with your health system (SSO)
          </button>
        </div>

        <div className="login__or">
          <span>or use email</span>
        </div>

        <form className="signin" onSubmit={submit}>
          {mode === 'signup' && (
            <label className="field">
              <span className="field__label">Full name</span>
              <input className="input" autoComplete="name" />
            </label>
          )}
          <label className="field">
            <span className="field__label">Email</span>
            <input className="input" type="email" autoComplete="email" />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          <button type="submit" className="btn btn--primary btn--lg">
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        {notice && (
          <p className="login__notice" role="status">
            Accounts aren't switched on in this demo. Use a demo account below, no sign-in needed.
          </p>
        )}

        <section className="login__demo" ref={demoRef} aria-labelledby="demo-access">
          <div className="kicker" id="demo-access">
            Demo access · no account needed
          </div>
          <div className="landing__choices">
            <button className="choice" onClick={() => goToRole('patient')}>
              <span className="choice__code">Demo 01</span>
              <span className="choice__title">I'm a patient</span>
              <span className="choice__desc">Check in from home</span>
            </button>
            <button className="choice" onClick={() => goToRole('nurse')}>
              <span className="choice__code">Demo 02</span>
              <span className="choice__title">I'm a medical professional</span>
              <span className="choice__desc">Open the follow-up console</span>
            </button>
            <button className="choice" onClick={() => goToRole('family')}>
              <span className="choice__code">Demo 03</span>
              <span className="choice__title">I'm family</span>
              <span className="choice__desc">Follow someone's recovery</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="login__icon" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="login__icon" viewBox="0 0 22 22" aria-hidden>
      <rect x="0" y="0" width="10" height="10" fill="#F25022" />
      <rect x="12" y="0" width="10" height="10" fill="#7FBA00" />
      <rect x="0" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

function HospitalIcon() {
  return (
    <svg
      className="login__icon login__icon--line"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 21V7l8-4 8 4v14" />
      <path d="M2 21h20" />
      <path d="M12 8v6M9 11h6" />
      <path d="M10 21v-3h4v3" />
    </svg>
  );
}
