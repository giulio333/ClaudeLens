import { useState } from 'react';
import { CodeBlock } from './atoms';
import { MessageLine } from './MessageLine';
import { previewLine } from './message-line';
import {
  DELIVERY_LABEL,
  messageBody,
  messageDeliveryState,
  messageRecipient,
  messageSummary,
} from './sent-message';
import type { ToolGroup } from './utils';

/**
 * A message this session sent with `SendMessage`: the twin of `InboundMessage`,
 * on the other side of the wire — and drawn by the same `MessageLine`, so the
 * two halves of one conversation read as two halves of one conversation
 * whichever transcript is open.
 *
 * What is its own is the direction (`to`, the arrow leaving) and the delivery
 * state the result recorded — a call with no result yet says `sending`, because
 * that is all the transcript knows. The row's one line is the summary the call
 * gave the message when it gave one, the message's own first line otherwise;
 * the message itself opens on ask. `Show exchange` is offered on the one shape
 * the exchange reader can join: a delivery to another session, carrying its id.
 */
export function OutboundMessage({
  group,
  compact,
}: {
  group: ToolGroup;
  /** One line — the minimal-density strip, where the turn's tools are hidden and
   *  only what it did to the outside is kept. */
  compact?: boolean;
}) {
  const [answerOpen, setAnswerOpen] = useState(false);
  const to = messageRecipient(group);
  const body = messageBody(group);
  const summary = messageSummary(group);
  const state = messageDeliveryState(group);
  const toAgent = state === 'sent-to-agent';
  const what = toAgent
    ? 'agent in this session'
    : state === 'sent'
      ? 'another session'
      : 'no delivery recorded';
  const tone = state === 'failed' ? 'danger' : toAgent || state === 'sent' ? 'ok' : 'neutral';
  const identity = toAgent
    ? 'Sent to an agent running inside this session.'
    : state === 'sent'
      ? 'Sent to another Claude Code session on this machine. The name is the one the call used; it is the recipient’s own and can change.'
      : state === 'sending'
        ? 'The transcript holds the call and no result yet.'
        : 'The tool answered without recording a delivery.';

  // A call that delivered nothing is explained only by its own answer, which
  // is JSON written for the harness: offered folded, under the message, never
  // pasted beside it as if it were one.
  const answerText =
    group.result && (state === 'failed' || state === 'not-delivered') ? group.result.content : null;
  const answer = answerText && (
    <>
      <button
        type="button"
        className="cl-msg-more"
        onClick={() => setAnswerOpen(o => !o)}
        aria-expanded={answerOpen}
      >
        {answerOpen ? 'Hide what the tool answered' : 'Show what the tool answered'}
      </button>
      {answerOpen && <CodeBlock code={answerText} />}
    </>
  );

  return (
    <div className={`cl-outbound${compact ? ' is-compact' : ''}`}>
      <MessageLine
        direction="out"
        who={to}
        what={what}
        agent={toAgent}
        title={identity}
        preview={summary ?? previewLine(body)}
        body={body}
        state={{ label: DELIVERY_LABEL[state], tone }}
        extra={answer}
        compact={compact}
      />
    </div>
  );
}
