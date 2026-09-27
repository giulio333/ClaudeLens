import { useState } from 'react';
import { shortAgo } from './mission-feed';
import type { MessageThread } from './mission-messages';
import { DELIVERY_LABEL } from '../chat/sent-message';
import { previewLine } from '../chat/message-line';

/**
 * Mission Control's **messages dock**: the conversations this session is
 * having with other sessions and with agents inside itself, pinned under the
 * feed like the environment strip is.
 *
 * Not feed rows, on purpose: the feed is a stream of operations, a message is a
 * line in a conversation, and the reader's question is "who is this session
 * talking to, and what was the last thing said" — so the dock groups by
 * counterpart. But it is drawn on the feed's own grid (time, tile, text), since
 * it sits right under it and a second visual grammar in one rail read as a
 * widget bolted on. Each row says three things: who (the tile — the rail's
 * violet `A` for an agent, the one the feed gives that same agent, and the
 * accent `⇄` of the exchange page for a session — then the name), when, and the
 * last line, over two lines so it can actually be read, with `You:` in front
 * when this session said it. The counts and what the other party is are hover
 * facts; a chip appears only for a sent message that did not leave.
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
            <ThreadRow key={t.key} thread={t} now={now} onActivate={() => activate(t)} />
          ))}
        </div>
      )}
    </section>
  );
}

function ThreadRow({
  thread: t,
  now,
  onActivate,
}: {
  thread: MessageThread;
  now: number;
  onActivate: () => void;
}) {
  const last = t.last;
  const preview = previewLine(last.summary ?? last.text);
  // A sent message that did not leave is the one fact worth a chip: a thread
  // whose last line is still SENDING or FAILED is not where it looks.
  const pending = last.state && last.state !== 'sent' && last.state !== 'sent-to-agent';
  const title = [
    `${t.party} — ${t.kind === 'agent' ? 'agent in this session' : 'session'}`,
    `${t.received} received · ${t.sent} sent`,
    t.msgId ? 'Open the exchange — both sides, in order' : 'Locate the latest message',
  ].join('\n');
  return (
    <button
      type="button"
      className={`tmc-row cl-msgdock-row is-${t.kind}`}
      onClick={onActivate}
      title={title}
      data-testid="thread"
    >
      <time className="cl-msgdock-time">{shortAgo(last.at, now)}</time>
      <span className="cl-msgdock-tile" aria-hidden>
        {t.kind === 'agent' ? 'A' : '⇄'}
      </span>
      <span className="cl-msgdock-main">
        <span className="cl-msgdock-party">{t.party}</span>
        {preview && (
          <span className="cl-msgdock-preview">
            {last.direction === 'out' && <span className="cl-msgdock-you">You: </span>}
            {preview}
          </span>
        )}
      </span>
      {pending && (
        <span className={`cl-msgdock-state${last.state === 'failed' ? ' is-danger' : ''}`}>
          {DELIVERY_LABEL[last.state!]}
        </span>
      )}
    </button>
  );
}
