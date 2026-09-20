import { ReactNode, useState } from 'react';
import Markdown from '../../Markdown';
import type { MessageDirection } from './message-line';

/**
 * One line for one message between sessions — the shared body of both halves of
 * a conversation: the one this session received (`InboundMessage`) and the one
 * it sent (`OutboundMessage`).
 *
 * Both used to be blocks: a rule down the left, an uppercase strip, the whole
 * text unfolded to twelve lines, and for the sent half a summary line and a
 * status line on top of that — two levels of chrome around something that is,
 * in the middle of a transcript, an aside. So a message now reads as a single
 * row — who, what it said, when — and opens on ask.
 *
 * What the row must never leave ambiguous is the **direction**: whether this is
 * something we were told or something we said. Three things say it at once, so
 * losing one still leaves it legible — a glyph (arrow coming down-left into us,
 * arrow leaving up-right), the word `from` / `to` before the name, and the tint
 * (the accent for what arrives, ink for what leaves).
 */

/** Arrow landing down-left: something that came to us. */
function MessageInGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 7 7 17" />
      <path d="M17 17H7V7" />
    </svg>
  );
}

/** Arrow leaving up-right: something we sent. */
function MessageOutGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}

function CaretGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: open ? 'rotate(180deg)' : 'none' }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function MessageLine({
  direction,
  who,
  what,
  agent = false,
  title,
  preview,
  body,
  time,
  state,
  queued = false,
  extra,
  compact = false,
}: {
  direction: MessageDirection;
  /** The counterpart's name, as the transcript recorded it. */
  who: string;
  /** What the counterpart IS — spelled out under the row, where there is space
   *  for a sentence rather than a chip. */
  what: string;
  /** True when the counterpart is an agent running inside this session. */
  agent?: boolean;
  /** The identity sentence, on the row's tooltip. */
  title: string;
  /** The single line the row shows: a summary when the call gave one, else the
   *  first line of the message. */
  preview: string;
  /** The message itself, revealed when the row is opened. */
  body: string;
  time?: string;
  /** Delivery status — the sent half only; what the transcript recorded. */
  state?: { label: string; tone: 'ok' | 'danger' | 'neutral' };
  /** The message arrived while a turn was already running. */
  queued?: boolean;
  /** Anything the sending half adds under the body (the tool's own answer). */
  extra?: ReactNode;
  /** Drawn inside a minimal-density strip rather than as a turn of its own. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const canOpen = body.trim().length > 0;

  return (
    <div
      className={`cl-msg cl-msg--${direction}${agent ? ' cl-msg--agent' : ''}${compact ? ' is-compact' : ''}${open ? ' is-open' : ''}`}
    >
      <div className="cl-msg-row">
        <button
          type="button"
          className="cl-msg-toggle"
          title={title}
          aria-expanded={canOpen ? open : undefined}
          onClick={canOpen ? () => setOpen(o => !o) : undefined}
          data-static={canOpen ? undefined : ''}
        >
          <span className="cl-msg-icon">
            {direction === 'in' ? <MessageInGlyph /> : <MessageOutGlyph />}
          </span>
          <span className="cl-msg-dir">{direction === 'in' ? 'from' : 'to'}</span>
          <span className="cl-msg-who">{who}</span>
          {agent && <span className="cl-msg-tag">agent</span>}
          {queued && (
            <span className="cl-msg-tag is-queued" title="It arrived while a turn was running">
              mid-turn
            </span>
          )}
          <span className="cl-msg-preview">{preview}</span>
          {state && <span className={`cl-msg-state is-${state.tone}`}>{state.label}</span>}
          {time && <time className="cl-msg-time">{time}</time>}
          {canOpen && (
            <span className="cl-msg-caret">
              <CaretGlyph open={open} />
            </span>
          )}
        </button>
      </div>
      {open && (
        <div className="cl-msg-open">
          <div className="cl-msg-body">
            <Markdown>{body}</Markdown>
          </div>
          <div className="cl-msg-foot">
            <span className="cl-msg-what">{what}</span>
          </div>
          {extra}
        </div>
      )}
    </div>
  );
}
