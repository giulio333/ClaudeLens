import type { ChatMessage } from '../../../types';

export type ContextState = {
  used: number;
  max: number;
  pct: number;
  /** What the occupancy is made of, read off the same turn: tokens replayed
   *  from the prompt cache, tokens sent fresh, tokens written to the cache.
   *  They sum to `used` — the vitals hover card plots them as a part-of-whole,
   *  which is the only place the % says *why* it is what it is. */
  cacheRead: number;
  freshInput: number;
  cacheWrite: number;
  /** The model of the turn the reading came from — it is what sizes the
   *  window (200k vs 1M), so the card names it next to the total. */
  model?: string;
};

const ONE_MILLION_DEFAULT_MODELS = [/^claude-opus-5(?:$|-)/i];

/** Whether a resolved model id or raw model setting selects a 1M context window. */
export function isOneMillion(model: string | undefined): boolean {
  if (!model) return false;
  return (
    /\[1m\]|\b1m\b/i.test(model) || ONE_MILLION_DEFAULT_MODELS.some(pattern => pattern.test(model))
  );
}

/** CONTEXT occupancy from the latest assistant turn's prompt usage. */
export function deriveContext(
  messages: ChatMessage[] | undefined,
  rawModel: string | undefined
): ContextState | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.usage) continue;
    const used =
      message.usage.inputTokens + message.usage.cacheReadTokens + message.usage.cacheWriteTokens;
    const oneMillion = isOneMillion(message.model) || isOneMillion(rawModel) || used > 200_000;
    const max = oneMillion ? 1_000_000 : 200_000;
    return {
      used,
      max,
      pct: Math.min(100, Math.round((used / max) * 100)),
      cacheRead: message.usage.cacheReadTokens,
      freshInput: message.usage.inputTokens,
      cacheWrite: message.usage.cacheWriteTokens,
      model: message.model,
    };
  }
  return null;
}
