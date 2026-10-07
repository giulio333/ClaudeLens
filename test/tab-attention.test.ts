// What a tab remembers about its session between two looks at it: the state it
// was last seen in, the change that led there, and whether a turn ended while
// the session was off screen and nobody has looked at it since. It lives above
// the tab strip, which is mounted only by the Mission Control on screen — and
// not at all on the sessions page, exactly when a session finishing out of
// sight matters — so a one-shot animation is gated on a change newer than the
// strip, never on the strip's mount, which every switch of tab repeats.
import { describe, expect, it } from 'vitest';
import {
  LONG_WAIT_MS,
  NO_ATTENTION,
  justAsked,
  justSettled,
  heldTone,
  nextAttention,
  showsUnseen,
  waitingLong,
  type AttentionState,
} from '../src/components/project/terminal/tab-attention';
import type { ChipTone } from '../src/components/project/terminal/terminal-instances';

function step(
  prev: AttentionState,
  tones: Record<string, ChipTone>,
  currentId: string | null
): AttentionState {
  return nextAttention(
    prev,
    Object.entries(tones).map(([id, tone]) => ({ id, tone })),
    currentId
  );
}

describe('nextAttention', () => {
  it('takes the first reading as it is: no change, nothing unseen', () => {
    const a = step(NO_ATTENTION, { t1: 'idle', t2: 'busy' }, 't1');
    expect(a.byId.t1).toEqual({ tone: 'idle', from: null, seq: a.seq, unseen: false });
    expect(a.byId.t2.unseen).toBe(false);
  });

  it('marks a turn that ends off screen, and clears it once the session is on screen', () => {
    let a = step(NO_ATTENTION, { t1: 'idle', t2: 'busy' }, 't1');
    a = step(a, { t1: 'idle', t2: 'idle' }, 't1');
    expect(a.byId.t2).toMatchObject({ tone: 'idle', from: 'busy', unseen: true });
    // Still unseen while the user stays elsewhere.
    a = step(a, { t1: 'busy', t2: 'idle' }, 't1');
    expect(a.byId.t2.unseen).toBe(true);
    a = step(a, { t1: 'busy', t2: 'idle' }, 't2');
    expect(a.byId.t2.unseen).toBe(false);
  });

  it('never marks the session on screen: the user watched it finish', () => {
    let a = step(NO_ATTENTION, { t1: 'busy' }, 't1');
    a = step(a, { t1: 'idle' }, 't1');
    expect(a.byId.t1).toMatchObject({ from: 'busy', unseen: false });
  });

  it('marks every session when none is on screen (the sessions page)', () => {
    let a = step(NO_ATTENTION, { t1: 'busy', t2: 'busy' }, null);
    a = step(a, { t1: 'idle', t2: 'ended' }, null);
    expect(a.byId.t1.unseen).toBe(true);
    expect(a.byId.t2.unseen).toBe(true);
  });

  it('counts a Lens-only session going quiet, and not a turn that stops to ask', () => {
    let a = step(NO_ATTENTION, { t1: 'idle', t2: 'busy', t3: 'busy' }, 't1');
    a = step(a, { t1: 'idle', t2: 'lens', t3: 'waiting' }, 't1');
    expect(a.byId.t2.unseen).toBe(true);
    // Waiting has a mark of its own, the `?`.
    expect(a.byId.t3.unseen).toBe(false);
  });

  it('keeps the mark across a new turn the user has not looked at either', () => {
    let a = step(NO_ATTENTION, { t1: 'idle', t2: 'busy' }, 't1');
    a = step(a, { t1: 'idle', t2: 'idle' }, 't1');
    a = step(a, { t1: 'idle', t2: 'busy' }, 't1');
    expect(a.byId.t2.unseen).toBe(true);
  });

  it('drops the sessions that are gone', () => {
    let a = step(NO_ATTENTION, { t1: 'idle', t2: 'busy' }, 't1');
    a = step(a, { t1: 'idle' }, 't1');
    expect(Object.keys(a.byId)).toEqual(['t1']);
  });

  it('returns the same state when nothing changed, so a render can store it', () => {
    const a = step(NO_ATTENTION, { t1: 'idle', t2: 'busy' }, 't1');
    expect(step(a, { t1: 'idle', t2: 'busy' }, 't1')).toBe(a);
  });
});

describe('heldTone', () => {
  it('keeps the last tone through a reading that missed the registry entry', () => {
    const working = step(NO_ATTENTION, { t1: 'busy' }, null).byId.t1;
    expect(heldTone(working, 'idle', true)).toBe('busy');
    expect(heldTone(working, 'idle', false)).toBe('idle');
    // Nothing to hold on the first reading.
    expect(heldTone(undefined, 'idle', true)).toBe('idle');
  });
});

describe('the one-shot gates', () => {
  it('settles the orb into its dot for a turn that ended after the strip mounted', () => {
    let a = step(NO_ATTENTION, { t1: 'busy' }, 't1');
    const mounted = a.seq;
    a = step(a, { t1: 'idle' }, 't1');
    expect(justSettled(a.byId.t1, mounted)).toBe(true);
    // The strip that mounts after it — a switch of tab — does not replay it.
    expect(justSettled(a.byId.t1, a.seq)).toBe(false);
    // A tab that opens on an idle session has nothing to settle.
    const fresh = step(NO_ATTENTION, { t1: 'idle' }, 't1');
    expect(justSettled(fresh.byId.t1, 0)).toBe(false);
    expect(justSettled(undefined, 0)).toBe(false);
  });

  it('bounces the question mark when a session starts waiting, not when it is found waiting', () => {
    let a = step(NO_ATTENTION, { t1: 'busy' }, 't1');
    const mounted = a.seq;
    a = step(a, { t1: 'waiting' }, 't1');
    expect(justAsked(a.byId.t1, mounted)).toBe(true);
    expect(justAsked(a.byId.t1, a.seq)).toBe(false);
    expect(justAsked(step(NO_ATTENTION, { t1: 'waiting' }, 't1').byId.t1, 0)).toBe(false);
  });

  it('calls a wait long from the registry’s stamp, and never without one', () => {
    const now = 10_000_000;
    expect(waitingLong('waiting', now - LONG_WAIT_MS, now)).toBe(true);
    expect(waitingLong('waiting', now - LONG_WAIT_MS + 1, now)).toBe(false);
    expect(waitingLong('waiting', undefined, now)).toBe(false);
    expect(waitingLong('idle', now - 10 * LONG_WAIT_MS, now)).toBe(false);
  });

  it('draws the unseen mark on a finished session only, and keeps it for after a new turn', () => {
    let a = step(NO_ATTENTION, { t1: 'idle', t2: 'busy' }, 't1');
    a = step(a, { t1: 'idle', t2: 'idle' }, 't1');
    expect(showsUnseen(a.byId.t2, 'idle')).toBe(true);
    a = step(a, { t1: 'idle', t2: 'busy' }, 't1');
    expect(showsUnseen(a.byId.t2, 'busy')).toBe(false);
    a = step(a, { t1: 'idle', t2: 'idle' }, 't1');
    expect(showsUnseen(a.byId.t2, 'idle')).toBe(true);
    expect(showsUnseen(undefined, 'idle')).toBe(false);
  });
});
