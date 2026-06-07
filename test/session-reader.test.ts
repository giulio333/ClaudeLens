import { readChatSession, findSessionFile } from '../electron/modules/session-reader';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let dir: string;

function writeJsonl(name: string, lines: string[]): string {
  const p = join(dir, name);
  writeFileSync(p, lines.join('\n'), 'utf-8');
  return p;
}

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cl-sess-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readChatSession', () => {
  it('returns [] for a non-existent file', () => {
    expect(readChatSession(join(dir, 'nope.jsonl'))).toEqual([]);
  });

  it('strips only known framing tags, preserving code/generics (#93)', () => {
    const p = writeJsonl('s.jsonl', [
      line({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-01-01T00:00:00Z',
        message: {
          role: 'user',
          content:
            '<system-reminder></system-reminder>if (a < b && c > d) return List<String>;',
        },
      }),
    ]);
    const msgs = readChatSession(p);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].uuid).toBe('u1');
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].timestamp).toBe('2026-01-01T00:00:00Z');
    // Known framing tags removed; code generics like List<String> survive.
    expect(msgs[0].content).toEqual([
      { type: 'text', text: 'if (a < b && c > d) return List<String>;' },
    ]);
  });

  it('preserves command-name string content without stripping tags', () => {
    const raw = '<command-name>/clear</command-name>';
    const p = writeJsonl('s.jsonl', [
      line({
        type: 'user',
        uuid: 'c1',
        timestamp: 't',
        message: { role: 'user', content: raw },
      }),
    ]);
    const msgs = readChatSession(p);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toEqual([{ type: 'text', text: raw }]);
  });

  it('skips a string user message that is only tags (empty after strip)', () => {
    const p = writeJsonl('s.jsonl', [
      line({
        type: 'user',
        uuid: 'empty',
        timestamp: 't',
        message: {
          role: 'user',
          content: '<system-reminder></system-reminder>',
        },
      }),
    ]);
    // content "<system-reminder></system-reminder>" -> stripped -> "" -> skipped
    expect(readChatSession(p)).toEqual([]);
  });

  it('parses assistant message with block array content (text, thinking, tool_use)', () => {
    const p = writeJsonl('s.jsonl', [
      line({
        type: 'assistant',
        uuid: 'a1',
        timestamp: 't',
        message: {
          role: 'assistant',
          model: 'claude-opus-4',
          content: [
            { type: 'thinking', thinking: 'pondering' },
            { type: 'text', text: 'The answer' },
            { type: 'text', text: '   ' }, // blank -> dropped
            { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { cmd: 'ls' } },
          ],
        },
      }),
    ]);
    const msgs = readChatSession(p);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].model).toBe('claude-opus-4');
    expect(msgs[0].content).toEqual([
      { type: 'thinking', thinking: 'pondering' },
      { type: 'text', text: 'The answer' },
      { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { cmd: 'ls' } },
    ]);
  });

  it('normalizes tool_result blocks (tool_use_id -> toolUseId, array content joined)', () => {
    const p = writeJsonl('s.jsonl', [
      line({
        type: 'user',
        uuid: 'r1',
        timestamp: 't',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'plain string', is_error: false },
            {
              type: 'tool_result',
              tool_use_id: 'tu_2',
              content: [{ text: 'a' }, { text: 'b' }],
              is_error: true,
            },
          ],
        },
      }),
    ]);
    const msgs = readChatSession(p);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toEqual([
      { type: 'tool_result', toolUseId: 'tu_1', content: 'plain string', isError: false },
      { type: 'tool_result', toolUseId: 'tu_2', content: 'a\nb', isError: true },
    ]);
  });

  it('handles tool_result array content with string and null elements (no message drop)', () => {
    // Nel formato Anthropic content può essere `["text"]` o contenere `null`:
    // senza guardia sul tipo l'intero messaggio veniva scartato (TypeError).
    const p = writeJsonl('s.jsonl', [
      line({
        type: 'user',
        uuid: 'r1',
        timestamp: 't',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: ['plain', null, { text: 'block' }], is_error: false },
          ],
        },
      }),
    ]);
    const msgs = readChatSession(p);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toEqual([
      { type: 'tool_result', toolUseId: 'tu_1', content: 'plain\n\nblock', isError: false },
    ]);
  });

  it('skips meta and sidechain lines', () => {
    const p = writeJsonl('s.jsonl', [
      line({
        type: 'user',
        uuid: 'meta',
        timestamp: 't',
        isMeta: true,
        message: { role: 'user', content: 'meta msg' },
      }),
      line({
        type: 'assistant',
        uuid: 'side',
        timestamp: 't',
        isSidechain: true,
        message: { role: 'assistant', content: [{ type: 'text', text: 'subagent' }] },
      }),
      line({
        type: 'user',
        uuid: 'keep',
        timestamp: 't',
        message: { role: 'user', content: 'real message' },
      }),
    ]);
    const msgs = readChatSession(p);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].uuid).toBe('keep');
  });

  it('skips non-chat line types (summary, system) and lines without a message', () => {
    const p = writeJsonl('s.jsonl', [
      line({ type: 'summary', summary: 'recap', leafUuid: 'x' }),
      line({ type: 'system', content: 'sys' }),
      line({ type: 'user', uuid: 'nomsg', timestamp: 't' }), // no message field
      line({
        type: 'assistant',
        uuid: 'ok',
        timestamp: 't',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      }),
    ]);
    const msgs = readChatSession(p);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].uuid).toBe('ok');
  });

  it('handles malformed and blank JSONL lines gracefully (no throw)', () => {
    const p = writeJsonl('s.jsonl', [
      '',
      '   ',
      'not json at all',
      '{ broken json',
      line({
        type: 'user',
        uuid: 'good',
        timestamp: 't',
        message: { role: 'user', content: 'survived' },
      }),
      '',
    ]);
    let msgs: ReturnType<typeof readChatSession> = [];
    expect(() => {
      msgs = readChatSession(p);
    }).not.toThrow();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].uuid).toBe('good');
  });

  it('drops messages whose blocks end up empty', () => {
    const p = writeJsonl('s.jsonl', [
      line({
        type: 'assistant',
        uuid: 'empty',
        timestamp: 't',
        message: { role: 'assistant', content: [{ type: 'text', text: '   ' }] },
      }),
    ]);
    expect(readChatSession(p)).toEqual([]);
  });
});

describe('findSessionFile', () => {
  it('returns the path inside the sessions/ subdir when present', async () => {
    const sessions = join(dir, 'sessions');
    mkdirSync(sessions);
    const target = join(sessions, 'abc.jsonl');
    writeFileSync(target, '');
    expect(await findSessionFile(dir, 'abc.jsonl')).toBe(target);
  });

  it('returns the path in the project root when not in sessions/', async () => {
    const target = join(dir, 'root.jsonl');
    writeFileSync(target, '');
    expect(await findSessionFile(dir, 'root.jsonl')).toBe(target);
  });

  it('falls back to recursive glob for nested files', async () => {
    const nested = join(dir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    const target = join(nested, 'deep.jsonl');
    writeFileSync(target, '');
    expect(await findSessionFile(dir, 'deep.jsonl')).toBe(target);
  });

  it('returns null when no matching file exists', async () => {
    expect(await findSessionFile(dir, 'missing.jsonl')).toBeNull();
  });
});
