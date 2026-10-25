import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

type Turn = { role: 'user' | 'assistant'; content: string };

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

  useEffect(() => {
    abortRef.current?.abort();
    setTurns(loadThread(storageKey));
    setBusy(false);
    setError(null);
  }, [storageKey]);

  useEffect(() => {
    if (!busy) sessionStorage.setItem(storageKey, JSON.stringify(turns));
  }, [turns, busy, storageKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
          messages: history.filter(t => t.content.trim()).slice(-HISTORY_SENT),
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
    setTurns([]);
    setError(null);
  };

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
            <button className="agent__iconbtn" onClick={() => setOpen(false)} title="Close" aria-label="Close">
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
                ) : (
                  t.content
                )}
              </div>
            ))}
            {error && <div className="agent__error">{error}</div>}
          </div>

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
          <p className="agent__disclaimer">{props.disclaimer}</p>
        </section>
      )}
      <button
        className={`agent__fab ${open ? 'agent__fab--open' : ''}`}
        onClick={() => setOpen(o => !o)}
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
