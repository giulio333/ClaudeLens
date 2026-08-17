import type { TraceMark } from '../../../types';

// The Monitor's tape: the last things a session actually did, newest first.
//
// It has been a histogram (42 anonymous buckets, height by count) and then a
// track of tinted ticks. Both answered "at what rhythm" and nothing else, and a
// rhythm on its own is a heartbeat — it says the session is alive without ever
// saying what it is doing. The marks carry the tool and its subject now, so the
// same seconds can be read as prose: `Edit MonitorView.tsx`, `Bash npm run
// typecheck ✕`. The rhythm survives in the age of each row: a tape whose top row
// says `4m` is a session that has done nothing for four minutes, which is the
// question the strip existed to answer, asked in words.
//
// Pure and separate from the view for two reasons: the repo's fast-refresh rule
// (a component file exports only components), and because this is the part worth
// pinning down in tests — what counts as one step, and which end of the history
// survives the cap.

/** How far back the tape reaches. The digest keeps a wider window than this
 *  (`TRACE_WINDOW_MS`), so the cap is what a card can show, not what is known. */
export const TAPE_SPAN_MS = 150_000;

/** Rows a card prints. Six is about what fits under the identity block without
 *  the card growing taller than its neighbours in the grid, and the newest are
 *  the ones kept: what a session just did explains it better than what it
 *  started with. */
export const TAPE_MAX = 6;

export interface TapeStep {
  /** Epoch ms of the (first) call. */
  at: number;
  tool: string;
  /** The one-line subject, or '' for a tool that takes nothing worth printing. */
  arg: string;
  /** Its result came back an error. */
  failed: boolean;
  /** Consecutive identical calls collapsed into this row — a retry loop reads as
   *  `Bash npm test ×3`, which is the truth about it, instead of three rows that
   *  look like three different pieces of work. */
  count: number;
}

/**
 * The last actions of a session, newest first.
 *
 * `dropNewest` is set when the card is already printing the in-flight call as
 * its "now" row: the newest mark IS that call, and a tape that repeats it above
 * its own history reads as if the session had done the same thing twice.
 *
 * Marks outside the window are dropped rather than clamped — including ones
 * stamped in the future, which clock skew between the CLI and this process can
 * produce.
 */
export function buildTape(
  marks: TraceMark[],
  now: number,
  options: { dropNewest?: boolean; max?: number } = {}
): TapeStep[] {
  const { dropNewest = false, max = TAPE_MAX } = options;
  const start = now - TAPE_SPAN_MS;

  // Prose marks the trace but is not a step of the story: "wrote some text"
  // between two edits would break the sequence in half without adding anything a
  // reader could act on.
  const tools = marks
    .filter(m => m.kind === 'tool' && m.at >= start && m.at <= now)
    .sort((a, b) => b.at - a.at);

  const steps: TapeStep[] = [];
  for (const mark of tools.slice(dropNewest ? 1 : 0)) {
    const previous = steps[steps.length - 1];
    const tool = mark.tool ?? 'unknown';
    const arg = mark.arg ?? '';
    // Collapse only an EXACT repeat (same tool, same subject): two edits of two
    // different files are two pieces of work, two runs of the same command are
    // one thing happening twice.
    if (previous && previous.tool === tool && previous.arg === arg) {
      previous.count += 1;
      previous.failed = previous.failed || !!mark.failed;
      // The row is dated by its oldest call: it says when this started.
      previous.at = mark.at;
      continue;
    }
    if (steps.length === max) break;
    steps.push({ at: mark.at, tool, arg, failed: !!mark.failed, count: 1 });
  }
  return steps;
}
