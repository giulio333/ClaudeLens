import type { ExchangeMessage, ExchangeOutcome } from '../../../types';

/**
 * The shape of an exchange as the page draws it.
 *
 * The join answers with a flat list of messages; a conversation is not a list.
 * What a reader needs is which side each message is on, where one party stops
 * and the other starts — a run of messages from the same party is one thing
 * said, not three — and how long the whole thing took. All of it is derivable
 * from the messages alone, so it lives here and is tested without a DOM.
 */

export type ThreadRow = {
  message: ExchangeMessage;
  /** Sent by the session the page was opened from: drawn on the reader's side. */
  isOwn: boolean;
  /** First message of a run by the same sender — the one that wears the face. */
  startsRun: boolean;
  /** The message the reader came from. */
  isEntry: boolean;
};

export function buildThreadRows(data: ExchangeOutcome, here: string): ThreadRow[] {
  let previous: string | null = null;
  return data.messages.map(message => {
    const startsRun = message.from !== previous;
    previous = message.from;
    return {
      message,
      isOwn: message.from === here,
      startsRun,
      isEntry: message.msgId === data.entryMsgId,
    };
  });
}

/** How many messages each side sent, and over how long. */
export function summarizeExchange(
  data: ExchangeOutcome,
  here: string
): { total: number; own: number; other: number; span: string } {
  const own = data.messages.filter(m => m.from === here).length;
  return {
    total: data.messages.length,
    own,
    other: data.messages.length - own,
    span: exchangeSpan(data.messages),
  };
}

/**
 * The wall time the conversation covers, in one token — `44s`, `6m`, `2h`,
 * `3d`. Empty for a single message: a span of zero is not a duration, and
 * printing "0s" would read as one.
 */
export function exchangeSpan(messages: ExchangeMessage[]): string {
  if (messages.length < 2) return '';
  const times = messages.map(m => Date.parse(m.timestamp)).filter(t => !Number.isNaN(t));
  if (times.length < 2) return '';
  const delta = Math.max(...times) - Math.min(...times);
  if (delta < 1000) return '';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`;
  return `${Math.round(delta / 86_400_000)}d`;
}

/** The clock of a message — the page's own rhythm is seconds apart, so the
 *  date is stated once, at the head of the thread, and never on a row. */
export function messageClock(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** The day the conversation happened, stated once above the thread. */
export function threadDay(messages: ExchangeMessage[]): string {
  const first = messages[0];
  if (!first) return '';
  const d = new Date(first.timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('it-IT', { dateStyle: 'full' });
}
