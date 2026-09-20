import { useState } from 'react';
import type { CSSProperties } from 'react';
import { shortAgo } from './mission-feed';
import type { MessageThread } from './mission-messages';
import { DELIVERY_LABEL } from '../chat/sent-message';

/**
 * Mission Control's **messages dock**: the conversations this session is
 * having with other sessions and with agents inside itself, pinned under the
 * feed like the environment strip is.
 *
 * Not feed rows, on purpose. The feed is a stream of operations — one glyph,
 * one line, one outcome each — and a message is a line in a conversation: the
 * reader's question is "who is this session talking to, and what was the last
 * thing said", which is the shape of a messenger's sidebar, not of a log. So
 * each thread is a card with the other party's monogram, its name and what it
 * is, the last message with its direction, and how many went each way; the
 * accent is the inbound bubble's — the same colour a message wears in the
 * transcript — and an agent inside the session takes the ink-toned monogram
 * the transcript gives it too.
 *
 * A click opens the exchange when the thread has an id to join on (a session
 * on the other end), which shows the whole conversation from either side; an
 * agent's thread has no exchange, so it locates the latest message's turn.
 */
export function MessagesDock({
  threads,
  now,
  onOpenExchange,
  onLocateTurn,
}: {
  threads: MessageThread[];
  now: number;
  onOpenExchange?: (msgId: string) => void;
  onLocateTurn: (turnN: number) => void;
}) {
  const [open, setOpen] = useState(true);
  if (threads.length === 0) return null;
  const sessions = threads.filter(t => t.kind === 'session').length;
  const agents = threads.length - sessions;
  const summary = [
    sessions > 0 ? `${sessions} session${sessions === 1 ? '' : 's'}` : null,
    agents > 0 ? `${agents} agent${agents === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const activate = (t: MessageThread) => {
    if (t.msgId && onOpenExchange) onOpenExchange(t.msgId);
    else onLocateTurn(t.last.turnN);
  };

  return (
    <section className="cl-msgdock" aria-label="Messages">
      <button
        type="button"
        className="cl-msgdock-head"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="cl-msgdock-title">Messages</span>
        <span className="cl-msgdock-summary">{summary}</span>
        <span className="cl-msgdock-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="cl-msgdock-list">
          {threads.map(t => (
            <ThreadCard key={t.key} thread={t} now={now} onActivate={() => activate(t)} />
          ))}
        </div>
      )}
    </section>
  );
}

function ThreadCard({
  thread: t,
  now,
  onActivate,
}: {
  thread: MessageThread;
  now: number;
  onActivate: () => void;
}) {
  const last = t.last;
  const preview =
    (last.summary ?? last.text)
      .split('\n')
      .find(l => l.trim())
      ?.trim() ?? '';
  // A sent message that did not leave is the one fact worth a chip: a thread
  // whose last line is still SENDING or FAILED is not where it looks.
  const pending = last.state && last.state !== 'sent' && last.state !== 'sent-to-agent';
  const title = [
    `${t.received} received · ${t.sent} sent`,
    t.msgId ? 'Open the exchange — both sides, in order' : 'Locate the latest message',
  ].join('\n');
  return (
    <button
      type="button"
      className={`cl-msgdock-thread${t.kind === 'agent' ? ' is-agent' : ''}`}
      onClick={onActivate}
      title={title}
      data-testid="thread"
      style={
        {
          '--dock-tint': t.kind === 'agent' ? 'var(--cl-ink-3)' : 'var(--cl-accent)',
        } as CSSProperties
      }
    >
      <span className="cl-msgdock-avatar" aria-hidden>
        {t.party.replace(/^pid /, '').slice(0, 1).toUpperCase()}
      </span>
      <span className="cl-msgdock-main">
        <span className="cl-msgdock-top">
          <span className="cl-msgdock-party">{t.party}</span>
          <span className="cl-msgdock-what">
            {t.kind === 'agent' ? 'agent in this session' : 'session'}
          </span>
          <time className="cl-msgdock-time">{shortAgo(last.at, now)}</time>
        </span>
        <span className="cl-msgdock-last">
          <span className="cl-msgdock-dir" aria-hidden>
            {last.direction === 'in' ? '⇣' : '⇡'}
          </span>
          <span className="cl-msgdock-preview">{preview}</span>
          {pending ? (
            <span className={`cl-msgdock-state${last.state === 'failed' ? ' is-danger' : ''}`}>
              {DELIVERY_LABEL[last.state!]}
            </span>
          ) : (
            <span className="cl-msgdock-count">{t.messages.length}</span>
          )}
        </span>
      </span>
    </button>
  );
}
