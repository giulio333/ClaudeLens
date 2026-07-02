import {
  noteMessage,
  compactBoundaryNote,
  summarizeResult,
  isPromptEcho,
  isSubagentTraffic,
} from '../electron/modules/chat-stream';
import type { ChatMessage } from '../electron/shared/chat-types';

function userMessage(content: ChatMessage['content']): ChatMessage {
  return { uuid: 'u1', role: 'user', timestamp: '2026-01-01T00:00:00Z', content };
}

describe('noteMessage', () => {
  it('builds a synthetic assistant note with a single text block', () => {
    const note = noteMessage('Context compacted.');
    expect(note.role).toBe('assistant');
    expect(note.model).toBe('<synthetic>');
    expect(note.content).toEqual([{ type: 'text', text: 'Context compacted.' }]);
    expect(note.uuid).toBeTruthy();
    expect(Date.parse(note.timestamp)).not.toBeNaN();
  });

  it('mints a fresh uuid per note (notes must not dedupe against each other)', () => {
    expect(noteMessage('a').uuid).not.toBe(noteMessage('a').uuid);
  });
});

describe('compactBoundaryNote', () => {
  it('includes token count and trigger when present', () => {
    expect(compactBoundaryNote(153000, 'auto')).toBe(
      `Context compacted — was ~${(153000).toLocaleString()} tokens (auto).`
    );
  });

  it('degrades to the bare note when metadata is missing', () => {
    expect(compactBoundaryNote()).toBe('Context compacted.');
    expect(compactBoundaryNote(undefined, 'manual')).toBe('Context compacted (manual).');
    expect(compactBoundaryNote(1000)).toBe(
      `Context compacted — was ~${(1000).toLocaleString()} tokens.`
    );
  });
});

describe('summarizeResult', () => {
  it('maps a full SDK result message', () => {
    expect(
      summarizeResult({
        total_cost_usd: 0.42,
        num_turns: 3,
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_read_input_tokens: 300,
          cache_creation_input_tokens: 400,
        },
        modelUsage: { 'claude-sonnet-4-6': {}, 'claude-haiku-4-5': {} },
      })
    ).toEqual({
      totalCostUsd: 0.42,
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheWriteTokens: 400,
      numTurns: 3,
      models: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
    });
  });

  it('degrades missing or malformed fields to 0 / [] instead of throwing', () => {
    const zero = {
      totalCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      numTurns: 0,
      models: [],
    };
    expect(summarizeResult({})).toEqual(zero);
    expect(summarizeResult(null)).toEqual(zero);
    expect(summarizeResult(undefined)).toEqual(zero);
    // A field with the wrong runtime type must not leak through.
    expect(summarizeResult({ total_cost_usd: '0.42', usage: { input_tokens: '9' } })).toEqual(zero);
  });
});

describe('isPromptEcho', () => {
  it('flags a plain-text user message (the echoed prompt)', () => {
    expect(isPromptEcho(userMessage([{ type: 'text', text: 'hello' }]))).toBe(true);
  });

  it('keeps a tool_result-bearing user message', () => {
    expect(
      isPromptEcho(
        userMessage([{ type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false }])
      )
    ).toBe(false);
  });

  it('never flags assistant messages', () => {
    expect(
      isPromptEcho({
        uuid: 'a1',
        role: 'assistant',
        timestamp: '2026-01-01T00:00:00Z',
        content: [{ type: 'text', text: 'hi' }],
      })
    ).toBe(false);
  });
});

describe('isSubagentTraffic', () => {
  it('flags messages carrying a parent_tool_use_id', () => {
    expect(isSubagentTraffic({ type: 'assistant', parent_tool_use_id: 'toolu_1' })).toBe(true);
  });

  it('keeps main-conversation messages (null or absent parent)', () => {
    expect(isSubagentTraffic({ type: 'assistant', parent_tool_use_id: null })).toBe(false);
    expect(isSubagentTraffic({ type: 'assistant' })).toBe(false);
  });
});
