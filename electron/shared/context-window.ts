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

/**
 * Models whose window is 1M natively — no `[1m]` suffix, no beta opt-in.
 *
 * Taken from Claude Code's own baked-in model catalog (`native_1m: true`), the
 * only list that decides this for the sessions we read. It is a per-model fact,
 * not a per-family one, and the split runs THROUGH the families: Opus 4.7 and
 * later are native 1M while Opus 4.6 and 4.5 are 200k, Sonnet 5 is native 1M
 * while every earlier Sonnet is 200k, and Haiku 4.5 is 200k. Listing only Opus
 * 5 here sized a Sonnet 5 session's window at a fifth of what it is, so a
 * 150k-token prompt read as 75% full instead of 15% — on the two surfaces
 * (Monitor and Mission Control) whose whole job is to say when a compaction is
 * coming.
 */
const ONE_MILLION_DEFAULT_MODELS = [
  /^claude-opus-(?:4-7|4-8|5)(?:$|-)/i,
  /^claude-sonnet-5(?:$|-)/i,
  // Fable/Mythos: every released model of both families is native 1M, 5 and 5.1
  // alike (the trailing `-` covers `claude-fable-5-1`).
  /^claude-(?:fable|mythos)-5(?:$|-)/i,
];

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
