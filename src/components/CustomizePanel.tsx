import { useEffect, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { layoutFor, useData, userLayoutFor } from '../lib/data';
import {
  PRIORITIES,
  PRIORITY_LABEL,
  TABS,
  applyGoal,
  moveTab,
  metaFor,
  orderedTabs,
  serializeLayout,
  setEnabled,
  setPriority,
  type Layout,
  type Priority,
  type TabId,
} from '../lib/voice';
import { Panel } from './ui';

/** One-tap answers for people who would rather not type a goal. */
const GOAL_SUGGESTIONS = [
  'Get fitter and stronger',
  'Eat better',
  'Sleep deeper',
  'Manage my condition',
  'Keep an eye on my vitals',
  'Learn how my body works',
];

/**
 * Quick initial assessment plus tab arrangement. Patients arrange their own app
 * (stored per patient); with `self`, the signed-in user — the nurse — arranges
 * their own console instead (stored per identity).
 */
export function CustomizePanel({ patientId, self = false }: { patientId?: bigint; self?: boolean }) {
  const data = useData();
  const saveLayout = useReducer(reducers.savePatientLayout);
  const saveOwn = useReducer(reducers.saveUserLayout);
  const stored: Layout = self ? userLayoutFor(data, data.me?.identity) : layoutFor(data, patientId ?? 0n);

  const [draft, setDraft] = useState<Layout>(stored);
  const [goal, setGoal] = useState(stored.goal);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick up changes made from the other side, but not while editing here.
  const storedKey = serializeLayout(stored);
  useEffect(() => {
    setDraft(stored);
    setGoal(stored.goal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const persist = async (next: Layout, nextGoal = goal, assessed = next.assessed) => {
    setBusy(true);
    setError(null);
    try {
      if (self) {
        await saveOwn({ tabs: serializeLayout(next) });
      } else {
        await saveLayout({
          patientId: patientId ?? 0n,
          tabs: serializeLayout(next),
          goal: nextGoal,
          assessed,
        });
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const update = (tabs: Layout['tabs']) => {
    const next = { ...draft, tabs };
    setDraft(next);
    void persist(next);
  };

  const toggle = (id: TabId, on: boolean) => update(setEnabled(draft.tabs, id, on));
  const bump = (id: TabId, delta: number) => update(moveTab(draft.tabs, id, delta));
  const prioritise = (id: TabId, priority: Priority) => update(setPriority(draft.tabs, id, priority));

  const startAssessment = () => {
    const next = applyGoal(draft, goal);
    setDraft(next);
    void persist(next, goal, true);
  };

  const audience = self || data.me?.role === 'nurse' ? 'nurse' : 'patient';
  const shown = orderedTabs(draft.tabs).filter(t => metaFor(t.id)[audience]);

  return (
    <Panel
      title="Your app"
      code={draft.assessed ? 'Set up' : 'Quick set-up'}
      className="organize"
      collapsible
    >
      {!draft.assessed && (
        <div className="organize__intake">
          <label className="organize__ask" htmlFor="organize-goal">
            What do you most want from this app?
          </label>
          <p className="muted small">
            Answer in your own words. We will bring those tabs to the top and switch them on. You can change
            everything below.
          </p>
          <textarea
            id="organize-goal"
            className="input organize__goal"
            rows={2}
            placeholder="e.g. I want to keep an eye on my sleep and what I eat, and keep my blood pressure in range"
            value={goal}
            onChange={e => setGoal(e.target.value)}
          />
          <div className="chips organize__suggestions">
            <span className="muted small">Or tap one:</span>
            {GOAL_SUGGESTIONS.map(g => (
              <button
                key={g}
                type="button"
                className={`chip ${goal === g ? 'chip--on' : ''}`}
                aria-pressed={goal === g}
                onClick={() => setGoal(g)}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="organize__intake-actions">
            <button className="btn btn--primary" disabled={busy} onClick={startAssessment}>
              Set up my app
            </button>
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => {
                const next = { ...draft, assessed: true };
                setDraft(next);
                void persist(next, goal, true);
              }}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {draft.assessed && (
        <>
          <p className="muted small organize__lead">
            {self
              ? 'Turn tabs on or off, move them up and down, and mark what matters most. High priority tabs move to the top of your console.'
              : 'Turn tabs on or off, move them up and down, and mark what matters most. High priority tabs move to the top for both you and your care team.'}
          </p>
          <ul className="organize__list">
            {shown.map((tab, index) => {
              const meta = metaFor(tab.id);
              return (
                <li key={tab.id} className={`organize__row organize__row--${tab.priority}`}>
                  <label className="organize__on">
                    <input
                      type="checkbox"
                      checked={tab.on}
                      onChange={e => toggle(tab.id, e.target.checked)}
                      aria-label={`Show the ${meta.label} tab`}
                    />
                    <span className="organize__name">{meta.label}</span>
                  </label>
                  <span className="organize__hint muted small">{meta.hint}</span>
                  <div className="organize__controls">
                    <div className="chips organize__prio">
                      {PRIORITIES.map(p => (
                        <button
                          key={p}
                          className={`chip ${tab.priority === p ? 'chip--on' : ''}`}
                          onClick={() => prioritise(tab.id, p)}
                          aria-pressed={tab.priority === p}
                          title={`${PRIORITY_LABEL[p]} priority`}
                        >
                          {PRIORITY_LABEL[p]}
                        </button>
                      ))}
                    </div>
                    <div className="organize__move">
                      <button
                        className="btn btn--ghost organize__arrow"
                        disabled={index === 0}
                        onClick={() => bump(tab.id, -1)}
                        aria-label={`Move ${meta.label} up`}
                      >
                        ↑
                      </button>
                      <button
                        className="btn btn--ghost organize__arrow"
                        disabled={index === shown.length - 1}
                        onClick={() => bump(tab.id, 1)}
                        aria-label={`Move ${meta.label} down`}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="organize__foot">
            {!self && (
              <button
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => {
                  const next = { ...draft, assessed: false };
                  setDraft(next);
                  void persist(next, goal, false);
                }}
              >
                Redo the set-up questions
              </button>
            )}
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                const next = {
                  ...draft,
                  tabs: TABS.map(t => ({ id: t.id, on: t.defaultOn, priority: 'normal' as Priority })),
                };
                setDraft(next);
                void persist(next);
              }}
            >
              Reset to default
            </button>
            {saved && <span className="tag tag--ok">Saved</span>}
          </div>
        </>
      )}

      {error && <p className="error small">{error}</p>}
    </Panel>
  );
}
