// How big a model's context window is, and therefore how full a session's is.
//
// Shared because two surfaces answer the same question from different data and
// must not disagree: Mission Control derives it from a transcript it has already
// read into `ChatMessage[]`, and the Monitor's tail derives it from the `usage`
// of the assistant line it just appended — one session at a time versus every
// live session at once. Same rule, one definition. (Same reason
// `version-compare.ts` lives here: the renderer re-exports it rather than
// importing a main-process module.)

export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const LARGE_CONTEXT_WINDOW = 1_000_000;

/** Models that get the large window without being asked for it. */
const ONE_MILLION_DEFAULT_MODELS = [/^claude-opus-5(?:$|-)/i];

/** Whether a resolved model id or raw model setting selects a 1M context window. */
export function isOneMillion(model: string | undefined): boolean {
  if (!model) return false;
  return (
    /\[1m\]|\b1m\b/i.test(model) || ONE_MILLION_DEFAULT_MODELS.some(pattern => pattern.test(model))
  );
}

/**
 * The window a reading of `used` prompt tokens should be measured against.
 *
 * `used` is part of the decision on purpose: the model id is not always
 * conclusive (a `[1m]` suffix is a setting, not something every transcript
 * records), and a prompt that has already passed 200k is proof of a larger
 * window whatever the id says. Erring the other way would print percentages
 * over 100 and call a healthy session full.
 */
export function contextWindowFor(model: string | undefined, used: number): number {
  return isOneMillion(model) || used > DEFAULT_CONTEXT_WINDOW
    ? LARGE_CONTEXT_WINDOW
    : DEFAULT_CONTEXT_WINDOW;
}
