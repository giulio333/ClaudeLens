// The shape of an exchange as the page draws it: which side each message is
// on, where one party stops and the other starts, and how long the whole
// conversation took. The join answers with a flat list; a conversation is not
// one, and this is the part of the difference that needs no DOM.

import { describe, it, expect } from 'vitest';
import {
  buildThreadRows,
  exchangeSpan,
  messageClock,
  summarizeExchange,
  threadDay,
} from '../src/components/project/exchange/thread';
import type { ExchangeMessage, ExchangeOutcome } from '../src/types';

const A = 'aaaaaaaa';
const B = 'bbbbbbbb';

function msg(over: Partial<ExchangeMessage> & Pick<ExchangeMessage, 'msgId' | 'from' | 'to'>) {
  return {
    timestamp: '2026-03-01T10:00:00Z',
    text: 'hi',
    receivedUuid: `r-${over.msgId}`,
    ...over,
  } as ExchangeMessage;
}

function outcome(messages: ExchangeMessage[], entryMsgId = messages[0]?.msgId): ExchangeOutcome {
  return { entryMsgId: entryMsgId ?? '', parties: [], messages, scanned: 2, elapsedMs: 5 };
}

describe('thread rows', () => {
  const conversation = outcome(
    [
      msg({ msgId: 'm1', from: A, to: B, timestamp: '2026-03-01T10:00:00Z' }),
      msg({ msgId: 'm2', from: A, to: B, timestamp: '2026-03-01T10:00:05Z' }),
      msg({ msgId: 'm3', from: B, to: A, timestamp: '2026-03-01T10:00:30Z' }),
      msg({ msgId: 'm4', from: A, to: B, timestamp: '2026-03-01T10:00:44Z' }),
    ],
    'm3'
  );

  it('puts each message on the side that sent it, from where the page was opened', () => {
    const rows = buildThreadRows(conversation, B);
    expect(rows.map(r => r.isOwn)).toEqual([false, false, true, false]);
  });

  it('opens a run when the sender changes, and only then', () => {
    // Two messages in a row from one party are one thing said, not two: the
    // second continues the first and does not wear the face again.
    expect(buildThreadRows(conversation, B).map(r => r.startsRun)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it('marks the message the reader came from, and no other', () => {
    const rows = buildThreadRows(conversation, B);
    expect(rows.map(r => r.isEntry)).toEqual([false, false, true, false]);
  });

  it('counts each side and the wall time the conversation covers', () => {
    expect(summarizeExchange(conversation, B)).toEqual({
      total: 4,
      own: 1,
      other: 3,
      span: '44s',
    });
  });
});

describe('the span of a conversation', () => {
  const at = (iso: string) => msg({ msgId: iso, from: A, to: B, timestamp: iso });

  it('is one token, at the scale the conversation actually took', () => {
    expect(exchangeSpan([at('2026-03-01T10:00:00Z'), at('2026-03-01T10:06:00Z')])).toBe('6m');
    expect(exchangeSpan([at('2026-03-01T10:00:00Z'), at('2026-03-01T12:00:00Z')])).toBe('2h');
    expect(exchangeSpan([at('2026-03-01T10:00:00Z'), at('2026-03-04T10:00:00Z')])).toBe('3d');
  });

  it('says nothing rather than "0s" for a single message or an instant one', () => {
    // A span of zero is not a duration, and printing one would read as one.
    expect(exchangeSpan([at('2026-03-01T10:00:00Z')])).toBe('');
    expect(exchangeSpan([at('2026-03-01T10:00:00Z'), at('2026-03-01T10:00:00.400Z')])).toBe('');
  });

  it('ignores a timestamp it cannot read instead of measuring from NaN', () => {
    expect(exchangeSpan([at('2026-03-01T10:00:00Z'), at('not a date')])).toBe('');
  });
});

describe('the clock of a message', () => {
  it('is the time alone — the date is stated once, above the thread', () => {
    expect(messageClock('2026-03-01T10:00:05Z')).toMatch(/^\d{2}:\d{2}:05$/);
    expect(threadDay([msg({ msgId: 'm', from: A, to: B })])).toContain('2026');
  });

  it('prints nothing for a timestamp that is not one', () => {
    expect(messageClock('nope')).toBe('');
    expect(threadDay([])).toBe('');
  });
});
