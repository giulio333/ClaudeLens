import {
  readAppend,
  parseJsonlLine,
  parseTurnUsage,
  readSessionTitle,
} from '../electron/modules/transcript-tail';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let dir: string;
let file: string;

function assistant(blocks: unknown[], extra: Record<string, unknown> = {}): string {
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-16T10:00:00.000Z',
      message: { role: 'assistant', model: 'claude-opus-5', content: blocks, ...extra },
    }) + '\n'
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cl-tail-'));
  file = join(dir, 'session.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readAppend', () => {
  it('reads complete lines and reports the new cursor', () => {
    writeFileSync(file, assistant([{ type: 'text', text: 'hello' }]), 'utf-8');

    const read = readAppend(file, 0);

    expect(read.events.map(e => e.type)).toEqual(['text']);
    expect(read.events[0].content).toBe('hello');
    expect(read.offset).toBe(Buffer.byteLength(assistant([{ type: 'text', text: 'hello' }])));
    expect(read.dropped).toBe(0);
    expect(read.reset).toBe(false);
  });

  it('leaves a trailing partial line unconsumed until its newline arrives', () => {
    const complete = assistant([{ type: 'text', text: 'first' }]);
    const partial = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] },
    }); // no newline: the CLI is still writing this record
    writeFileSync(file, complete + partial, 'utf-8');

    const first = readAppend(file, 0);
    expect(first.events.map(e => e.content)).toEqual(['first']);
    // Cursor stops at the last newline, NOT at EOF.
    expect(first.offset).toBe(Buffer.byteLength(complete));

    appendFileSync(file, '\n', 'utf-8');
    const second = readAppend(file, first.offset);
    expect(second.events.map(e => e.content)).toEqual(['second']);
  });

  it('reassembles a line split across chunk boundaries', () => {
    writeFileSync(file, assistant([{ type: 'text', text: 'a line much longer than a chunk' }]));

    const read = readAppend(file, 0, 8); // 8-byte chunks

    expect(read.events.map(e => e.content)).toEqual(['a line much longer than a chunk']);
    expect(read.dropped).toBe(0);
  });

  it('keeps a multi-byte character intact when it straddles two chunks', () => {
    // Accented text and an emoji: decoding per chunk would corrupt them.
    const text = 'perché è così 🎯 andato';
    writeFileSync(file, assistant([{ type: 'text', text }]));

    // Every chunk size from 1..24 bytes must yield the same string.
    for (const size of [1, 3, 7, 13, 24]) {
      const read = readAppend(file, 0, size);
      expect(read.events[0].content).toBe(text);
    }
  });

  it('re-reads from zero when the file shrank below the cursor', () => {
    writeFileSync(file, assistant([{ type: 'text', text: 'old' }]));
    const first = readAppend(file, 0);

    // Transcript recreated (shorter than the previous cursor).
    writeFileSync(file, assistant([{ type: 'text', text: 'new' }]).slice(0, -1) + '\n');
    const second = readAppend(file, first.offset + 10_000);

    expect(second.reset).toBe(true);
    expect(second.events.map(e => e.content)).toEqual(['new']);
  });

  it('drops a malformed line without losing the ones around it', () => {
    writeFileSync(
      file,
      assistant([{ type: 'text', text: 'before' }]) +
        '{ not json at all\n' +
        assistant([{ type: 'text', text: 'after' }])
    );

    const read = readAppend(file, 0);

    expect(read.events.map(e => e.content)).toEqual(['before', 'after']);
    expect(read.dropped).toBe(1);
  });

  it('returns nothing when the file has not grown', () => {
    writeFileSync(file, assistant([{ type: 'text', text: 'only' }]));
    const first = readAppend(file, 0);
    const second = readAppend(file, first.offset);

    expect(second.events).toEqual([]);
    expect(second.offset).toBe(first.offset);
  });
});

describe('parseJsonlLine', () => {
  it('skips meta and sidechain lines', () => {
    const base = { type: 'assistant', message: { role: 'assistant', content: [] } };
    expect(parseJsonlLine({ ...base, isMeta: true })).toEqual([]);
    expect(parseJsonlLine({ ...base, isSidechain: true })).toEqual([]);
    expect(parseJsonlLine({ type: 'system', message: {} })).toEqual([]);
  });

  it('emits a tool_use event with name and input', () => {
    const events = parseJsonlLine(
      JSON.parse(
        assistant([{ type: 'tool_use', id: 'toolu_abcd', name: 'Bash', input: { command: 'ls' } }])
      )
    );
    const tool = events.find(e => e.type === 'tool_use');
    expect(tool?.toolName).toBe('Bash');
    expect(tool?.toolInput).toEqual({ command: 'ls' });
  });

  it('derives status from stop_reason but ignores the mid-stream draft', () => {
    const idle = parseJsonlLine(JSON.parse(assistant([], { stop_reason: 'end_turn' })));
    expect(idle.find(e => e.type === 'status_change')?.content).toBe('idle');

    const busy = parseJsonlLine(JSON.parse(assistant([], { stop_reason: 'tool_use' })));
    expect(busy.find(e => e.type === 'status_change')?.content).toBe('busy');

    // stop_reason null is the draft written while streaming: no status event.
    const draft = parseJsonlLine(JSON.parse(assistant([], { stop_reason: null })));
    expect(draft.find(e => e.type === 'status_change')).toBeUndefined();
  });

  it('marks a failed tool_result', () => {
    const events = parseJsonlLine({
      type: 'user',
      timestamp: '2026-08-16T10:00:01.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_abcd', content: 'boom', is_error: true },
        ],
      },
    });
    const result = events.find(e => e.type === 'tool_result');
    expect(result?.isError).toBe(true);
    expect(result?.content).toBe('boom');
  });

  it('carries the tool_use id on both the call and its result', () => {
    const call = parseJsonlLine(
      JSON.parse(assistant([{ type: 'tool_use', id: 'toolu_abcd', name: 'Bash', input: {} }]))
    );
    expect(call.find(e => e.type === 'tool_use')?.toolUseId).toBe('toolu_abcd');

    const result = parseJsonlLine({
      type: 'user',
      timestamp: '2026-08-16T10:00:01.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_abcd', content: 'ok' }],
      },
    });
    expect(result.find(e => e.type === 'tool_result')?.toolUseId).toBe('toolu_abcd');
  });

  // A finished async agent reports back as a plain user line. The id it carries
  // is the only link to the dispatch that launched it, and the tags are stripped
  // for display — so it has to be read before that.
  it('reads the dispatch id out of a task notification before stripping tags', () => {
    const events = parseJsonlLine({
      type: 'user',
      timestamp: '2026-08-16T10:02:28.000Z',
      message: {
        role: 'user',
        content:
          '<task-notification>\n<task-id>ae80291f22a598955</task-id>\n' +
          '<tool-use-id>toolu_01Hxs93TXkQroZzFVbaoBfhE</tool-use-id>\n' +
          '<status>completed</status>\n<summary>Agent "Map the reads" finished</summary>\n',
      },
    });
    const note = events.find(e => e.type === 'user_message');
    expect(note?.toolUseId).toBe('toolu_01Hxs93TXkQroZzFVbaoBfhE');
    // The displayed text keeps the prose, without the markup.
    expect(note?.content).not.toContain('<tool-use-id>');
    expect(note?.content).toContain('completed');
  });

  // The title is its own record type, so it has to be read ahead of the
  // user/assistant filter — and it carries no timestamp, which must not date the
  // session to now.
  it('emits the session title from an ai-title record', () => {
    const events = parseJsonlLine({
      type: 'ai-title',
      aiTitle: 'Sessione di test',
      sessionId: 's',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('session_title');
    expect(events[0].content).toBe('Sessione di test');
    expect(events[0].timestamp).toBe('');
    expect(events[0].titleSource).toBe('ai');
  });

  // The record `/title` writes. Reading only the generated one left the Monitor
  // showing its no-name fallback for a session the user had named, while the
  // sessions list (`customTitle || aiTitle`) printed that name — two surfaces
  // disagreeing about which session is which.
  it('emits the session title from a custom-title record', () => {
    const events = parseJsonlLine({
      type: 'custom-title',
      customTitle: 'Il nome che ho scelto',
      sessionId: 's',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('session_title');
    expect(events[0].content).toBe('Il nome che ho scelto');
    expect(events[0].titleSource).toBe('custom');
  });

  it('ignores a title record with nothing in it', () => {
    expect(parseJsonlLine({ type: 'ai-title', aiTitle: '   ' })).toEqual([]);
    expect(parseJsonlLine({ type: 'ai-title' })).toEqual([]);
    expect(parseJsonlLine({ type: 'custom-title', customTitle: '' })).toEqual([]);
    expect(parseJsonlLine({ type: 'custom-title' })).toEqual([]);
  });

  it('leaves toolUseId unset on an ordinary user prompt', () => {
    const events = parseJsonlLine({
      type: 'user',
      timestamp: '2026-08-16T10:00:00.000Z',
      message: { role: 'user', content: 'read the docs please' },
    });
    expect(events.find(e => e.type === 'user_message')?.toolUseId).toBeUndefined();
  });
});

// The usage block: the one part of an assistant line the tail used to read past.
// It is what tells the Monitor how full a session's context window is and what
// the session has cost — the two facts that only mean anything while it runs.
describe('parseTurnUsage', () => {
  const withUsage = (usage: unknown, extra: Record<string, unknown> = {}) =>
    JSON.parse(
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-16T10:00:00.000Z',
        message: { role: 'assistant', model: 'claude-opus-5', content: [], usage },
        ...extra,
      })
    ) as Record<string, unknown>;

  it('reads all four billed kinds off the line', () => {
    expect(
      parseTurnUsage(
        withUsage({
          input_tokens: 2,
          cache_creation_input_tokens: 277,
          cache_read_input_tokens: 277_604,
          output_tokens: 139,
        })
      )
    ).toEqual({
      at: Date.parse('2026-08-16T10:00:00.000Z'),
      model: 'claude-opus-5',
      inputTokens: 2,
      outputTokens: 139,
      cacheWriteTokens: 277,
      cacheReadTokens: 277_604,
    });
  });

  // The same rule that keeps a sub-agent's tool tally out of its parent's, and it
  // matters more here: a sub-agent's prompt added to the parent's would report a
  // window fuller than it is and predict a compaction that is not coming.
  it("never bills a sub-agent's tokens to the session that dispatched it", () => {
    const usage = { input_tokens: 5, output_tokens: 900, cache_read_input_tokens: 50_000 };
    expect(parseTurnUsage(withUsage(usage, { isSidechain: true }))).toBeNull();
    expect(parseTurnUsage(withUsage(usage, { isMeta: true }))).toBeNull();
    expect(parseTurnUsage(withUsage(usage))).not.toBeNull();
  });

  it('ignores a line that carries no usage, and a usage block that is all zeros', () => {
    const bare = JSON.parse(assistant([{ type: 'text', text: 'hi' }])) as Record<string, unknown>;
    expect(parseTurnUsage(bare)).toBeNull();
    expect(parseTurnUsage(withUsage({}))).toBeNull();
    expect(parseTurnUsage(withUsage({ input_tokens: 0, output_tokens: 0 }))).toBeNull();
    expect(parseTurnUsage({ type: 'user', message: { usage: { input_tokens: 5 } } })).toBeNull();
  });

  // Undocumented internal format: a key that changed type must cost a zero, never
  // a NaN travelling into a dollar figure on screen.
  it('reads a malformed field as zero rather than letting NaN out', () => {
    const turn = parseTurnUsage(
      withUsage({ input_tokens: '12', output_tokens: 7, cache_read_input_tokens: -3 })
    );
    expect(turn).toEqual({
      at: Date.parse('2026-08-16T10:00:00.000Z'),
      model: 'claude-opus-5',
      inputTokens: 0,
      outputTokens: 7,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('collects one entry per assistant line of an append, in file order', () => {
    writeFileSync(file, '');
    appendFileSync(
      file,
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-16T10:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-5',
          content: [],
          usage: { output_tokens: 1 },
        },
      }) + '\n'
    );
    appendFileSync(file, assistant([{ type: 'text', text: 'no usage here' }]));
    appendFileSync(
      file,
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-16T10:00:09.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-5',
          content: [],
          usage: { output_tokens: 2 },
        },
      }) + '\n'
    );

    const read = readAppend(file, 0);
    expect(read.turns.map(t => t.outputTokens)).toEqual([1, 2]);
  });

  // One turn, several lines. Claude Code writes an assistant message one line per
  // content block and repeats the whole envelope — usage included — on each, so
  // the entries have to carry the identity that says they are one turn or a
  // consumer summing them bills it twice (measured at 1.86× on a real
  // transcript). Same identity `cost-tracker` has deduped on since #56.
  it('stamps the lines of one turn with the same identity', () => {
    const block = (blocks: unknown[]) =>
      JSON.parse(
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-08-16T10:00:00.000Z',
          requestId: 'req_01AB',
          message: {
            id: 'msg_01XY',
            role: 'assistant',
            model: 'claude-opus-5',
            content: blocks,
            usage: { input_tokens: 4, output_tokens: 120, cache_read_input_tokens: 90_000 },
          },
        })
      ) as Record<string, unknown>;

    const text = parseTurnUsage(block([{ type: 'text', text: 'on it' }]));
    const call = parseTurnUsage(block([{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }]));

    expect(text?.usageKey).toBe('msg_01XY:req_01AB');
    expect(call?.usageKey).toBe(text?.usageKey);
    // The figures are identical too — which is exactly why summing them is wrong
    // and taking the newest as the context level is not.
    expect(call?.cacheReadTokens).toBe(90_000);
  });

  // Neither id: the entry is the only identity there is, so it must not collide
  // with the next line that also has none — an empty key would fold a whole
  // session's turns into one.
  it('leaves the identity absent when the line carries no id at all', () => {
    expect(parseTurnUsage(withUsage({ output_tokens: 3 }))?.usageKey).toBeUndefined();
    expect(
      parseTurnUsage(withUsage({ output_tokens: 3 }, { requestId: 'req_only' }))?.usageKey
    ).toBe(':req_only');
  });
});

// The head-scan that names a card for a session already running when the Monitor
// opened: its tail cursor starts at EOF, so the title record is behind it.
describe('readSessionTitle', () => {
  const title = (t: string) =>
    JSON.stringify({ type: 'ai-title', aiTitle: t, sessionId: 's' }) + '\n';
  const custom = (t: string) =>
    JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: 's' }) + '\n';

  it('reads the title out of a transcript head', () => {
    writeFileSync(
      file,
      assistant([{ type: 'text', text: 'hi' }]) + title('Sessione di test'),
      'utf-8'
    );
    expect(readSessionTitle(file)).toEqual({ title: 'Sessione di test', source: 'ai' });
  });

  it('takes the last title, since the record is rewritten every turn', () => {
    writeFileSync(file, title('First guess') + assistant([]) + title('What it became'), 'utf-8');
    expect(readSessionTitle(file)).toEqual({ title: 'What it became', source: 'ai' });
  });

  it('reads a custom-title record', () => {
    writeFileSync(file, assistant([]) + custom('Il nome che ho scelto'), 'utf-8');
    expect(readSessionTitle(file)).toEqual({ title: 'Il nome che ho scelto', source: 'custom' });
  });

  // The precedence the rest of the app already uses (`customTitle || aiTitle`):
  // a name the user typed is not overridden by a generated one, whichever of the
  // two was written last.
  it('prefers the user title over a generated one written after it', () => {
    writeFileSync(
      file,
      custom('Il nome che ho scelto') + assistant([]) + title('Auto guess'),
      'utf-8'
    );
    expect(readSessionTitle(file)).toEqual({ title: 'Il nome che ho scelto', source: 'custom' });
  });

  it('returns null when the head holds no title', () => {
    writeFileSync(file, assistant([{ type: 'text', text: 'hi' }]), 'utf-8');
    expect(readSessionTitle(file)).toBeNull();
  });

  it('never parses the fragment a byte cap cuts in half', () => {
    const line = title('Sessione di test');
    writeFileSync(file, line, 'utf-8');
    // Cap inside the record: the only complete line is none of it.
    expect(readSessionTitle(file, line.length - 5)).toBeNull();
    expect(readSessionTitle(file, line.length)).toEqual({
      title: 'Sessione di test',
      source: 'ai',
    });
  });

  it('survives a missing file and an empty one', () => {
    expect(readSessionTitle(join(dir, 'nope.jsonl'))).toBeNull();
    writeFileSync(file, '', 'utf-8');
    expect(readSessionTitle(file)).toBeNull();
  });

  it('skips a corrupt line instead of throwing', () => {
    writeFileSync(file, '{"type":"ai-title" broken\n' + title('Good one'), 'utf-8');
    expect(readSessionTitle(file)).toEqual({ title: 'Good one', source: 'ai' });
  });
});
