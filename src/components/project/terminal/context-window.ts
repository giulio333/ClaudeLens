import type { ChatMessage } from '../../../types';
import {
  LARGE_CONTEXT_WINDOW,
  contextWindowFor,
  isOneMillion,
} from '../../../../electron/shared/context-window';

// The window-sizing rule itself lives in `electron/shared/` and is re-exported
// here: the Monitor's tail asks the same question of every live session from the
// main process, and two surfaces disagreeing about how full a window is would be
// worse than either being wrong alone. (Same arrangement as `compareVersions`.)
export { isOneMillion };

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
    // The raw setting is consulted on top of the shared rule: this surface knows
    // the configured model, which a transcript line does not always record.
    const max = isOneMillion(rawModel)
      ? LARGE_CONTEXT_WINDOW
      : contextWindowFor(message.model, used);
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
