import { Thought } from './thoughts';

/**
 * The narration line: one sentence Claude wrote for one action, above the
 * control pill.
 *
 * **Where it sits is the whole design.** It is a child of `.cl-pill-wrap` and
 * absolutely positioned above it, which buys three things at once: it inherits
 * every bottom offset the wrap already has (composer, locked composer, the
 * embedded Lens) instead of restating them; it is out of flow, so it cannot
 * stretch the pill it floats over; and it lands inside the padding the reading
 * column already reserves under the transcript, so it covers no turn and moves
 * nothing. Putting it in the transcript instead was never an option — that list
 * is virtualized with per-row measurement and bottom-pinned, and ephemeral rows
 * would fight both.
 *
 * Keyed by the call's id by the caller, so each sentence replays the entrance
 * rather than cross-fading into the next one mid-read. One line with a true
 * ellipsis, never a wrap — a sentence that reflowed to two lines would move the
 * pill under it, and this surface's whole contract is that nothing on the page
 * moves when it speaks. The untruncated sentence stays in the `title`.
 */
export function ThoughtLine({ thought }: { thought: Thought }) {
  return (
    <div
      className="cl-thought"
      title={`${thought.text}\n\n${thought.tool} — Claude's own note for this action`}
    >
      <span className="cl-thought-dot" aria-hidden />
      <span className="cl-thought-text">{thought.text}</span>
      <span className="cl-thought-tool">{thought.tool}</span>
    </div>
  );
}
