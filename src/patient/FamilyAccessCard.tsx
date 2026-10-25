import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { familyFor, inviteCodeFor, useData } from '../lib/data';
import { timeAgo } from '../lib/format';
import {
  FAMILY_ALERT_LEVELS,
  FAMILY_ALERT_LEVEL_HINT,
  FAMILY_ALERT_LEVEL_LABEL,
  FAMILY_MAX_MEMBERS,
  RELATIONSHIPS,
  formatInviteCode,
  type FamilyAlertLevel,
} from '../../spacetimedb/src/family.ts';
import { Panel } from '../components/ui';

function inviteLink(code: string) {
  return `${window.location.origin}${window.location.pathname}?role=family&code=${code}`;
}

/**
 * Where the patient decides who in their family can follow along, what they see, and
 * which alerts reach them. Nothing is shared until the patient creates an invite.
 */
export function FamilyAccessCard({ patientId }: { patientId: bigint }) {
  const data = useData();
  const invite = useReducer(reducers.inviteFamilyMember);
  const update = useReducer(reducers.updateFamilyAccess);
  const revoke = useReducer(reducers.revokeFamilyAccess);
  const members = familyFor(data, patientId);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<string>(RELATIONSHIPS[0]);
  const [level, setLevel] = useState<FamilyAlertLevel>('major');
  const [chart, setChart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<bigint | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<bigint | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const ok = await run(() =>
      invite({ memberName: name, relationship, alertLevel: level, canViewChart: chart })
    );
    if (ok) {
      setAdding(false);
      setName('');
    }
  };

  const copy = async (accessId: bigint, code: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      setCopied(accessId);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy. Read the code out instead.');
    }
  };

  return (
    <Panel
      title="Family access"
      code={members.length === 0 ? 'Not shared' : `${members.length} of ${FAMILY_MAX_MEMBERS}`}
      className="family"
      collapsible
    >
      <p className="muted small family__lead">
        Let someone you trust follow your recovery. They get a message when something major changes, and only see your
        chart if you allow it.
      </p>

      {members.length > 0 && (
        <ul className="family__list">
          {members.map(m => {
            const code = inviteCodeFor(data, m.id);
            const level = m.alertLevel as FamilyAlertLevel;
            return (
              <li key={String(m.id)} className={`family__member family__member--${m.status}`}>
                <div className="family__who">
                  <strong>{m.memberName}</strong>
                  <span className="muted small">{m.relationship}</span>
                  <span className={`tag ${m.status === 'active' ? 'tag--ok' : ''}`}>
                    {m.status === 'active'
                      ? `Following${m.acceptedAt ? ` · joined ${timeAgo(m.acceptedAt)}` : ''}`
                      : 'Waiting to join'}
                  </span>
                </div>

                {m.status === 'invited' && code && (
                  <div className="family__code">
                    <span className="muted small">Give them this code</span>
                    <span className="family__codevalue mono">{formatInviteCode(code)}</span>
                    <button className="btn btn--ghost" onClick={() => void copy(m.id, code)}>
                      {copied === m.id ? 'Link copied' : 'Copy invite link'}
                    </button>
                  </div>
                )}

                <div className="family__settings">
                  <div className="family__levels" role="radiogroup" aria-label={`Alerts for ${m.memberName}`}>
                    {FAMILY_ALERT_LEVELS.map(l => (
                      <button
                        key={l}
                        role="radio"
                        aria-checked={level === l}
                        className={`chip ${level === l ? 'chip--on' : ''}`}
                        disabled={busy}
                        onClick={() =>
                          void run(() => update({ accessId: m.id, alertLevel: l, canViewChart: m.canViewChart }))
                        }
                      >
                        {FAMILY_ALERT_LEVEL_LABEL[l]}
                      </button>
                    ))}
                  </div>
                  <label className="family__chart">
                    <input
                      type="checkbox"
                      checked={m.canViewChart}
                      disabled={busy}
                      onChange={e =>
                        void run(() => update({ accessId: m.id, alertLevel: level, canViewChart: e.target.checked }))
                      }
                    />
                    Can see my vitals, medicines, and check-ins
                  </label>
                </div>

                <div className="family__actions">
                  {confirmRemove === m.id ? (
                    <>
                      <span className="small">Remove {m.memberName.split(' ')[0]}'s access?</span>
                      <button
                        className="btn btn--danger"
                        disabled={busy}
                        onClick={() => void run(() => revoke({ accessId: m.id })).then(() => setConfirmRemove(null))}
                      >
                        Remove
                      </button>
                      <button className="btn btn--ghost" onClick={() => setConfirmRemove(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button className="btn btn--ghost" onClick={() => setConfirmRemove(m.id)}>
                      {m.status === 'invited' ? 'Cancel invite' : 'Remove access'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <form
          className="family__form"
          onSubmit={e => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="family__grid">
            <label className="field">
              <span className="field__label">Their name</span>
              <input className="input" value={name} onChange={e => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Who they are</span>
              <select className="input" value={relationship} onChange={e => setRelationship(e.target.value)}>
                {RELATIONSHIPS.map(r => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="family__fieldset">
            <legend className="field__label">Message them about</legend>
            {FAMILY_ALERT_LEVELS.map(l => (
              <label key={l} className="family__option">
                <input type="radio" name="family-level" checked={level === l} onChange={() => setLevel(l)} />
                <span>
                  <strong>{FAMILY_ALERT_LEVEL_LABEL[l]}</strong>
                  <span className="muted small"> · {FAMILY_ALERT_LEVEL_HINT[l]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="family__chart">
            <input type="checkbox" checked={chart} onChange={e => setChart(e.target.checked)} />
            Also let them see my vitals, medicines, and check-ins
          </label>
          <div className="family__formactions">
            <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
              Create invite code
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        members.length < FAMILY_MAX_MEMBERS && (
          <button className="btn family__add" onClick={() => setAdding(true)}>
            + Add a family member
          </button>
        )
      )}
      {error && <p className="error small">{error}</p>}
    </Panel>
  );
}

/** Read-only list for the nurse, who can also withdraw access on the patient's behalf. */
export function FamilyRoster({ patientId }: { patientId: bigint }) {
  const data = useData();
  const revoke = useReducer(reducers.revokeFamilyAccess);
  const members = familyFor(data, patientId);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title="Family access" code={members.length === 0 ? 'None' : `${members.length}`} collapsible>
      {members.length === 0 ? (
        <p className="muted small">The patient has not authorised anyone.</p>
      ) : (
        <ul className="family__roster">
          {members.map(m => (
            <li key={String(m.id)}>
              <strong>{m.memberName}</strong>
              <span className="muted small">
                {m.relationship} · {FAMILY_ALERT_LEVEL_LABEL[m.alertLevel as FamilyAlertLevel] ?? m.alertLevel}
                {m.canViewChart ? ' · sees chart' : ' · alerts only'}
              </span>
              <span className={`tag ${m.status === 'active' ? 'tag--ok' : ''}`}>
                {m.status === 'active' ? 'Following' : 'Invited'}
              </span>
              <button
                className="btn btn--ghost"
                onClick={() =>
                  void revoke({ accessId: m.id }).catch(e => setError(e instanceof Error ? e.message : String(e)))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error small">{error}</p>}
    </Panel>
  );
}
