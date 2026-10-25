import { useEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { messagesFor, useData } from '../lib/data';
import {
  MESSAGE_ROLE_LABEL,
  channelsForRole,
  type MessageChannel,
} from '../../spacetimedb/src/messages.ts';
import { timeAgo } from '../lib/format';
import { Panel } from './ui';

const MAX_SHOWN = 50;

/** What the active channel means for the person looking at the card. */
function channelIntro(mode: 'patient' | 'nurse' | 'family', channel: MessageChannel, firstName: string): string {
  if (channel === 'team') {
    return mode === 'patient'
      ? 'Everyone in your care circle sees this.'
      : `Everyone in ${firstName}'s care circle sees this.`;
  }
  if (channel === 'nurse') {
    return mode === 'patient' ? 'Private between you and your nurse.' : `Private between you and ${firstName}.`;
  }
  return mode === 'patient' ? 'Private between you and approved family.' : `Private between you and ${firstName}.`;
}

/** Channel tab labels from the viewer's perspective. */
function channelTabLabel(mode: 'patient' | 'nurse' | 'family', channel: MessageChannel, firstName: string): string {
  if (channel === 'team') return 'Everyone';
  if (mode === 'patient') return channel === 'nurse' ? 'Nurse only' : 'Family only';
  return `${firstName} only`;
}

function placeholderFor(mode: 'patient' | 'nurse' | 'family', channel: MessageChannel, firstName: string): string {
  if (channel === 'team') return mode === 'family' ? `Message ${firstName} and the care team…` : 'Message everyone…';
  if (channel === 'nurse') return mode === 'patient' ? 'Message your nurse…' : `Message ${firstName}…`;
  return mode === 'patient' ? 'Message your family…' : `Message ${firstName}…`;
}

/**
 * The conversation between the patient, the nurse, and approved family, split
 * into channels: everyone, a private patient-nurse channel, and a private
 * patient-family channel. The same card serves all three screens; the viewer's
 * role decides which channels exist. Posting goes through one reducer, which
 * checks the caller's role, the channel, and family grants.
 */
export function CareMessagesCard({
  patientId,
  patientName,
  mode,
}: {
  patientId: bigint;
  patientName: string;
  mode: 'patient' | 'nurse' | 'family';
}) {
  const data = useData();
  const post = useReducer(reducers.postCareMessage);
  const [draft, setDraft] = useState('');
  const [channel, setChannel] = useState<MessageChannel>('team');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const channels = channelsForRole(mode);
  const activeChannel = channels.includes(channel) ? channel : 'team';
  const messages = messagesFor(data, patientId, activeChannel);
  const shown = messages.slice(-MAX_SHOWN);
  const firstName = patientName.split(' ')[0];
  const myIdentity = data.me?.identity;

  // New messages keep the thread pinned to the latest.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeChannel]);

  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await post({ patientId, body, channel: activeChannel });
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Messages" code={`${messages.length}`} className="msg" collapsible>
      {channels.length > 1 && (
        <div className="msg__channels">
          <span className="ptabs" role="tablist" aria-label="Conversation">
            {channels.map(c => (
              <button
                key={c}
                role="tab"
                aria-selected={activeChannel === c}
                className={`ptabs__tab ${activeChannel === c ? 'ptabs__tab--on' : ''}`}
                onClick={() => setChannel(c)}
              >
                {channelTabLabel(mode, c, firstName)}
              </button>
            ))}
          </span>
        </div>
      )}
      <p className="muted small">{channelIntro(mode, activeChannel, firstName)}</p>
      <div className="msg__thread" ref={threadRef}>
        {shown.length === 0 ? (
          <p className="muted small">No messages here yet. Say hello.</p>
        ) : (
          shown.map(m => {
            const mine = myIdentity !== undefined && m.author.toHexString() === myIdentity.toHexString();
            return (
              <div key={String(m.id)} className={`msg__row ${mine ? 'msg__row--mine' : ''}`}>
                <div className="msg__bubble">
                  <span className="msg__meta muted small">
                    {m.authorName} · {MESSAGE_ROLE_LABEL[m.authorRole] ?? m.authorRole} · {timeAgo(m.createdAt)}
                  </span>
                  <span className="msg__body">{m.body}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="msg__compose">
        <input
          className="input"
          placeholder={placeholderFor(mode, activeChannel, firstName)}
          value={draft}
          maxLength={1000}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn btn--primary" disabled={!draft.trim() || busy} onClick={() => void send()}>
          Send
        </button>
      </div>
    </Panel>
  );
}
