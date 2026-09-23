import { describe, expect, it } from 'vitest';
import {
  buildRemoteSnapshot,
  createTranscriptBuffer,
  createWatchReader,
  lastWords,
  parseWatchLine,
  pendingPrompt,
} from '../electron/modules/remote-transcript';

// This machine's half of reading a remote session (#294): the watcher's frames,
// the transcript they rebuild, and what Lens draws from it. The cursor is
// `transcript-tail`'s `readAppend` fed from frames, so its boundary cases are
// the same ones `transcript-tail.test.ts` pins for a local file.

const frame = (offset: number, bytes: Buffer | string) =>
  `@cl data ${offset} ${Buffer.from(bytes).toString('base64')}`;

describe('the watcher protocol', () => {
  it('reads each message it defines', () => {
    expect(parseWatchLine('@cl hello 1')).toEqual({ kind: 'hello' });
    expect(parseWatchLine('@cl session 0b6c1f2e-1111-2222-3333-444444444444')).toEqual({
      kind: 'session',
      sessionId: '0b6c1f2e-1111-2222-3333-444444444444',
    });
    expect(parseWatchLine('@cl status busy')).toEqual({ kind: 'status', status: 'busy' });
    expect(parseWatchLine('@cl ambiguous 2')).toEqual({ kind: 'ambiguous', count: 2 });
    expect(parseWatchLine('@cl cwd /home/dev/my proj')).toEqual({
      kind: 'cwd',
      cwd: '/home/dev/my proj',
    });
    const data = parseWatchLine(frame(12, 'é\n'));
    expect(data).toMatchObject({ kind: 'data', offset: 12 });
    expect(data?.kind === 'data' && data.bytes.toString('utf-8')).toBe('é\n');
  });

  it('refuses what it cannot trust instead of guessing', () => {
    expect(parseWatchLine('hello 1')).toBeNull();
    expect(parseWatchLine('@cl session ../../etc/passwd')).toBeNull();
    expect(parseWatchLine('@cl data -1 AAAA')).toBeNull();
    expect(parseWatchLine('@cl data 0 not*base64')).toBeNull();
    expect(parseWatchLine('@cl ambiguous 1')).toBeNull();
    expect(parseWatchLine('@cl cwd /a\u0007b')).toBeNull();
    expect(parseWatchLine('@cl status $(id)')).toBeNull();
  });
});

describe('the channel reader', () => {
  it('keeps what ssh printed before the script as the preamble, and the prompt it waits on', () => {
    const reader = createWatchReader();
    expect(reader.feed('Warning: Permanently added the host.\r\nuser@host’s password: ')).toEqual(
      []
    );
    expect(reader.started()).toBe(false);
    expect(pendingPrompt(reader.preamble())).toBe('user@host’s password:');
  });

  it('starts at hello, drops the \\r a PTY adds, and ignores noise after it', () => {
    const reader = createWatchReader();
    const out = reader.feed('motd line\r\n@cl hello 1\r\nstray output\r\n@cl tick\r\n');
    expect(out).toEqual([{ kind: 'hello' }, { kind: 'tick' }]);
    expect(reader.started()).toBe(true);
    expect(lastWords(reader.preamble())).toBe('motd line');
  });

  it('holds a frame split across two chunks until its line ends', () => {
    const reader = createWatchReader();
    reader.feed('@cl hello 1\n');
    const line = frame(0, '{"a":1}\n');
    expect(reader.feed(line.slice(0, 20))).toEqual([]);
    const [message] = reader.feed(`${line.slice(20)}\n`);
    expect(message?.kind === 'data' && message.bytes.toString()).toBe('{"a":1}\n');
  });

  it('names the last thing ssh said when it gave up', () => {
    const reader = createWatchReader();
    reader.feed('user@host: Permission denied (publickey,password).\r\n');
    expect(lastWords(reader.preamble())).toBe('user@host: Permission denied (publickey,password).');
    expect(pendingPrompt(reader.preamble())).toBeNull();
  });
});

describe('the transcript buffer', () => {
  it('keeps the trailing partial line until its newline arrives', () => {
    const buf = createTranscriptBuffer();
    expect(buf.append(0, Buffer.from('{"a":1}\n{"b":'))).toBe('appended');
    expect(buf.text()).toBe('{"a":1}');
    buf.append(13, Buffer.from('2}\n'));
    expect(buf.text()).toBe('{"a":1}\n{"b":2}');
    expect(buf.received()).toBe(16);
  });

  it('decodes a multi-byte character split across two frames', () => {
    const bytes = Buffer.from('{"t":"é"}\n');
    const cut = bytes.indexOf(0xa9); // inside the two bytes of é
    const buf = createTranscriptBuffer();
    buf.append(0, bytes.subarray(0, cut));
    buf.append(cut, bytes.subarray(cut));
    expect(buf.text()).toBe('{"t":"é"}');
  });

  it('answers gap when a frame does not start where the last one ended', () => {
    const buf = createTranscriptBuffer();
    buf.append(0, Buffer.from('{"a":1}\n'));
    expect(buf.append(20, Buffer.from('{"b":2}\n'))).toBe('gap');
    expect(buf.text()).toBe('{"a":1}');
  });

  it('starts over when the file is read again from zero', () => {
    const buf = createTranscriptBuffer();
    buf.append(0, Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(buf.append(0, Buffer.from('{"c":3}\n'))).toBe('reset');
    expect(buf.text()).toBe('{"c":3}');
    expect(buf.lineCount()).toBe(1);
  });

  it('drops an unterminated oversized line, and the rest of it, instead of buffering it', () => {
    const buf = createTranscriptBuffer(16);
    buf.append(0, Buffer.from('{"a":1}\n' + 'x'.repeat(20)));
    expect(buf.dropped()).toBe(1);
    // The same long line goes on in the next frame: none of it is a record.
    buf.append(28, Buffer.from('yyyy\n{"b":2}\n'));
    expect(buf.text()).toBe('{"a":1}\n{"b":2}');
  });
});

describe('the snapshot', () => {
  const at = (s: number) => `2026-09-23T10:00:${String(s).padStart(2, '0')}.000Z`;
  const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0 };
  const lines = [
    { type: 'ai-title', aiTitle: 'Generated name', sessionId: 's' },
    {
      type: 'user',
      uuid: 'u1',
      timestamp: at(1),
      message: { role: 'user', content: 'Fix the flaky test' },
    },
    // One turn written as two lines, each repeating the message-level usage.
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: at(2),
      requestId: 'r1',
      message: {
        id: 'm1',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'On it.' }],
        usage,
      },
    },
    {
      type: 'assistant',
      uuid: 'a2',
      timestamp: at(3),
      requestId: 'r1',
      message: {
        id: 'm1',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }],
        usage,
      },
    },
    { type: 'agent-name', agentName: 'Flaky hunt' },
  ];
  const text = lines.map(l => JSON.stringify(l)).join('\n');

  it('parses the messages the local reader would, and bills a repeated turn once', () => {
    const { messages, summary } = buildRemoteSnapshot(text, 'sess-1');
    expect(messages.map(m => m.uuid)).toEqual(['u1', 'a1', 'a2']);
    expect(summary.filename).toBe('sess-1.jsonl');
    expect(summary.inputTokens).toBe(1000);
    expect(summary.outputTokens).toBe(200);
    expect(summary.estimatedCost).toBeGreaterThan(0);
    expect(summary.models).toEqual({ 'claude-sonnet-5': 1 });
    expect(summary.firstUserMessage).toBe('Fix the flaky test');
  });

  it('carries every title record, leaving which one wins to the renderer', () => {
    const { summary } = buildRemoteSnapshot(text, 'sess-1');
    expect(summary.aiTitle).toBe('Generated name');
    expect(summary.agentName).toBe('Flaky hunt');
  });

  it('skips a line it cannot parse rather than failing the transcript', () => {
    const { messages } = buildRemoteSnapshot(`${text}\n{"type":"assistant","usage"`, 'sess-1');
    expect(messages).toHaveLength(3);
  });
});
