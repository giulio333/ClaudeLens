import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../electron/shared/chat-types';
import {
  COMPACTED_LINE,
  OMITTED_LINE,
  RESULT_CHARS,
  buildSessionDigest,
  digestTranscriptText,
} from '../electron/modules/session-digest';

let n = 0;
function msg(role: 'user' | 'assistant', content: ChatMessage['content']): ChatMessage {
  n += 1;
  return { uuid: `u${n}`, role, timestamp: '2026-01-01T00:00:00Z', content };
}
const text = (t: string) => ({ type: 'text' as const, text: t });

describe('buildSessionDigest', () => {
  it('keeps prompts and answers whole, and labels who spoke', () => {
    const d = buildSessionDigest([
      msg('user', [text('Rename the widget module')]),
      msg('assistant', [text('Renamed it to gadget.')]),
    ]);
    expect(d.text).toBe('### User\nRename the widget module\n\n### Claude\nRenamed it to gadget.');
    expect(d.truncated).toBe(false);
    expect(d.turns).toBe(2);
  });

  it('writes a tool call as one line, naming its target', () => {
    const d = buildSessionDigest([
      msg('assistant', [
        { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/alpha.ts' } },
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'x'.repeat(300) } },
        { type: 'tool_use', id: 't3', name: 'TodoWrite', input: {} },
      ]),
    ]);
    expect(d.text).toContain('[Tool: Edit — src/alpha.ts]');
    expect(d.text).toContain(`[Tool: Bash — ${'x'.repeat(120)}]`);
    expect(d.text).toContain('[Tool: TodoWrite]');
  });

  it('cuts a long tool result and marks an error', () => {
    const d = buildSessionDigest([
      msg('user', [
        { type: 'tool_result', toolUseId: 't1', content: 'y'.repeat(5000), isError: true },
      ]),
    ]);
    expect(d.text).toContain('### Tool output\n[Result (error)]');
    expect(d.text).toContain(`${'y'.repeat(RESULT_CHARS)}… [truncated]`);
    expect(d.text).not.toContain('y'.repeat(RESULT_CHARS + 1));
  });

  it('leaves thinking out and draws an image as a marker', () => {
    const d = buildSessionDigest([
      msg('assistant', [{ type: 'thinking', thinking: 'secret plan' }, text('Done.')]),
      msg('user', [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }]),
    ]);
    expect(d.text).not.toContain('secret plan');
    expect(d.text).toContain('[image]');
    expect(d.text).not.toContain('AAAA');
  });

  it('writes a compaction as its own marker line', () => {
    const d = buildSessionDigest([
      {
        ...msg('user', [text('Context compacted (auto).')]),
        notice: { kind: 'compaction', text: 'Context compacted (auto).' },
      },
    ]);
    expect(d.text).toBe(COMPACTED_LINE);
  });

  it('skips a message with nothing readable', () => {
    const d = buildSessionDigest([msg('assistant', [{ type: 'thinking', thinking: 'hm' }])]);
    expect(d).toEqual({ text: '', estimatedTokens: 0, truncated: false, turns: 0 });
  });

  it('drops the oldest turns to fit the cap, and says so', () => {
    const turns = Array.from({ length: 10 }, (_, i) => msg('user', [text(`${i}`.repeat(400))]));
    const d = buildSessionDigest(turns, 300); // 900 characters: about two turns
    expect(d.truncated).toBe(true);
    expect(d.text.startsWith(`${OMITTED_LINE}\n\n`)).toBe(true);
    expect(d.text).toContain('9'.repeat(400));
    expect(d.text).not.toContain('0'.repeat(400));
    expect(d.estimatedTokens).toBe(Math.ceil(d.text.length / 3));
  });

  it('keeps the tail of a single turn larger than the cap', () => {
    const d = buildSessionDigest([msg('user', [text(`${'a'.repeat(2000)}END`)])], 100);
    expect(d.truncated).toBe(true);
    expect(d.turns).toBe(1);
    expect(d.text.endsWith('END')).toBe(true);
    expect(d.text.length).toBeLessThanOrEqual(OMITTED_LINE.length + 2 + 300);
  });
});

it('reads a transcript through the same parse the Lens uses', () => {
  const rows = [
    {
      type: 'user',
      uuid: 'a1',
      timestamp: '2026-01-01T00:00:00Z',
      message: { role: 'user', content: 'Add a retry to the fetcher' },
    },
    {
      type: 'assistant',
      uuid: 'a2',
      timestamp: '2026-01-01T00:00:01Z',
      message: {
        id: 'm1',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: 'Added one retry.' }],
      },
    },
    { type: 'user', uuid: 'a3', isSidechain: true, message: { role: 'user', content: 'inner' } },
  ];
  const d = digestTranscriptText(rows.map(r => JSON.stringify(r)).join('\n'));
  expect(d.text).toContain('Add a retry to the fetcher');
  expect(d.text).toContain('Added one retry.');
  expect(d.text).not.toContain('inner');
});

it('marks a compaction instead of quoting the summary written for the model', () => {
  const rows = [
    {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'b1',
      timestamp: '2026-01-01T00:00:00Z',
      compactMetadata: { trigger: 'manual', preTokens: 1000 },
    },
    {
      type: 'user',
      uuid: 's1',
      parentUuid: 'b1',
      isCompactSummary: true,
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        role: 'user',
        content: 'This session is being continued from a previous conversation that ran out.',
      },
    },
  ];
  const d = digestTranscriptText(rows.map(r => JSON.stringify(r)).join('\n'));
  expect(d.text).toBe(COMPACTED_LINE);
});
