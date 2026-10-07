// What a tab remembers about its session between two looks at it.
//
// The strip is mounted only by the Mission Control on screen, and remounts on
// every switch — on the sessions page it is not mounted at all, which is exactly
// when a session finishing out of sight matters. So this is tracked above it
// (`TabAttentionProvider`), and a one-shot animation plays only for a change
// newer than the strip showing it (`seq`), never because the strip remounted.

import type { ChipTone } from './terminal-instances';

export interface TabAttention {
  tone: ChipTone;
  /** The tone before the last change; null on the first reading, which is not
   *  a change anyone saw happen. */
  from: ChipTone | null;
  /** The change's place in the order changes were seen (`AttentionState.seq`). */
  seq: number;
  /** A turn ended while the session was off screen, and it has not been on
   *  screen since. */
  unseen: boolean;
}

export interface AttentionState {
  /** Bumped on every change seen: a strip compares a change with the value it
   *  mounted at, so a switch of tab never replays an animation. A counter and
   *  not a clock, because the reading happens during render. */
  seq: number;
  byId: Readonly<Record<string, TabAttention>>;
}

export const NO_ATTENTION: AttentionState = { seq: 0, byId: {} };

/** A wait this long darkens the tab: the `?` alone is easy to keep missing. */
export const LONG_WAIT_MS = 120_000;

// A turn that stops to ask is not "finished": it wears the `?` instead.
const FINISHED: ReadonlySet<ChipTone> = new Set(['idle', 'lens', 'ended']);

function nextEntry(
  prev: TabAttention | undefined,
  tone: ChipTone,
  onScreen: boolean,
  seq: number
): TabAttention {
  if (!prev) return { tone, from: null, seq, unseen: false };
  if (prev.tone === tone) {
    return onScreen && prev.unseen ? { ...prev, unseen: false } : prev;
  }
  const finished = prev.tone === 'busy' && FINISHED.has(tone);
  return { tone, from: prev.tone, seq, unseen: !onScreen && (prev.unseen || finished) };
}

/** The state after one reading of every open session. Pure, and the same
 *  object when nothing changed, so a render can store it without looping. */
export function nextAttention(
  prev: AttentionState,
  readings: readonly { id: string; tone: ChipTone }[],
  currentId: string | null
): AttentionState {
  const seq = prev.seq + 1;
  let changed = Object.keys(prev.byId).length !== readings.length;
  const byId: Record<string, TabAttention> = {};
  for (const { id, tone } of readings) {
    const entry = nextEntry(prev.byId[id], tone, id === currentId, seq);
    if (entry !== prev.byId[id]) changed = true;
    byId[id] = entry;
  }
  return changed ? { seq, byId } : prev;
}

/** The tone to record for a session whose terminal is running but has no
 *  registry entry in this reading. The registry reader skips a file it catches
 *  mid-write, so a working session can vanish from one reading: read as idle,
 *  that blip would mark a finished turn that never happened. Absent is not
 *  idle — the last tone stands until the entry is back. A real exit ends the
 *  terminal, and reads as ended. */
export function heldTone(
  prev: TabAttention | undefined,
  tone: ChipTone,
  registryMissed: boolean
): ChipTone {
  return registryMissed && prev ? prev.tone : tone;
}

/** The orb collapsing into the dot: a turn that ended since `mountedSeq`. */
export function justSettled(a: TabAttention | undefined, mountedSeq: number): boolean {
  return !!a && a.from === 'busy' && FINISHED.has(a.tone) && a.seq > mountedSeq;
}

/** The `?` arriving: a session seen to start waiting since `mountedSeq`. */
export function justAsked(a: TabAttention | undefined, mountedSeq: number): boolean {
  return (
    !!a && a.tone === 'waiting' && a.from !== null && a.from !== 'waiting' && a.seq > mountedSeq
  );
}

/** The "not seen yet" mark is drawn on a finished session only: while a new
 *  turn runs the orb says more, and the mark comes back when it ends. */
export function showsUnseen(a: TabAttention | undefined, tone: ChipTone): boolean {
  return !!a?.unseen && FINISHED.has(tone);
}

/** Waiting for long enough to insist, from the registry's own stamp of the
 *  transition. Without one nothing says how long, so nothing insists. */
export function waitingLong(
  tone: ChipTone,
  waitingSince: number | undefined,
  now: number
): boolean {
  return tone === 'waiting' && waitingSince !== undefined && now - waitingSince >= LONG_WAIT_MS;
}
