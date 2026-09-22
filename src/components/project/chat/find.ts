import { thinkingNote } from './utils';
import type { ChatDetailsFilter, ProcessedMessage } from './utils';

/**
 * Find-in-transcript, the scan half.
 *
 * The reading column is windowed (`@tanstack/react-virtual`), so only the rows
 * around the viewport are in the DOM and the browser's own Ctrl+F sees a
 * fraction of the session. This is the replacement for what virtualization took
 * away, and it reads the DATA, which is all of it.
 *
 * **It answers one boolean per turn, and that is the design, not a shortcut.**
 * Match-level navigation ("hit 4 of 37") would have to reconcile offsets in the
 * raw markdown against offsets in the rendered text — `**bold**`, a link, a
 * backticked span all shift them — and that reconciliation is the only genuinely
 * hard part of a find here. Turn-level needs no offsets at all: the scan says
 * which turns contain the query, `jumpToTurn` walks them, and the paint layer
 * lights every occurrence in whatever rows are mounted. Nothing has to agree
 * with an index. It is also the model this surface already navigates by — the
 * minimap and `activeTurn` both step turn to turn.
 *
 * **Scope is the prose**, which is what the paint layer can reach: `text`
 * blocks, plus `thinking` where the density shows it — a short one (a note,
 * see `thinkingNote`) in both, a long one only in FULL. A tool result would be
 * a hit on a turn with nothing lit in it, and a long thinking block in MIN
 * would be the same: a turn the reader is sent to must have something lit in it.
 */

/** Blocks a turn's prose is made of, under a given density. */
function turnProse(p: ProcessedMessage, density: ChatDetailsFilter): string[] {
  const out: string[] = [];
  for (const block of p.msg.content) {
    if (block.type === 'text') out.push(block.text);
    else if (block.type === 'thinking' && (thinkingNote(block.thinking) || density === 'all'))
      out.push(block.thinking);
  }
  return out;
}

/**
 * The 1-based turn numbers whose prose contains `query`, in reading order.
 *
 * 1-based because that is what a turn number is everywhere else in this view:
 * `jumpToTurn`, the minimap, the export. Case-insensitive and substring —
 * a reader looking for a word does not want to spell it the way the transcript
 * happened to. A blank or whitespace-only query matches nothing rather than
 * everything: "no query" is not "every turn".
 */
export function findMatchingTurns(
  processed: ProcessedMessage[],
  query: string,
  density: ChatDetailsFilter
): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: number[] = [];
  for (let i = 0; i < processed.length; i++) {
    const prose = turnProse(processed[i], density);
    if (prose.some(s => s.toLowerCase().includes(needle))) hits.push(i + 1);
  }
  return hits;
}

/**
 * Step to the next (or previous) hit, wrapping at both ends.
 *
 * Takes the CURRENT turn rather than an index into `hits`, so it stays right
 * when the list changes under it — the reader edits the query, or a watcher
 * appends a turn — and it is what makes "next" mean "next one after where I am
 * reading", not "next one after the last one I pressed". `current` need not be
 * a hit itself: from any turn, forward lands on the first hit after it.
 */
export function stepToHit(
  hits: number[],
  current: number | null,
  direction: 1 | -1
): number | null {
  if (hits.length === 0) return null;
  if (current === null) return direction === 1 ? hits[0] : hits[hits.length - 1];
  if (direction === 1) return hits.find(n => n > current) ?? hits[0];
  const before = hits.filter(n => n < current);
  return before.length > 0 ? before[before.length - 1] : hits[hits.length - 1];
}
