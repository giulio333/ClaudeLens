// The two halves of a message sent between sessions, joined (#280).
//
// A `SendMessage` from one session lands in another's transcript, and the app
// read both sides without ever putting them together: the sender holds a tool
// result carrying `msg_id`, the receiver a row whose `origin.msg_id` is that
// same value. These tests pin what the join promises — which rows count as a
// half, how a sender is named when its own transcript is gone, and that a
// transcript merely QUOTING a message id is not a half of it.
//
// Every transcript here is synthetic: shapes copied from Claude Code 2.1.27x
// (row keys, `uds:` sockets, 24-hex hop fingerprints), names that stand for
// nothing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  exchangeStats,
  parseExchangeHalves,
  readExchange,
  resetExchangeCache,
} from '../electron/modules/session-exchange';

let projectsDir: string;

const ACME = '-Users-alice-acme';
const WIDGETS = '-Users-alice-widgets';
const A = 'aaaaaaaa-1111-2222-3333-444444444444';
const B = 'bbbbbbbb-1111-2222-3333-444444444444';
const C = 'cccccccc-1111-2222-3333-444444444444';
const FP_A = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const FP_B = 'b2b2b2b2b2b2b2b2b2b2b2b2';

/** The assistant row holding the `SendMessage` call, then the user row Claude
 *  Code writes with its result — `msg_id` sits on the row's `toolUseResult`,
 *  never inside the `tool_result` block. */
function sentLines(opts: {
  session: string;
  turnUuid: string;
  toolUseId: string;
  msgId: string;
  to: string;
  summary?: string;
  text: string;
  at: string;
}): string[] {
  return [
    JSON.stringify({
      type: 'assistant',
      uuid: opts.turnUuid,
      sessionId: opts.session,
      timestamp: opts.at,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [
          { type: 'text', text: 'Sending.' },
          {
            type: 'tool_use',
            id: opts.toolUseId,
            name: 'SendMessage',
            input: { to: opts.to, summary: opts.summary, message: opts.text },
          },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      uuid: `${opts.turnUuid}-result`,
      parentUuid: opts.turnUuid,
      sourceToolAssistantUUID: opts.turnUuid,
      sessionId: opts.session,
      timestamp: opts.at,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: opts.toolUseId, content: 'sent' }],
      },
      toolUseResult: {
        success: true,
        message: `“${opts.summary ?? ''}” → ${opts.to} (another Claude session on this machine)`,
        display: `sent to ${opts.to}`,
        msg_id: opts.msgId,
      },
    }),
  ];
}

/** The receiver's row: an `isMeta` user line when the receiver was idle, a
 *  `queued_command` attachment when it was mid-turn. Same `origin` either way. */
function receivedLine(opts: {
  session: string;
  uuid: string;
  msgId: string;
  pid: number;
  name: string;
  hopChain: string[];
  text: string;
  at: string;
  queued?: boolean;
  senderTaskId?: string;
}): string {
  const origin = {
    kind: 'peer',
    from: opts.senderTaskId ? opts.name : `uds:/tmp/cc-socks/${opts.pid}.sock`,
    ...(opts.senderTaskId ? { senderTaskId: opts.senderTaskId } : { verifiedPeerPid: opts.pid }),
    msg_id: opts.msgId,
    name: opts.name,
    hopChain: opts.hopChain,
    fromMode: 'prompting',
    body: opts.text,
  };
  if (opts.queued) {
    return JSON.stringify({
      type: 'attachment',
      uuid: opts.uuid,
      sessionId: opts.session,
      timestamp: opts.at,
      attachment: {
        type: 'queued_command',
        isMeta: true,
        origin,
        prompt: `<cross-session-message>${opts.text}</cross-session-message>`,
        timestamp: opts.at,
      },
    });
  }
  return JSON.stringify({
    type: 'user',
    uuid: opts.uuid,
    isMeta: true,
    sessionId: opts.session,
    timestamp: opts.at,
    origin,
    message: {
      role: 'user',
      content: `Another Claude session sent a message:\n<cross-session-message>${opts.text}</cross-session-message>`,
    },
  });
}

function userLine(session: string, uuid: string, text: string): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    sessionId: session,
    timestamp: '2026-03-01T09:00:00Z',
    message: { role: 'user', content: text },
  });
}

function transcript(hash: string, sessionId: string, lines: string[], nested = false): string {
  const dir = nested ? join(projectsDir, hash, 'sessions') : join(projectsDir, hash);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
  return path;
}

/** Three messages between A (acme) and B (widgets): A opens, B replies from
 *  inside the turn that message started, A replies again. The hop chain grows
 *  by the sender's fingerprint at each step, so A appears in it twice. */
function conversation(): { a: string; b: string } {
  const a = transcript(ACME, A, [
    userLine(A, 'a-u0', 'ping widgets please'),
    ...sentLines({
      session: A,
      turnUuid: 'a-turn-1',
      toolUseId: 'toolu_01',
      msgId: 'm1',
      to: 'widgets-7c',
      summary: 'Ping',
      text: 'ping from acme',
      at: '2026-03-01T10:00:01Z',
    }),
    receivedLine({
      session: A,
      uuid: 'a-in-2',
      msgId: 'm2',
      pid: 222,
      name: 'widgets-7c',
      hopChain: [FP_A, FP_B],
      text: 'pong from widgets',
      at: '2026-03-01T10:00:30Z',
      queued: true,
    }),
    ...sentLines({
      session: A,
      turnUuid: 'a-turn-3',
      toolUseId: 'toolu_03',
      msgId: 'm3',
      to: 'widgets-7c',
      summary: 'Thanks',
      text: 'thanks, closing',
      at: '2026-03-01T10:01:01Z',
    }),
  ]);
  const b = transcript(
    WIDGETS,
    B,
    [
      receivedLine({
        session: B,
        uuid: 'b-in-1',
        msgId: 'm1',
        pid: 111,
        name: 'acme-lead',
        hopChain: [FP_A],
        text: 'ping from acme',
        at: '2026-03-01T10:00:00Z',
      }),
      ...sentLines({
        session: B,
        turnUuid: 'b-turn-2',
        toolUseId: 'toolu_02',
        msgId: 'm2',
        to: 'acme-lead',
        summary: 'Pong',
        text: 'pong from widgets',
        at: '2026-03-01T10:00:31Z',
      }),
      receivedLine({
        session: B,
        uuid: 'b-in-3',
        msgId: 'm3',
        pid: 111,
        name: 'acme-lead',
        hopChain: [FP_A, FP_B, FP_A],
        text: 'thanks, closing',
        at: '2026-03-01T10:01:00Z',
      }),
    ],
    true
  );
  return { a, b };
}

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), 'cl-exchange-'));
  resetExchangeCache();
});

afterEach(() => {
  rmSync(projectsDir, { recursive: true, force: true });
});

describe('parseExchangeHalves (pure)', () => {
  it('reads the sender half off the tool result row and the summary off the call', () => {
    const raw = sentLines({
      session: A,
      turnUuid: 'a-turn-1',
      toolUseId: 'toolu_01',
      msgId: 'm1',
      to: 'widgets-7c',
      summary: 'Ping',
      text: 'ping from acme',
      at: '2026-03-01T10:00:01Z',
    }).join('\n');

    const { sent, received } = parseExchangeHalves(raw);

    expect(received).toEqual([]);
    expect(sent).toEqual([
      {
        msgId: 'm1',
        turnUuid: 'a-turn-1',
        timestamp: '2026-03-01T10:00:01Z',
        to: 'widgets-7c',
        summary: 'Ping',
      },
    ]);
  });

  it('reads the receiver half from both delivery forms', () => {
    const raw = [
      receivedLine({
        session: B,
        uuid: 'b-in-1',
        msgId: 'm1',
        pid: 111,
        name: 'acme-lead',
        hopChain: [FP_A],
        text: 'ping from acme',
        at: '2026-03-01T10:00:00Z',
      }),
      receivedLine({
        session: B,
        uuid: 'b-in-2',
        msgId: 'm2',
        pid: 111,
        name: 'acme-lead',
        hopChain: [FP_A],
        text: 'queued one',
        at: '2026-03-01T10:00:05Z',
        queued: true,
      }),
    ].join('\n');

    const { received } = parseExchangeHalves(raw);

    expect(received.map(r => [r.msgId, r.uuid, r.text, r.queued ?? false])).toEqual([
      ['m1', 'b-in-1', 'ping from acme', false],
      ['m2', 'b-in-2', 'queued one', true],
    ]);
    expect(received[0].name).toBe('acme-lead');
    expect(received[0].hopChain).toEqual([FP_A]);
  });

  it('leaves a message from an agent inside the session out — it is not another session', () => {
    const raw = receivedLine({
      session: B,
      uuid: 'b-in-1',
      msgId: 'm9',
      pid: 0,
      name: 'reviewer',
      hopChain: [],
      text: 'done reviewing',
      at: '2026-03-01T10:00:00Z',
      senderTaskId: 'task-42',
    });

    expect(parseExchangeHalves(raw).received).toEqual([]);
  });

  it('counts only a top-level `msg_id`, never one nested in some other payload', () => {
    // A `Read` of another transcript puts its rows inside a string, where the
    // quotes are escaped and the raw reject already drops the line. What the
    // reject cannot drop is an OBJECT carrying the key somewhere else — an MCP
    // result's own schema, say — and that belongs to nobody here.
    const nested = [
      JSON.stringify({
        type: 'user',
        uuid: 'c-u1',
        timestamp: '2026-03-01T11:00:00Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_mcp', content: 'ok' }],
        },
        toolUseResult: { structuredContent: { msg_id: 'm1', origin: { kind: 'peer' } } },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'c-u2',
        timestamp: '2026-03-01T11:00:01Z',
        message: { role: 'user', content: 'hi', origin: { kind: 'peer', msg_id: 'm1', body: 'x' } },
      }),
    ].join('\n');

    const { sent, received } = parseExchangeHalves(nested);

    expect(sent).toEqual([]);
    expect(received).toEqual([]);
  });
});

describe('readExchange (over real files)', () => {
  it('joins the halves on msg_id and orders the exchange by arrival', async () => {
    conversation();

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });

    expect(outcome).not.toBeNull();
    expect(outcome!.entryMsgId).toBe('m1');
    expect(outcome!.messages.map(m => [m.msgId, m.from, m.to, m.text])).toEqual([
      ['m1', A, B, 'ping from acme'],
      ['m2', B, A, 'pong from widgets'],
      ['m3', A, B, 'thanks, closing'],
    ]);
  });

  it('reaches both turns of a message: the one that sent it and the row it landed on', async () => {
    conversation();

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });

    const m1 = outcome!.messages.find(m => m.msgId === 'm1')!;
    expect(m1.sentTurnUuid).toBe('a-turn-1');
    expect(m1.receivedUuid).toBe('b-in-1');
    expect(m1.summary).toBe('Ping');
    // A queued delivery is still the same message, landing on the attachment row.
    const m2 = outcome!.messages.find(m => m.msgId === 'm2')!;
    expect(m2.receivedUuid).toBe('a-in-2');
    expect(m2.queued).toBe(true);
  });

  it('names each party by its session, project and the name it declared', async () => {
    conversation();

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' }, hash =>
      hash === ACME ? '/Users/alice/acme' : undefined
    );

    const byId = new Map(outcome!.parties.map(p => [p.id, p]));
    expect(byId.get(A)).toMatchObject({
      sessionId: A,
      projectHash: ACME,
      projectPath: '/Users/alice/acme',
      name: 'acme-lead',
      fingerprint: FP_A,
    });
    // Widgets' cwd could not be resolved: unnamed, never guessed from the folder.
    expect(byId.get(B)).toMatchObject({ sessionId: B, projectHash: WIDGETS, name: 'widgets-7c' });
    expect(byId.get(B)!.projectPath).toBeUndefined();
  });

  it('resolves the hop chain to the parties it passed through, repeats included', async () => {
    conversation();

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm3' });

    const m3 = outcome!.messages.find(m => m.msgId === 'm3')!;
    // A path, not a set: the relay back to the session that started it is the
    // interesting case, and deduping would erase it.
    expect(m3.hops).toEqual([A, B, A]);
  });

  it('still attributes a sender whose own transcript is gone, by fingerprint and name', async () => {
    const { a } = conversation();
    rmSync(a);

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });

    // What B received from A is still there; what A received from B is not.
    expect(outcome!.messages.map(m => m.msgId)).toEqual(['m1', 'm3']);
    const sender = outcome!.parties.find(p => p.id === outcome!.messages[0].from)!;
    expect(sender.sessionId).toBeUndefined();
    expect(sender).toMatchObject({ name: 'acme-lead', fingerprint: FP_A });
    expect(outcome!.messages[0].sentTurnUuid).toBeUndefined();
  });

  it('keeps a conversation with a third session apart', async () => {
    conversation();
    transcript(ACME, C, [
      receivedLine({
        session: C,
        uuid: 'c-in-1',
        msgId: 'm7',
        pid: 111,
        name: 'acme-lead',
        hopChain: [FP_A],
        text: 'unrelated ping',
        at: '2026-03-01T10:00:10Z',
      }),
    ]);
    appendFileSync(
      join(projectsDir, ACME, `${A}.jsonl`),
      sentLines({
        session: A,
        turnUuid: 'a-turn-7',
        toolUseId: 'toolu_07',
        msgId: 'm7',
        to: 'other-3f',
        text: 'unrelated ping',
        at: '2026-03-01T10:00:11Z',
      }).join('\n') + '\n'
    );

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });

    expect(outcome!.messages.map(m => m.msgId)).toEqual(['m1', 'm2', 'm3']);
    expect(outcome!.parties.map(p => p.id).sort()).toEqual([A, B].sort());
  });

  it('enters from the sender too: the outbound bubble opens the same exchange', async () => {
    conversation();

    const fromSender = await readExchange(projectsDir, { sessionId: A, msgId: 'm1' });
    const fromReceiver = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });

    expect(fromSender).not.toBeNull();
    expect(fromSender!.entryMsgId).toBe('m1');
    expect(fromSender!.messages).toEqual(fromReceiver!.messages);
  });

  it('answers null when the message is not in that transcript', async () => {
    conversation();
    // A message this session only sent, to a name no transcript on disk
    // received it under: one half is not a conversation.
    transcript(ACME, C, [
      ...sentLines({
        session: C,
        turnUuid: 'c-turn-1',
        toolUseId: 'toolu_c1',
        msgId: 'm-lost',
        to: 'nobody-00',
        text: 'anyone there?',
        at: '2026-03-01T12:00:00Z',
      }),
    ]);

    expect(await readExchange(projectsDir, { sessionId: B, msgId: 'nope' })).toBeNull();
    expect(await readExchange(projectsDir, { sessionId: C, msgId: 'm1' })).toBeNull();
    expect(await readExchange(projectsDir, { sessionId: C, msgId: 'm-lost' })).toBeNull();
  });

  it('ignores a transcript that carries the id somewhere else, so it is never a party', async () => {
    conversation();
    transcript(ACME, C, [
      JSON.stringify({
        type: 'user',
        uuid: 'c-u1',
        sessionId: C,
        timestamp: '2026-03-01T11:00:00Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_mcp', content: 'ok' }],
        },
        toolUseResult: { structuredContent: { msg_id: 'm1' } },
      }),
    ]);

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });

    expect(outcome!.parties.map(p => p.id).sort()).toEqual([A, B].sort());
    // It passed the raw reject and was parsed — the rule is on the row, not on
    // the substring.
    expect(exchangeStats().parsed).toBe(3);
  });

  it('re-reads only the transcripts that changed since the last answer', async () => {
    const { b } = conversation();
    transcript(ACME, C, [userLine(C, 'c-u1', 'nothing to do with messages')]);

    await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });
    expect(exchangeStats()).toMatchObject({ scanned: 3, read: 3 });

    await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });
    expect(exchangeStats()).toMatchObject({ scanned: 3, read: 0 });

    appendFileSync(
      b,
      receivedLine({
        session: B,
        uuid: 'b-in-4',
        msgId: 'm4',
        pid: 111,
        name: 'acme-lead',
        hopChain: [FP_A],
        text: 'one more',
        at: '2026-03-01T10:02:00Z',
      }) + '\n'
    );

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });
    expect(exchangeStats()).toMatchObject({ scanned: 3, read: 1 });
    expect(outcome!.messages.map(m => m.msgId)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('forgets a transcript that was deleted', async () => {
    const { a } = conversation();
    await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });
    rmSync(a);

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });

    expect(outcome!.messages.map(m => m.msgId)).toEqual(['m1', 'm3']);
    expect(outcome!.parties.find(p => p.id === A)).toBeUndefined();
  });

  it('keeps going when one transcript cannot be read', async () => {
    conversation();
    mkdirSync(join(projectsDir, ACME, `${C}.jsonl`)); // a directory wearing a transcript's name

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });

    expect(outcome!.messages).toHaveLength(3);
  });

  it('attributes a chainless message by the pid the same receiver verified on a joined one', async () => {
    // Half the received rows on a real corpus carry no hopChain at all. When
    // such a row's sender half is missing too, the only identity left is the
    // pid the receiver verified off the socket — and B verified 111 on m1,
    // whose sender half names A.
    const { b } = conversation();
    appendFileSync(
      b,
      receivedLine({
        session: B,
        uuid: 'b-in-5',
        msgId: 'm5',
        pid: 111,
        name: 'acme-lead',
        hopChain: [],
        text: 'no chain, no sender half',
        at: '2026-03-01T10:03:00Z',
      }) + '\n'
    );

    const outcome = await readExchange(projectsDir, { sessionId: B, msgId: 'm1' });

    expect(outcome!.messages.map(m => [m.msgId, m.from])).toContainEqual(['m5', A]);
    expect(outcome!.messages.map(m => m.msgId)).toEqual(['m1', 'm2', 'm3', 'm5']);
  });

  it('does not carry a pid across receivers — pids are recycled, fingerprints are not', async () => {
    // C never joined anything with pid 111: on its transcript that pid is a
    // number, and a wrong session on the card is worse than none.
    conversation();
    transcript(ACME, C, [
      receivedLine({
        session: C,
        uuid: 'c-in-6',
        msgId: 'm6',
        pid: 111,
        name: 'acme-lead',
        hopChain: [],
        text: 'who sent this?',
        at: '2026-03-01T13:00:00Z',
      }),
    ]);

    const outcome = await readExchange(projectsDir, { sessionId: C, msgId: 'm6' });

    expect(outcome!.messages.map(m => [m.msgId, m.from, m.to])).toEqual([['m6', 'pid:111', C]]);
    expect(outcome!.parties.find(p => p.id === 'pid:111')).toMatchObject({ name: 'acme-lead' });
  });

  it('answers two overlapping reads with one pass over the corpus', async () => {
    conversation();

    const [first, second] = await Promise.all([
      readExchange(projectsDir, { sessionId: B, msgId: 'm1' }),
      readExchange(projectsDir, { sessionId: B, msgId: 'm3' }),
    ]);

    expect(first!.messages).toHaveLength(3);
    expect(second!.entryMsgId).toBe('m3');
    // Two files on disk; a second scan racing the first would have counted six.
    expect(exchangeStats()).toMatchObject({ scanned: 2, read: 2 });
  });

  it('threads a message sent from a session whose fingerprint another exchange taught', async () => {
    // C never received anything from A, but B did — and B's rows carry A's
    // fingerprint. A message from A to C is attributed to A through that.
    conversation();
    transcript(ACME, C, [
      receivedLine({
        session: C,
        uuid: 'c-in-8',
        msgId: 'm8',
        pid: 111,
        name: 'acme-lead',
        hopChain: [FP_A],
        text: 'hello c',
        at: '2026-03-01T12:00:00Z',
      }),
    ]);
    // A's own half of m8 is missing (say, the send happened after a compaction
    // the SDK read cannot see past) — the fingerprint still says who sent it.
    const outcome = await readExchange(projectsDir, { sessionId: C, msgId: 'm8' });

    expect(outcome!.messages.map(m => [m.msgId, m.from, m.to])).toEqual([['m8', A, C]]);
    expect(outcome!.parties.find(p => p.id === A)).toMatchObject({
      sessionId: A,
      name: 'acme-lead',
    });
  });
});
