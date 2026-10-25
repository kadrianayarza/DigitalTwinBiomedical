import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { VoiceSession, voiceAvailable, type VoiceState } from './voice';

/** `vid` ties a spoken turn to the voice request that fills it in. */
type Turn = { role: 'user' | 'assistant'; content: string; vid?: string };

const VOICE_LABEL: Record<VoiceState, [string, string]> = {
  starting: ['Starting the microphone…', ''],
  listening: ['Listening', 'Just start talking'],
  hearing: ['Hearing you…', 'Pause when you are done'],
  thinking: ['Thinking…', ''],
  speaking: ['Speaking', 'Talk to interrupt'],
};

type Props = {
  audience: 'patient' | 'nurse';
  /** Conversations are kept per thread for this browser tab. */
  threadKey: string;
  title: string;
  subtitle: string;
  greeting: string;
  suggestions: string[];
  disclaimer: string;
  /** Called at send time so the agent always sees the live record. */
  buildContext: () => unknown;
  /**
   * Navigation commands ("take me to the health tab") are handled locally instead
   * of being sent to the model; returns the confirmation line, or null to let the
   * message through to the agent.
   */
  onNavigate?: (text: string) => string | null;
};

const HISTORY_SENT = 16;

function loadThread(key: string): Turn[] {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

/** Floating health-agent chat with its own streamed conversation. */
export function AgentChat(props: Props) {
  const storageKey = `agent/${props.threadKey}`;
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(() => loadThread(storageKey));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [canTalk, setCanTalk] = useState(false);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [muted, setMuted] = useState(false);
  const sessionRef = useRef<VoiceSession | null>(null);
  const orbRef = useRef<HTMLSpanElement>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const endVoice = () => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setVoice(null);
    setMuted(false);
    setTurns(cur => cur.filter(t => t.content.trim()));
  };

  useEffect(() => {
    abortRef.current?.abort();
    endVoice();
    setTurns(loadThread(storageKey));
    setBusy(false);
    setError(null);
  }, [storageKey]);

  useEffect(() => {
    if (!busy) sessionStorage.setItem(storageKey, JSON.stringify(turns));
  }, [turns, busy, storageKey]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      sessionRef.current?.close();
    },
    []
  );

  useEffect(() => {
    void voiceAvailable().then(setCanTalk);
  }, []);

  useEffect(() => {
    if (!voice) return;
    let raf = 0;
    const tick = () => {
      const level = sessionRef.current?.level ?? 0;
      orbRef.current?.style.setProperty('--level', Math.min(1, level * 14).toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voice]);

  const patchTurn = (vid: string, change: (t: Turn) => Turn) =>
    setTurns(cur => cur.map(t => (t.vid === vid ? change(t) : t)));

  const startVoice = async () => {
    if (sessionRef.current) return;
    abortRef.current?.abort();
    setError(null);
    setVoice('starting');
    let nextTurn = 0;
    const prefix = Date.now().toString(36);
    const vid = (id: number, who: 'u' | 'a') => `${prefix}.${id}${who}`;
    const session = new VoiceSession({
      audience: props.audience,
      context: () => JSON.stringify(props.buildContext()),
      history: () =>
        turnsRef.current
          .filter(t => t.content.trim())
          .slice(-HISTORY_SENT)
          .map(({ role, content }) => ({ role, content })),
      onState: setVoice,
      onTurn: () => {
        const id = nextTurn++;
        setError(null);
        setTurns(cur => [
          ...cur,
          { role: 'user', content: '', vid: vid(id, 'u') },
          { role: 'assistant', content: '', vid: vid(id, 'a') },
        ]);
        return id;
      },
      onUserText: (id, text) => {
        patchTurn(vid(id, 'u'), t => ({ ...t, content: text || '(couldn’t make that out)' }));
        const navLine = text ? props.onNavigate?.(text) : null;
        if (navLine) {
          // The transcript arrives before the reply streams; answer locally instead.
          sessionRef.current?.interrupt();
          patchTurn(vid(id, 'a'), t => ({ ...t, content: navLine }));
        }
      },
      onAgentText: (id, chunk) => patchTurn(vid(id, 'a'), t => ({ ...t, content: t.content + chunk })),
      onTurnEnd: id => {
        const mine = (t: Turn) => t.vid === vid(id, 'u') || t.vid === vid(id, 'a');
        setTurns(cur =>
          cur
            .filter(t => !(mine(t) && !t.content.trim()))
            .map(t => (mine(t) ? { role: t.role, content: t.content } : t))
        );
      },
      onError: setError,
    });
    sessionRef.current = session;
    try {
      await session.start();
    } catch (e) {
      sessionRef.current = null;
      setVoice(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const navLine = props.onNavigate?.(question);
    if (navLine) {
      setTurns(cur => [...cur, { role: 'user', content: question }, { role: 'assistant', content: navLine }]);
      setInput('');
      return;
    }
    const history: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setError(null);
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    const append = (chunk: string) =>
      setTurns(cur => {
        const next = cur.slice();
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, content: last.content + chunk };
        return next;
      });
    try {
      const res = await fetch('/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          audience: props.audience,
          messages: history
            .filter(t => t.content.trim())
            .slice(-HISTORY_SENT)
            .map(({ role, content }) => ({ role, content })),
          context: JSON.stringify(props.buildContext()),
        }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        append(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setTurns(cur => (cur[cur.length - 1]?.content ? cur : cur.slice(0, -1)));
      setBusy(false);
    }
  };

  const stop = () => abortRef.current?.abort();
  const clear = () => {
    stop();
    sessionRef.current?.interrupt();
    setTurns([]);
    setError(null);
  };
  const close = () => {
    endVoice();
    setOpen(false);
  };
  const toggleMute = () => {
    sessionRef.current?.setMuted(!muted);
    setMuted(!muted);
  };
  const [voiceTitle, voiceHint] = voice ? VOICE_LABEL[voice] : ['', ''];

  const label = `${props.title}${open ? ' (close)' : ''}`;
  return (
    <div className={`agent agent--${props.audience}`}>
      {open && (
        <section className="agent__panel" role="dialog" aria-label={props.title}>
          <header className="agent__head">
            <span className="agent__glyph" aria-hidden>
              <AgentGlyph />
            </span>
            <div className="agent__titles">
              <strong>{props.title}</strong>
              <span>{props.subtitle}</span>
            </div>
            {turns.length > 0 && (
              <button className="agent__iconbtn" onClick={clear} title="New conversation" aria-label="New conversation">
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
                </svg>
              </button>
            )}
            <button className="agent__iconbtn" onClick={close} title="Close" aria-label="Close">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          <div className="agent__list" ref={listRef} aria-live="polite">
            {turns.length === 0 && (
              <>
                <p className="agent__msg agent__msg--assistant">{props.greeting}</p>
                <div className="agent__suggest">
                  {props.suggestions.map(s => (
                    <button key={s} className="chip" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`agent__msg agent__msg--${t.role}`}>
                {t.role === 'assistant' ? (
                  t.content ? (
                    <RichText text={t.content} />
                  ) : (
                    <span className="agent__typing" aria-label="Thinking">
                      <i />
                      <i />
                      <i />
                    </span>
                  )
                ) : t.content ? (
                  t.content
                ) : (
                  <span className="agent__typing" aria-label="Transcribing">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
            ))}
            {error && <div className="agent__error">{error}</div>}
          </div>

          {voice ? (
            <div className={`agent__voice agent__voice--${muted ? 'muted' : voice}`}>
              <span className="agent__orb" ref={orbRef} aria-hidden>
                <MicGlyph />
              </span>
              <div className="agent__vstatus" role="status">
                <strong>{muted ? 'Muted' : voiceTitle}</strong>
                <span>{muted ? 'Unmute to keep talking' : voiceHint}</span>
              </div>
              {voice === 'thinking' || voice === 'speaking' ? (
                <button type="button" className="agent__vbtn" onClick={() => sessionRef.current?.interrupt()}>
                  Interrupt
                </button>
              ) : (
                <button
                  type="button"
                  className="agent__vbtn"
                  onClick={toggleMute}
                  disabled={voice === 'starting'}
                  aria-pressed={muted}
                >
                  {muted ? 'Unmute' : 'Mute'}
                </button>
              )}
              <button type="button" className="agent__vbtn agent__vbtn--end" onClick={endVoice}>
                End
              </button>
            </div>
          ) : (
            <form
              className="agent__form"
              onSubmit={e => {
                e.preventDefault();
                void send(input);
              }}
            >
              <textarea
                ref={inputRef}
                className="agent__input"
                rows={1}
                value={input}
                maxLength={2000}
                placeholder={props.audience === 'patient' ? 'Ask about how you are doing…' : 'Ask about your patients…'}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
              />
              {canTalk && !busy && !input.trim() && (
                <button
                  type="button"
                  className="agent__send agent__mic"
                  onClick={() => void startVoice()}
                  aria-label="Talk"
                  title="Talk"
                >
                  <MicGlyph />
                </button>
              )}
              {busy ? (
                <button type="button" className="agent__send" onClick={stop} aria-label="Stop" title="Stop">
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <rect x="7" y="7" width="10" height="10" rx="1.5" />
                  </svg>
                </button>
              ) : (
                <button type="submit" className="agent__send" disabled={!input.trim()} aria-label="Send" title="Send">
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M5 12h13M13 6l6 6-6 6" />
                  </svg>
                </button>
              )}
            </form>
          )}
          <p className="agent__disclaimer">{props.disclaimer}</p>
        </section>
      )}
      <button
        className={`agent__fab ${open ? 'agent__fab--open' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label={label}
        title={props.title}
      >
        <AgentGlyph />
        {busy && !open && <span className="agent__dot" aria-hidden />}
      </button>
    </div>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </svg>
  );
}

function AgentGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6l-4.5 3.5V16H7a2.5 2.5 0 0 1-2.5-2.5z" />
      <path d="M12 7.2v5.6M9.2 10h5.6" />
    </svg>
  );
}

/** Minimal, injection-safe formatting: paragraphs, "- " / "1. " lists and **bold**. */
function RichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter(l => l.trim());
        const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
        if (lines.length > 0 && lines.every(l => bullet.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(bullet, ''))}</li>);
          return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l.replace(bullet, '• '))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

function inline(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}
