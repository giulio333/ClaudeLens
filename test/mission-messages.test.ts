// The conversations of a session, as the messages dock groups them.
//
// Both halves of a cross-session message are in the transcript on different
// rows — a turn carrying `inbound`, and a `SendMessage` tool call — and the
// dock's job is to put them back into threads. The hard part is who the
// counterpart IS: the name it carries is its own claim and changes, while the
// pid the receiver verified off the socket does not.

import { describe, it, expect } from 'vitest';
import {
  buildMessageThreads,
  socketPid,
} from '../src/components/project/terminal/mission-messages';
import type { ProcessedMessage, ToolGroup } from '../src/components/project/chat/utils';
import type { InboundOrigin, SentMessage } from '../src/types';

const T0 = Date.parse('2026-08-11T10:00:00.000Z');
const iso = (m: number) => new Date(T0 + m * 60_000).toISOString();

function sendGroup(
  id: string,
  to: string,
  message: string,
  opts: { summary?: string; sent?: SentMessage; result?: 'none' | 'error' } = {}
): ToolGroup {
  const use = {
    type: 'tool_use',
    id,
    name: 'SendMessage',
    input: { to, message, ...(opts.summary ? { summary: opts.summary } : {}) },
  };
  if (opts.result === 'none') return { use, result: null } as unknown as ToolGroup;
  return {
    use,
    result: {
      type: 'tool_result',
      toolUseId: id,
      content: '{"success":true}',
      isError: opts.result === 'error',
      ...(opts.sent ? { sent: opts.sent } : {}),
    },
  } as unknown as ToolGroup;
}

/** An assistant turn carrying tool groups, at +N minutes. */
function turn(m: number, groups: ToolGroup[]): ProcessedMessage {
  return {
    msg: { uuid: `t${m}`, role: 'assistant', timestamp: iso(m), content: [] },
    toolGroups: groups,
  } as unknown as ProcessedMessage;
}

/** A received message: the turn the reader injects for an inbound row. */
function received(m: number, text: string, inbound: InboundOrigin): ProcessedMessage {
  return {
    msg: {
      uuid: `in${m}`,
      role: 'user',
      timestamp: iso(m),
      content: [{ type: 'text', text }],
      inbound,
    },
    toolGroups: [],
  } as unknown as ProcessedMessage;
}

const delivered = (msgId: string): SentMessage => ({ msgId, to: 'session' });

describe('socketPid', () => {
  it('reads the pid out of the socket a call addressed', () => {
    expect(socketPid('uds:/tmp/cc-socks/21421.sock')).toBe(21421);
    expect(socketPid('acme-9d')).toBeUndefined();
  });
});

describe('message threads', () => {
  it('puts both halves of one conversation in one thread, oldest first', () => {
    const out = sendGroup('s1', 'uds:/tmp/cc-socks/21421.sock', 'what are you doing?', {
      summary: 'Asking',
      sent: delivered('m-1'),
    });
    const [thread, ...rest] = buildMessageThreads([
      turn(1, [out]),
      received(2, 'idle here too', {
        from: 'session',
        name: 'acme-37',
        pid: 21421,
        msgId: 'm-2',
      }),
    ]);

    expect(rest).toHaveLength(0);
    expect(thread.kind).toBe('session');
    expect(thread.messages.map(m => m.direction)).toEqual(['out', 'in']);
    expect(thread.sent).toBe(1);
    expect(thread.received).toBe(1);
    expect(thread.last.text).toBe('idle here too');
    // The summary rides the sent message; the exchange opens on the newest id.
    expect(thread.messages[0].summary).toBe('Asking');
    expect(thread.msgId).toBe('m-2');
  });

  it('names the thread by what the party called ITSELF, not by what we called it', () => {
    // The call addressed a socket and the reply declared a name: the name is
    // the party's own, so it is what the thread is labelled with.
    const out = sendGroup('s1', 'uds:/tmp/cc-socks/777.sock', 'ping', {
      sent: delivered('m-1'),
    });
    const [thread] = buildMessageThreads([
      turn(1, [out]),
      received(2, 'pong', { from: 'session', name: 'acme-37', pid: 777, msgId: 'm-2' }),
    ]);
    expect(thread.party).toBe('acme-37');

    // And it follows a rename: the latest declared name wins.
    const [renamed] = buildMessageThreads([
      received(1, 'pong', { from: 'session', name: 'acme-37', pid: 777, msgId: 'm-2' }),
      received(3, 'still here', { from: 'session', name: 'drift-watch', pid: 777, msgId: 'm-3' }),
    ]);
    expect(renamed.party).toBe('drift-watch');
    expect(renamed.messages).toHaveLength(2);
  });

  it('joins a message addressed by name to the process that declared it', () => {
    // The reply came from a verified pid and declared "acme-9d"; the next call
    // addresses that name. One conversation, not two.
    const first = sendGroup('s1', 'uds:/tmp/cc-socks/900.sock', 'ping', {
      sent: delivered('m-1'),
    });
    const byName = sendGroup('s2', 'acme-9d', 'and now?', { sent: delivered('m-3') });
    const threads = buildMessageThreads([
      turn(1, [first]),
      received(2, 'pong', { from: 'session', name: 'acme-9d', pid: 900, msgId: 'm-2' }),
      turn(3, [byName]),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(3);
  });

  it('leaves a name nothing verified standing on its own', () => {
    // Nothing ties "someone-else" to a process: claiming it is the same party
    // as a pid-keyed thread would be a guess.
    const a = sendGroup('s1', 'uds:/tmp/cc-socks/900.sock', 'ping', { sent: delivered('m-1') });
    const b = sendGroup('s2', 'someone-else', 'ping', { sent: delivered('m-9') });
    const threads = buildMessageThreads([turn(1, [a]), turn(2, [b])]);
    expect(threads.map(t => t.party).sort()).toEqual(['pid 900', 'someone-else']);
  });

  it('keeps an agent inside this session apart, and gives it no exchange', () => {
    const toAgent = sendGroup('s1', 'worker-b', 'second run please', {
      sent: { msgId: 'm-1', to: 'agent' },
    });
    const threads = buildMessageThreads([
      turn(1, [toAgent]),
      received(2, 'done', { from: 'agent', name: 'worker-b' }),
      received(3, 'ping', { from: 'session', name: 'worker-b', pid: 12, msgId: 'm-2' }),
    ]);

    const agent = threads.find(t => t.kind === 'agent')!;
    const session = threads.find(t => t.kind === 'session')!;
    // Same name on both, and they are still two different counterparts.
    expect(agent.party).toBe('worker-b');
    expect(agent.messages).toHaveLength(2);
    expect(agent.msgId).toBeUndefined();
    expect(session.msgId).toBe('m-2');
  });

  it('carries the delivery state of the last thing said', () => {
    const pending = sendGroup('s1', 'acme-9d', 'hello?', { result: 'none' });
    const failed = sendGroup('s2', 'other-7c', 'hello?', { result: 'error' });
    const threads = buildMessageThreads([turn(1, [pending]), turn(2, [failed])]);
    const byParty = new Map(threads.map(t => [t.party, t]));
    expect(byParty.get('acme-9d')!.last.state).toBe('sending');
    expect(byParty.get('other-7c')!.last.state).toBe('failed');
    // Neither was delivered, so neither has an exchange to open.
    expect(threads.every(t => t.msgId === undefined)).toBe(true);
  });

  it('orders the threads by the most recent thing said in each', () => {
    const old = sendGroup('s1', 'uds:/tmp/cc-socks/1.sock', 'old', { sent: delivered('m-1') });
    const fresh = sendGroup('s2', 'uds:/tmp/cc-socks/2.sock', 'fresh', { sent: delivered('m-2') });
    const threads = buildMessageThreads([turn(1, [old]), turn(9, [fresh])]);
    expect(threads.map(t => t.last.text)).toEqual(['fresh', 'old']);
  });

  it('is empty for a session that talked to nobody', () => {
    expect(buildMessageThreads([turn(1, [])])).toEqual([]);
  });
});
