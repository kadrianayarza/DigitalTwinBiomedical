import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { layoutFor, useData, voiceDraftsFor, voiceItemsFor } from '../lib/data';
import { serializeLayout, setEnabled, TAB_IDS, type TabId } from '../lib/voice';
import {
  confirmQuestion,
  describeDetail,
  kindLabel,
  targetPhrase,
  type VoiceDetail,
  type VoiceItemKind,
} from '../lib/voice';
import { spokenDecision, useSpeech, useTts } from '../lib/speech';
import { jumpToTab, useTabNavigator } from '../lib/navigate';
import { clock } from '../lib/format';

const MAX_TURNS = 6;

/** A voice target names the tab that shows it, except lab results, which live in the chart. */
function tabForTarget(target: string): TabId | undefined {
  return (TAB_IDS as readonly string[]).includes(target) ? (target as TabId) : undefined;
}

/**
 * Corner microphone that connects the speaker to the in-app assistant. Speaking a
 * sentence produces proposals; each one names the section it will update and waits for
 * a checkmark, a cross, or a spoken yes/no.
 */
export function VoiceAssistant({
  patientId,
  audience,
}: {
  patientId: bigint;
  audience: 'patient' | 'nurse';
}) {
  const data = useData();
  const startDraft = useReducer(reducers.startVoiceDraft);
  const decideItem = useReducer(reducers.decideVoiceItem);
  const dismissDraft = useReducer(reducers.dismissVoiceDraft);
  const saveLayout = useReducer(reducers.savePatientLayout);
  const navigateTab = useTabNavigator(patientId, audience);

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const tts = useTts();
  // Recognition that is waiting for an answer to something the bot just said.
  const autoListenRef = useRef(false);
  const startListeningRef = useRef<(() => void) | null>(null);
  // Which replies and questions have already been said out loud.
  const spokenRepliesRef = useRef<Set<string>>(new Set());
  const askedRef = useRef<Set<string>>(new Set());

  const drafts = useMemo(() => voiceDraftsFor(data, patientId).slice(0, MAX_TURNS), [data, patientId]);
  const newest = drafts[0];
  const newestItems = useMemo(
    () => (newest ? voiceItemsFor(data, newest.id) : []),
    [data, newest]
  );
  const pendingInNewest = newestItems.filter(i => i.decision === 'pending');

  const send = useCallback(
    (transcript: string) => {
      const text = transcript.trim();
      if (!text) return;
      // "Take me to …" is a navigation command, not a record update.
      const navLine = navigateTab(text);
      if (navLine) {
        setFlash(navLine);
        setTyped('');
        if (tts.enabled) tts.speak(navLine);
        return;
      }
      setError(null);
      void startDraft({ patientId, transcript: text })
        .then(() => setTyped(''))
        .catch(e => setError(e instanceof Error ? e.message : String(e)));
    },
    [patientId, startDraft, navigateTab, tts]
  );

  /**
   * Switch the destination tab on when the patient had it hidden, so a confirmed
   * update always has somewhere to appear. Lab results are exempt: they live in the
   * nurse's chart, which is always shown.
   */
  const revealTab = useCallback(
    async (target: string) => {
      const id = tabForTarget(target);
      if (!id) return;
      const layout = layoutFor(data, patientId);
      if (layout.tabs.find(t => t.id === id)?.on) return;
      try {
        await saveLayout({
          patientId,
          tabs: serializeLayout({ ...layout, tabs: setEnabled(layout.tabs, id, true) }),
          goal: layout.goal,
          assessed: layout.assessed,
        });
      } catch {
        // The clinical write already succeeded; showing the section is a bonus.
      }
    },
    [data, patientId, saveLayout]
  );

  const decide = useCallback(
    async (itemId: bigint, target: string, confirmed: boolean) => {
      setError(null);
      setBusy(true);
      try {
        await decideItem({ itemId, confirmed });
        if (confirmed) {
          await revealTab(target);
          setFlash(`Saved to ${targetPhrase(target)}`);
          // Give the freshly revealed tab a moment to mount before pointing at it.
          jumpToTab(target, 350);
        } else {
          setFlash('Discarded');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [decideItem, revealTab]
  );

  /** Start recognition that is listening for the answer to what the bot just said. */
  const listenForAnswer = useCallback(() => {
    autoListenRef.current = true;
    startListeningRef.current?.();
  }, []);

  const speech = useSpeech(
    useCallback(
      (transcript: string) => {
        // Over speakers the mic can pick the bot's own voice back up; ignore that echo.
        if (autoListenRef.current && tts.echoOf(transcript)) {
          listenForAnswer();
          return;
        }
        // With one proposal still waiting, a spoken yes or no answers it instead.
        if (pendingInNewest.length === 1) {
          const decision = spokenDecision(transcript);
          if (decision !== undefined) {
            void decide(pendingInNewest[0]!.id, pendingInNewest[0]!.target, decision);
            return;
          }
        }
        send(transcript);
      },
      [decide, listenForAnswer, pendingInNewest, send, tts]
    )
  );

  useEffect(() => {
    startListeningRef.current = () => speech.start();
  }, [speech.start]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [drafts.length, newestItems.length]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 3200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  /**
   * Guided flow: with the spoken voice on, the bot reads its reply, then asks the
   * first unanswered question out loud and listens for a spoken yes or no.
   */
  useEffect(() => {
    if (!open || !tts.enabled || !newest || newest.status !== 'ready') return;
    const askFirstPending = () => {
      const next = pendingInNewest[0];
      if (!next) return;
      const key = String(next.id);
      if (askedRef.current.has(key)) return;
      askedRef.current.add(key);
      tts.speak(confirmQuestion(next.kind as VoiceItemKind, safeDetail(next.detail)), listenForAnswer);
    };
    const reply = newest.reply.trim();
    if (!reply) {
      askFirstPending();
      return;
    }
    const draftKey = String(newest.id);
    if (spokenRepliesRef.current.has(draftKey)) {
      askFirstPending();
      return;
    }
    spokenRepliesRef.current.add(draftKey);
    tts.speak(reply, askFirstPending);
  }, [open, tts, newest, pendingInNewest, listenForAnswer]);

  // Closing the panel silences the assistant.
  useEffect(() => {
    if (!open) tts.stop();
  }, [open, tts.stop]);

  const totalPending = drafts.reduce(
    (count, draft) => count + voiceItemsFor(data, draft.id).filter(i => i.decision === 'pending').length,
    0
  );

  if (!open) {
    return (
      <div className="voice__dock">
        {flash && <div className="voice__flash">{flash}</div>}
        <button
          className="voice__mic"
          onClick={() => setOpen(true)}
          aria-label="Open the voice assistant"
          title="Talk to the assistant"
        >
          <MicIcon />
          {totalPending > 0 && <span className="voice__badge">{totalPending}</span>}
        </button>
      </div>
    );
  }

  return (
    <>
      {flash && <div className="voice__flash">{flash}</div>}
      <aside className="voice" role="dialog" aria-label="Voice assistant">
        <header className="voice__head">
          <div>
            <div className="voice__title">
              <MicIcon /> Assistant
            </div>
            <div className="muted small">
              {audience === 'patient'
                ? 'Say what changed and I will sort it into your record.'
                : 'Dictate an update and I will sort it into the chart.'}
            </div>
          </div>
          <div className="voice__headactions">
            {tts.supported && (
              <button
                className={`btn btn--ghost voice__tts ${tts.enabled ? 'is-on' : 'is-off'}`}
                aria-pressed={tts.enabled}
                onClick={() => tts.setEnabled(!tts.enabled)}
                title={
                  tts.enabled
                    ? 'The assistant speaks out loud. Tap to silence it.'
                    : 'Tap to have the assistant speak out loud.'
                }
              >
                <SpeakerIcon /> {tts.enabled ? 'Voice on' : 'Voice off'}
              </button>
            )}
            <button className="btn btn--ghost" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </header>

        <div className="voice__body" ref={bodyRef}>
          {drafts.length === 0 && (
            <p className="muted small">
              Nothing yet. Tap the microphone and say something like “my right knee is sore, about a 6 out of 10, and
              I took my metformin”.
            </p>
          )}

          {[...drafts].reverse().map(draft => {
            const items = voiceItemsFor(data, draft.id);
            return (
              <div key={String(draft.id)} className="voice__turn">
                <div className="voice__said">
                  <span className="voice__bubble voice__bubble--me">{draft.transcript}</span>
                  <span className="voice__stamp mono">{clock(draft.createdAt)}</span>
                </div>

                <div className="voice__bot">
                  {draft.status === 'parsing' && (
                    <span className="tag tag--pulse">Sorting what you said…</span>
                  )}
                  {draft.status === 'error' && (
                    <p className="error small">{draft.note || 'I could not read that. Try saying it another way.'}</p>
                  )}
                  {draft.status === 'ready' && draft.reply && (
                    <div className="voice__reply">
                      <p className="voice__botline">{draft.reply}</p>
                      {tts.supported && (
                        <button
                          className="btn btn--ghost voice__hear"
                          onClick={() => tts.speak(draft.reply)}
                          title="Hear the answer again"
                        >
                          <SpeakerIcon /> Hear it
                        </button>
                      )}
                    </div>
                  )}
                  {draft.status === 'ready' && items.length > 0 && (
                    <>
                      <p className="voice__botline">
                        I found {items.length} thing{items.length === 1 ? '' : 's'} to update. Confirm each one:
                      </p>
                      {items.map(item => {
                        const detail = safeDetail(item.detail);
                        const decided = item.decision !== 'pending';
                        return (
                          <div
                            key={String(item.id)}
                            className={`vitem vitem--${item.decision} vitem--${item.confidence}`}
                          >
                            <div className="vitem__top">
                              <span className="vitem__kind">{kindLabel(item.kind)}</span>
                              <span className={`vitem__conf vitem__conf--${item.confidence}`}>
                                {item.confidence}
                              </span>
                            </div>
                            <div className="vitem__label">{item.label}</div>
                            {!decided && (
                              <div className="vitem__ask">
                                {confirmQuestion(item.kind as VoiceItemKind, detail)}
                              </div>
                            )}
                            <div className="vitem__detail muted small">
                              {describeDetail(item.kind, detail) || 'No further detail'}
                            </div>
                            <div className="vitem__target">
                              <span className="vitem__arrow" aria-hidden>
                                →
                              </span>
                              Goes to <strong>{targetPhrase(item.target)}</strong>
                            </div>
                            {decided ? (
                              <div className={`vitem__done vitem__done--${item.decision}`}>
                                {item.decision === 'confirmed' ? '✓ Confirmed' : '✕ Not saved'}
                                {item.decidedByName && <span className="muted small"> · {item.decidedByName}</span>}
                              </div>
                            ) : (
                              <div className="vitem__actions">
                                <button
                                  className="btn btn--primary"
                                  disabled={busy}
                                  onClick={() => void decide(item.id, item.target, true)}
                                >
                                  ✓ Yes, save it
                                </button>
                                <button
                                  className="btn btn--ghost"
                                  disabled={busy}
                                  onClick={() => void decide(item.id, item.target, false)}
                                >
                                  ✕ No
                                </button>
                                {tts.supported && (
                                  <button
                                    className="btn btn--ghost"
                                    title="Hear the question"
                                    onClick={() =>
                                      tts.speak(confirmQuestion(item.kind as VoiceItemKind, detail))
                                    }
                                  >
                                    Hear it
                                  </button>
                                )}
                                <button
                                  className="btn btn--ghost"
                                  title="Show me where this goes"
                                  onClick={() => jumpToTab(item.target)}
                                >
                                  Show me
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {pendingInNewest.length === 1 && newest?.id === draft.id && (
                        <p className="muted small">
                          You can also just say “yes” or “no”.
                        </p>
                      )}
                    </>
                  )}
                  {draft.note && draft.status === 'ready' && (
                    <p className="muted small">{draft.note}</p>
                  )}
                  <div className="voice__turnfoot">
                    <button
                      className="btn btn--ghost voice__dismiss"
                      onClick={() => void dismissDraft({ draftId: draft.id }).catch(() => {})}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="voice__foot">
          {speech.error && <p className="error small">{speech.error}</p>}
          {error && <p className="error small">{error}</p>}
          {speech.interim && <p className="voice__interim muted small">“{speech.interim}”</p>}
          {tts.speaking && <p className="voice__interim muted small">The assistant is speaking…</p>}
          {!speech.supported && (
            <p className="muted small">
              This browser cannot listen directly. Type your update below and it works the same way.
            </p>
          )}
          <div className="voice__compose">
            <button
              className={`btn ${speech.listening ? 'btn--danger' : 'btn--primary'} voice__talk`}
              disabled={!speech.supported}
              onClick={() => {
                if (speech.listening) {
                  speech.stop();
                } else {
                  autoListenRef.current = false;
                  speech.start();
                }
              }}
            >
              {speech.listening ? '■ Stop' : '● Hold a thought'}
            </button>
            <form
              className="voice__typing"
              onSubmit={e => {
                e.preventDefault();
                send(typed);
              }}
            >
              <input
                className="input"
                placeholder={speech.supported ? 'Or type it here…' : 'Type your update…'}
                value={typed}
                onChange={e => setTyped(e.target.value)}
              />
              <button className="btn" type="submit" disabled={!typed.trim()}>
                Send
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}

function safeDetail(raw: string): VoiceDetail {
  try {
    const parsed = JSON.parse(raw) as unknown;
    // The backend only stores string, number, and boolean fields in a detail payload.
    return parsed && typeof parsed === 'object' ? (parsed as VoiceDetail) : {};
  } catch {
    return {};
  }
}

function SpeakerIcon() {
  return (
    <svg className="voice__icon voice__icon--sm" viewBox="0 0 24 24" aria-hidden>
      <path d="M4 9v6h4l6 4.5v-15L8 9H4Z" fill="currentColor" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg className="voice__icon" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Z"
        fill="currentColor"
      />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
