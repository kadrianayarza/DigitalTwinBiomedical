import { useEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { FamilyAccess, Patient } from '../module_bindings/types';
import {
  activeAlertFor,
  dosesFor,
  familyAlertsFor,
  medicationsFor,
  symptomsFor,
  useData,
  vitalsFor,
} from '../lib/data';
import { careLabel, daysSince, timeAgo } from '../lib/format';
import { forgetIdentity, goToRole } from '../lib/role';
import { regionLabel } from '../twin/bodyModel';
import { PodVitals } from '../components/PodVitals';
import { CareMessagesCard } from '../components/CareMessagesCard';
import { Brand, Panel, SeverityHex } from '../components/ui';
import {
  FAMILY_ALERT_LEVEL_LABEL,
  familyMessage,
  isValidEmail,
  normalizeEmail,
  passwordProblem,
  type FamilyAlertLevel,
} from '../../spacetimedb/src/family.ts';

const DOSE_WORD: Record<string, string> = {
  taken: 'Taken',
  skipped: 'Skipped',
  missed: 'Missed',
  due: 'Due now',
};

function canNotify() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** What an authorised family member sees: plain-language alerts and, if allowed, a read-only chart. */
export function FamilyView({ access, patient }: { access: FamilyAccess; patient: Patient }) {
  const data = useData();
  const markRead = useReducer(reducers.markFamilyAlertsRead);
  const firstName = patient.name.split(' ')[0] ?? patient.name;
  const notices = familyAlertsFor(data, access.id);
  const unread = notices.filter(n => !n.readAt).length;
  const alert = activeAlertFor(data, patient.id);
  const current = alert ? familyMessage('opened', alert.priority, alert.reasonCodes, firstName) : null;
  const major = alert && (alert.priority === 'same_day' || alert.priority === 'emergency');

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    canNotify() ? Notification.permission : 'unsupported'
  );
  const [toast, setToast] = useState<string | null>(null);

  // Announce notices that arrive while the page is open, but not the backlog on first load.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(notices.map(n => String(n.id)));
    if (seen.current === null) {
      seen.current = ids;
      return;
    }
    const fresh = notices.filter(n => !seen.current!.has(String(n.id)));
    seen.current = ids;
    const newest = fresh[0];
    if (!newest) return;
    setToast(newest.title);
    window.setTimeout(() => setToast(null), 6000);
    if (permission === 'granted') {
      try {
        new Notification(newest.title, { body: newest.body, tag: `family-${String(newest.id)}` });
      } catch {
        // Some browsers only allow notifications from a service worker; the toast still shows.
      }
    }
  }, [notices, permission]);

  const askPermission = async () => {
    if (!canNotify()) return;
    setPermission(await Notification.requestPermission());
  };

  const symptoms = symptomsFor(data, patient.id).slice(0, 6);
  const vitals = vitalsFor(data, patient.id);
  const meds = medicationsFor(data, patient.id);
  const doses = dosesFor(data, patient.id);

  return (
    <div className="familyview">
      <header className="topbar">
        <Brand />
        <div className="topbar__who">
          <strong>Following {firstName}</strong>
          <span className="mono">
            Day {String(daysSince(patient.surgeryAt)).padStart(2, '0')} · {careLabel(patient)}
          </span>
        </div>
        <button
          className="btn btn--ghost familyview__out"
          title={data.familyLogin.length > 0 ? 'Sign out of this browser' : 'Leave; this browser stays signed in'}
          onClick={() => {
            // Without a saved login, forgetting the identity would lock the member out for good.
            if (data.familyLogin.length > 0) forgetIdentity('family');
            goToRole(null);
          }}
        >
          Sign out
        </button>
      </header>

      <main className="familyview__body">
        {current && major ? (
          <div
            className={`banner ${alert!.priority === 'emergency' ? 'banner--emergency' : 'banner--info'}`}
            role={alert!.priority === 'emergency' ? 'alert' : 'status'}
          >
            <span className="banner__title">{current.title}</span>
            <span>{current.body}</span>
            {alert!.status !== 'open' && (
              <span className="small">{alert!.ackedByName || 'The nurse'} has seen it.</span>
            )}
          </div>
        ) : (
          <div className="banner banner--ok" role="status">
            No major concerns right now. We will message you here if that changes.
          </div>
        )}

        <Panel
          title="Care updates"
          code={unread > 0 ? `${unread} new` : `${notices.length} total`}
          className="familyview__messages"
          collapsible
        >
          <div className="familyview__bar">
            <span className="muted small">
              You get: <strong>{FAMILY_ALERT_LEVEL_LABEL[access.alertLevel as FamilyAlertLevel] ?? 'Major changes'}</strong>
            </span>
            {permission === 'default' && (
              <button className="btn" onClick={() => void askPermission()}>
                Notify me on this device
              </button>
            )}
            {permission === 'granted' && <span className="tag tag--ok">Device notifications on</span>}
            {unread > 0 && (
              <button className="btn btn--ghost" onClick={() => void markRead().catch(() => {})}>
                Mark all as read
              </button>
            )}
          </div>
          {notices.length === 0 ? (
            <p className="muted small">
              No messages yet. You will only hear from us when the care team needs to look at something.
            </p>
          ) : (
            <ul className="familyview__list">
              {notices.slice(0, 20).map(n => (
                <li
                  key={String(n.id)}
                  className={`familynote familynote--${n.event} familynote--${n.priority} ${n.readAt ? '' : 'familynote--unread'}`}
                >
                  <div className="familynote__top">
                    <strong>{n.title}</strong>
                    <span className="mono muted small">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="familynote__body">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <CareMessagesCard patientId={patient.id} patientName={patient.name} mode="family" />

        {access.canViewChart ? (
          <div className="familyview__chart">
            <PodVitals vitals={vitals} />
            <Panel title={`${firstName}'s check-ins`} code={`${symptoms.length} recent`} collapsible>
              {symptoms.length === 0 ? (
                <p className="muted small">No check-ins yet.</p>
              ) : (
                <ul className="list">
                  {symptoms.map(s => (
                    <li key={String(s.id)} className="list__row">
                      <SeverityHex severity={s.severity} />
                      <span className="list__main">
                        {regionLabel(s.region)}
                        <span className="muted small">{s.quality || 'pain'}</span>
                      </span>
                      <span className="mono muted small">{timeAgo(s.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={`${firstName}'s medicines`} code={`${meds.length} active`} collapsible>
              {meds.length === 0 ? (
                <p className="muted small">No medicines on file.</p>
              ) : (
                <ul className="list">
                  {meds.map(m => {
                    const last = doses.find(d => d.medicationId === m.id);
                    return (
                      <li key={String(m.id)} className="list__row familyview__med">
                        <span className="list__main">
                          {m.name}
                          <span className="muted small">{m.dose}</span>
                        </span>
                        <span className={`mono small familyview__dose familyview__dose--${last?.status ?? 'none'}`}>
                          {last ? `${DOSE_WORD[last.status] ?? last.status} · ${timeAgo(last.scheduledFor)}` : '–'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        ) : (
          <Panel title="Chart" code="Not shared">
            <p className="muted small">
              {firstName} shares alerts with you but not their chart. They can change this in Family access.
            </p>
          </Panel>
        )}

        <FamilyLoginPanel />

        <p className="muted small familyview__foot">
          If you think {firstName} needs urgent help, call 911. This app does not replace their care team.
        </p>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** Lets a member save or change the email and password they use on other devices. */
function FamilyLoginPanel() {
  const data = useData();
  const save = useReducer(reducers.setFamilyLogin);
  const login = data.familyLogin[0];
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const problem = !isValidEmail(normalizeEmail(email)) ? 'Enter a valid email address' : passwordProblem(password);
  const showForm = !login || editing;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await save({ email, password });
      setEditing(false);
      setPassword('');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Sign in on other devices" code={login ? 'Login saved' : 'No login yet'} collapsible>
      {login && !editing && (
        <div className="familylogin__saved">
          <p className="small">
            You sign in with <strong>{login.email}</strong>. Use it on any phone or computer; signing in somewhere new
            signs this browser out.
          </p>
          {saved && <span className="tag tag--ok">Saved</span>}
          <button
            className="btn btn--ghost"
            onClick={() => {
              setEmail(login.email);
              setEditing(true);
              setSaved(false);
            }}
          >
            Change email or password
          </button>
        </div>
      )}
      {showForm && (
        <form
          className="familylogin__form"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          {!login && (
            <p className="muted small">
              Right now only this browser can open this page. Save a login so you can sign in on another device without
              a new code.
            </p>
          )}
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
          <div className="familylogin__actions">
            <button type="submit" className="btn btn--primary" disabled={busy || !!problem}>
              {busy ? 'Saving…' : 'Save login'}
            </button>
            {editing && (
              <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          {(email || password) && problem && <p className="muted small">{problem}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </Panel>
  );
}
