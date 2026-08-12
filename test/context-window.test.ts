import { deriveContext, isOneMillion } from '../src/components/project/terminal/context-window';
import type { ChatMessage } from '../src/types';

function assistant(model: string, used: number): ChatMessage {
  return {
    uuid: 'assistant',
    role: 'assistant',
    timestamp: '2026-07-29T00:00:00.000Z',
    model,
    content: [{ type: 'text', text: 'Done' }],
    usage: {
      inputTokens: 2,
      outputTokens: 58,
      cacheReadTokens: 0,
      cacheWriteTokens: used - 2,
    },
  };
}

describe('Mission Control context window', () => {
  it('recognizes Claude Opus 5 as a native 1M-context model', () => {
    expect(isOneMillion('claude-opus-5')).toBe(true);
    expect(isOneMillion('claude-opus-5-20260724')).toBe(true);
  });

  it('calculates the Opus 5 percentage against 1M before usage crosses 200k', () => {
    expect(deriveContext([assistant('claude-opus-5', 49_061)], 'opus')).toEqual({
      used: 49_061,
      max: 1_000_000,
      pct: 5,
      cacheRead: 0,
      freshInput: 2,
      cacheWrite: 49_059,
      model: 'claude-opus-5',
    });
  });

  it('carries the occupancy breakdown the hover card plots', () => {
    const turn: ChatMessage = {
      uuid: 'assistant',
      role: 'assistant',
      timestamp: '2026-07-29T00:00:00.000Z',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'Done' }],
      usage: {
        inputTokens: 4_000,
        outputTokens: 58,
        cacheReadTokens: 90_000,
        cacheWriteTokens: 6_000,
      },
    };
    const ctx = deriveContext([turn], 'sonnet');
    expect(ctx).toMatchObject({ cacheRead: 90_000, freshInput: 4_000, cacheWrite: 6_000 });
    // The parts are a partition of `used` — the card's bars depend on it.
    expect(ctx!.cacheRead + ctx!.freshInput + ctx!.cacheWrite).toBe(ctx!.used);
    // Output tokens leave the window; they must not inflate the reading.
    expect(ctx!.used).toBe(100_000);
  });

  it('preserves explicit 1M markers and the 200k fallback', () => {
    expect(deriveContext([assistant('claude-sonnet-4-5', 50_000)], 'sonnet[1m]')?.max).toBe(
      1_000_000
    );
    expect(deriveContext([assistant('claude-sonnet-4-5', 200_001)], 'sonnet')?.max).toBe(1_000_000);
  });

  it('keeps unmarked models below 200k on the standard context window', () => {
    expect(deriveContext([assistant('claude-haiku-4-5', 50_000)], 'haiku')).toMatchObject({
      used: 50_000,
      max: 200_000,
      pct: 25,
      model: 'claude-haiku-4-5',
    });
  });
});
