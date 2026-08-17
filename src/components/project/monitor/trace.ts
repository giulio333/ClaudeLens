import type { TraceMark } from '../../../types';

// The pulse strip's model: a session's recent transcript marks bucketed into the
// bars the Monitor draws.
//
// Pure and separate from the view for two reasons — the repo's fast-refresh rule
// (a component file exports only components), and because this is the part worth
// pinning down in tests: which bucket a mark lands in, and where the silence
// after the last one begins, is what the whole page is read for.

/** The strip's span. 90s is about two tool calls of headroom: long enough that a
 *  hang is visible, short enough that the strip is about NOW and not history. */
export const TRACE_SPAN_MS = 90_000;
export const TRACE_BUCKETS = 42;
/** Tool calls in one bucket that fill a bar to the top. */
const TRACE_PEAK = 3;
/** An answer or a thought weighs less than a tool call: a session writing prose
 *  is working, but it should not draw like one hammering the filesystem. */
const TRACE_TEXT_WEIGHT = 0.2;

export interface TraceBar {
  /** 0–1 of the bar's full height. */
  h: number;
  failed: boolean;
  /** No marks landed in this bucket. */
  quiet: boolean;
}

/** Bucket a trace into the strip's bars, oldest to newest. Marks outside the
 *  window are dropped rather than clamped into the edge bucket — including ones
 *  stamped in the future, which clock skew between the CLI and this process can
 *  produce and which would otherwise pile onto "now". */
export function buildTrace(marks: TraceMark[], now: number): TraceBar[] {
  const width = TRACE_SPAN_MS / TRACE_BUCKETS;
  const bars: TraceBar[] = Array.from({ length: TRACE_BUCKETS }, () => ({
    h: 0,
    failed: false,
    quiet: true,
  }));
  const start = now - TRACE_SPAN_MS;

  for (const mark of marks) {
    if (mark.at < start || mark.at > now) continue;
    const i = Math.min(TRACE_BUCKETS - 1, Math.floor((mark.at - start) / width));
    const bar = bars[i];
    bar.quiet = false;
    bar.h = Math.min(1, bar.h + (mark.kind === 'text' ? TRACE_TEXT_WEIGHT : 1 / TRACE_PEAK));
    if (mark.kind === 'error') bar.failed = true;
  }
  return bars;
}

/** Index of the last bucket that carries something, or -1. Everything after it
 *  is the current silence — the run a blocked card paints in the accent. */
export function lastLoudBucket(bars: TraceBar[]): number {
  return bars.reduce((last, bar, i) => (bar.quiet ? last : i), -1);
}
