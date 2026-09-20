import type { SentMessage } from '../../../types';
import type { ToolGroup } from './utils';

/**
 * Reading the `SendMessage` tool — the harness tool a session uses to write to
 * another session on this machine, or to an agent inside itself.
 *
 * It is the sender's half of a cross-session message. The receiver's half has
 * had a bubble of its own since #274 and a page since #280, while this half
 * rendered as a generic tool card: the header said "SendMessage", the input
 * preview was empty (no `description`, no `command`, no `file_path`), and the
 * body was the result JSON — `{"success":true,"message":"“…” → acme-9d
 * (another Claude session on this machine; …"}`. So one side of every
 * conversation between two sessions read as plumbing.
 *
 * What the call said is on its input: `to`, `message` and the one-line
 * `summary`. What only the result knows — that the message was delivered and
 * the id it travels under — is `SentMessage`, read in `transcript-extras` from
 * data Claude Code writes on the row, never from that prose. `input.content`
 * is deliberately not read: it is an echo of `message` cut at forty-odd
 * characters with an ellipsis.
 */

export const MESSAGE_TOOL = 'SendMessage';

export function isMessageTool(name: string): boolean {
  return name === MESSAGE_TOOL;
}

/** The delivery this call made, or `undefined` when it delivered nothing (or
 *  has not answered yet). */
export function sentOf(group: ToolGroup): SentMessage | undefined {
  return group.result?.sent;
}

const inputStr = (group: ToolGroup, key: string): string | undefined => {
  const v = (group.use.input as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
};

/** The recipient as the call named it: a session's declared name, its socket
 *  (`uds:/tmp/cc-socks/N.sock`), a teammate, or `main` from inside an agent. */
export function messageRecipient(group: ToolGroup): string {
  return inputStr(group, 'to') ?? inputStr(group, 'recipient') ?? 'unknown';
}

/** The full text of the message. */
export function messageBody(group: ToolGroup): string {
  return inputStr(group, 'message') ?? '';
}

/** The one-line summary the call gave the message, when it gave one. */
export function messageSummary(group: ToolGroup): string | undefined {
  const s = inputStr(group, 'summary');
  return s?.trim() || undefined;
}

export type MessageDeliveryState =
  /** No result on disk yet: a session mid-call, or a CLI killed mid-send. */
  | 'sending'
  /** Claude Code recorded a message id: it left, addressed to a session. */
  | 'sent'
  /** Same, but to an agent inside this session — a teammate's inbox. */
  | 'sent-to-agent'
  /** The tool answered and recorded no delivery: an unreachable name, or a
   *  reply that queues for the main conversation and travels under no id. */
  | 'not-delivered'
  /** The tool call itself errored. */
  | 'failed';

export function messageDeliveryState(group: ToolGroup): MessageDeliveryState {
  const { result } = group;
  if (!result) return 'sending';
  if (result.isError) return 'failed';
  const sent = result.sent;
  if (!sent) return 'not-delivered';
  return sent.to === 'agent' ? 'sent-to-agent' : 'sent';
}

/** The label the status strip prints for each state. */
export const DELIVERY_LABEL: Record<MessageDeliveryState, string> = {
  sending: 'SENDING',
  sent: 'SENT',
  'sent-to-agent': 'SENT',
  'not-delivered': 'NO DELIVERY',
  failed: 'FAILED',
};

/** Whether the exchange this message belongs to can be opened from it: only a
 *  delivery to another SESSION carries an id the exchange reader joins on — an
 *  agent's inbox threads with nothing, and a call that delivered nothing has
 *  no other half. */
export function messageExchangeId(group: ToolGroup): string | undefined {
  const sent = sentOf(group);
  return sent && sent.to === 'session' ? sent.msgId : undefined;
}
