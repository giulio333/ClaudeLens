import { useState } from 'react';
import Markdown from '../../Markdown';
import { CodeBlock } from './atoms';
import {
  DELIVERY_LABEL,
  messageBody,
  messageDeliveryState,
  messageExchangeId,
  messageRecipient,
  messageSummary,
} from './sent-message';
import type { ToolGroup } from './utils';

/** Lines drawn before the body folds — the inbound bubble's own figure, so a
 *  message reads the same length on the side that sent it. */
const OUTBOUND_CLAMP = 12;

/**
 * A message this session sent with `SendMessage`: the twin of `InboundMessage`,
 * on the other side of the wire.
 *
 * It takes the inbound bubble's grammar — the rule down the left, the strip
 * that names the other party, `⇢` for a message on the move — so the two halves
 * of one conversation look like two halves of one conversation, whichever
 * transcript is open. What differs is the strip's first word: `to`, where the
 * inbound has the sender's name. The tint follows the same rule as inbound: the
 * accent at low chroma for another session, a step towards ink for an agent
 * inside this one.
 *
 * The body is the call's own `message`; the summary the one line the call gave
 * it; the status what the result recorded — and a call with no result yet says
 * `sending`, because that is all the transcript knows. `Show exchange` is
 * offered on the one shape the exchange reader can join: a delivery to another
 * session, carrying its id.
 */
export function OutboundMessage({
  group,
  compact,
  onOpenExchange,
}: {
  group: ToolGroup;
  /** One line — the minimal-density strip, where the turn's tools are hidden and
   *  only what it did to the outside is kept. */
  compact?: boolean;
  onOpenExchange?: (msgId: string) => void;
}) {
  const [full, setFull] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const to = messageRecipient(group);
  const body = messageBody(group);
  const summary = messageSummary(group);
  const state = messageDeliveryState(group);
  const exchangeId = messageExchangeId(group);
  const toAgent = state === 'sent-to-agent';
  const what = toAgent ? 'agent in this session' : state === 'sent' ? 'another session' : null;
  const lines = body.split('\n');
  const clamped = !full && lines.length > OUTBOUND_CLAMP;
  const shown = clamped ? lines.slice(0, OUTBOUND_CLAMP).join('\n') : body;
  const stateTone =
    state === 'failed' ? 'is-danger' : state === 'sent' || state === 'sent-to-agent' ? 'is-ok' : '';
  const identity = toAgent
    ? 'Sent to an agent running inside this session.'
    : state === 'sent'
      ? 'Sent to another Claude Code session on this machine. The name is the one the call used; it is the recipient’s own and can change.'
      : state === 'sending'
        ? 'The transcript holds the call and no result yet.'
        : 'The tool answered without recording a delivery.';

  const exchangeLink = onOpenExchange && exchangeId && (
    <button
      type="button"
      className="cl-inbound-exchange"
      title="The conversation between these two sessions, both sides in order"
      onClick={() => onOpenExchange(exchangeId)}
    >
      Show exchange
    </button>
  );

  const strip = (
    <div className="cl-inbound-strip" title={identity}>
      <span className="cl-inbound-arrow" aria-hidden>
        ⇢
      </span>
      <span className="cl-inbound-what">to</span>
      <span className="cl-inbound-from">{to}</span>
      {what && <span className="cl-inbound-what">{what}</span>}
      {compact && summary && <span className="cl-outbound-summary is-inline">{summary}</span>}
      <span className={`cl-outbound-state ${stateTone}`}>{DELIVERY_LABEL[state]}</span>
      {exchangeLink}
    </div>
  );

  const className = `cl-inbound cl-outbound${toAgent ? ' cl-inbound--agent' : ''}${compact ? ' is-compact' : ''}`;

  if (compact) return <div className={className}>{strip}</div>;

  // A call that delivered nothing is explained only by its own answer, which
  // is JSON written for the harness: offered folded, as the artifact card
  // offers its prose, never pasted under the message as if it were one.
  const answer =
    group.result && (state === 'failed' || state === 'not-delivered') ? group.result.content : null;

  return (
    <div className={className}>
      {strip}
      {summary && <div className="cl-outbound-summary">{summary}</div>}
      {body && (
        <div className="cl-inbound-body">
          <Markdown>{shown}</Markdown>
        </div>
      )}
      {lines.length > OUTBOUND_CLAMP && (
        <button type="button" className="cl-inbound-more" onClick={() => setFull(f => !f)}>
          {clamped ? `Show all ${lines.length} lines` : 'Collapse'}
        </button>
      )}
      {answer && (
        <>
          <button
            type="button"
            className="cl-inbound-more"
            onClick={() => setAnswerOpen(o => !o)}
            aria-expanded={answerOpen}
          >
            {answerOpen ? 'Hide what the tool answered' : 'Show what the tool answered'}
          </button>
          {answerOpen && <CodeBlock code={answer} />}
        </>
      )}
    </div>
  );
}
