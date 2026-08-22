import type { TraceMark } from '../../../types';

// The Monitor's ribbon: the last two and a half minutes of a session, drawn as
// runs of tinted blocks on a shared time axis.
//
// It replaces the three-row textual tape that stood here (design handoff
// *Monitor Variants*, option 2b). The trade is explicit: the tape said what a
// session did in words and cost the cell four fixed rows, which is what made a
// card 260px tall and forced the rack into 340px columns. 2b spends that height
// on a full-bleed band for the one session that is blocked and gives everything
// else a hairline grid three columns wide — so the history had to compress into
// a lane. What survives the compression is the shape of the work and its
// rhythm, tinted by tool; what a session is doing RIGHT NOW is still in words,
// in the cell's NOW line, which is the claim the strip could never make on its
// own.
//
// The rhythm is read off real timestamps, not off a rasterised string: the
// window is cut into equal cells, each mark falls in the cell its `at` lands in,
// and contiguous cells of one tool collapse into a single block. A retry loop is
// then one long block, a session hammering three different tools is three short
// ones, and a session that has done nothing for a minute is a lane with a
// minute of nothing at its right-hand end — which is the whole question the lane
// exists to answer.
//
// Pure and separate from the view for two reasons: the repo's fast-refresh rule
// (a component file exports only components), and because this is the part worth
// pinning down in tests — where a mark lands, what counts as one block, and what
// falls outside the window.

/** How far back the ribbon reaches. The digest keeps a wider window than this
 *  (`TRACE_WINDOW_MS`), so the cap is what a cell can show, not what is known. */
export const RIBBON_SPAN_MS = 150_000;

/** The window's grain. 48 cells over 150s is roughly three seconds each: fine
 *  enough that two calls a few seconds apart stay two blocks, coarse enough that
 *  a burst reads as one stretch of work rather than a picket fence. */
export const RIBBON_CELLS = 48;

/** The window, in the words the tooltip says it in. Spelled with its half
 *  minute rather than rounded: the figure this lane is read against is how long
 *  its empty right-hand end has been empty, and rounding 150s up to "3 min"
 *  overstates that by a fifth. */
export const RIBBON_WINDOW = `${Number((RIBBON_SPAN_MS / 60_000).toFixed(1))} min`;

/** Percent of the window left blank between two blocks, so runs of two
 *  different tools never fuse into one bar. */
const BLOCK_GAP = 0.35;

/** Percent a single-cell block is never allowed to fall below: at this grain one
 *  call is ~2% of the lane, and a block thinner than a hairline is not a mark,
 *  it is a rendering artefact. */
const BLOCK_MIN = 0.9;

export interface RibbonRun {
  tool: string;
  /** Left edge, as a percentage of the window. */
  left: number;
  /** Width, as a percentage of the window. */
  width: number;
  /** At least one call in this run came back an error. A verdict on the run, so
   *  it takes the danger hue instead of the tool's — the tint answers "what kind
   *  of work", and a failure outranks that. */
  failed: boolean;
}

/**
 * The last actions of a session, oldest to newest, as blocks on the window.
 *
 * Marks outside the window are dropped rather than clamped — including ones
 * stamped in the future, which clock skew between the CLI and this process can
 * produce. Prose marks are dropped too: they have no tool, so they have no
 * tint, and a grey block between two edits would read as a tool nobody can name.
 */
export function buildRibbon(marks: TraceMark[], now: number): RibbonRun[] {
  const start = now - RIBBON_SPAN_MS;
  const step = RIBBON_SPAN_MS / RIBBON_CELLS;
  const cells: ({ tool: string; failed: boolean } | null)[] = Array.from(
    { length: RIBBON_CELLS },
    () => null
  );

  for (const mark of marks) {
    if (mark.kind !== 'tool') continue;
    if (mark.at < start || mark.at > now) continue;
    const index = Math.min(RIBBON_CELLS - 1, Math.floor((mark.at - start) / step));
    const cell = cells[index];
    if (cell) {
      // Two tools in one cell: the first keeps the tint (the lane is read left
      // to right, so the earlier call is what that position means) and the
      // failure is carried either way — it is the fact worth not losing.
      cell.failed = cell.failed || !!mark.failed;
      continue;
    }
    cells[index] = { tool: mark.tool ?? 'unknown', failed: !!mark.failed };
  }

  const runs: RibbonRun[] = [];
  let i = 0;
  while (i < RIBBON_CELLS) {
    const cell = cells[i];
    if (!cell) {
      i += 1;
      continue;
    }
    let j = i;
    let failed = false;
    while (j < RIBBON_CELLS && cells[j]?.tool === cell.tool) {
      failed = failed || !!cells[j]?.failed;
      j += 1;
    }
    runs.push({
      tool: cell.tool,
      left: (i / RIBBON_CELLS) * 100,
      width: Math.max(BLOCK_MIN, ((j - i) / RIBBON_CELLS) * 100 - BLOCK_GAP),
      failed,
    });
    i = j;
  }
  return runs;
}
