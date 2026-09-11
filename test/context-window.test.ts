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

  // The 1M split runs THROUGH each family, so it is a per-model list and not a
  // family rule: Opus 4.7 up is native 1M and 4.6 is not, Sonnet 5 is and every
  // earlier Sonnet is not.
  it.each([
    'claude-sonnet-5',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-fable-5-1',
    'claude-mythos-5-1',
  ])('recognizes %s as native 1M too', model => {
    expect(isOneMillion(model)).toBe(true);
  });

  it.each(['claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'])(
    'keeps %s on the 200k window',
    model => {
      expect(isOneMillion(model)).toBe(false);
    }
  );

  // The reading this fixes: 150k of prompt on a Sonnet 5 session read as 75%
  // full — a compaction warning for a window at 15%.
  it('measures a Sonnet 5 session against 1M below the 200k mark', () => {
    expect(deriveContext([assistant('claude-sonnet-5', 150_000)], 'sonnet')).toMatchObject({
      used: 150_000,
      max: 1_000_000,
      pct: 15,
    });
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
