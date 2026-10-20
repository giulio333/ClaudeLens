// The edge of the work stage: a line while Claude works, a ring while it waits,
// and a sweep for a turn that ended — once, and only for a change newer than
// the one the stage last swept for (or mounted at).
import { expect, it } from 'vitest';
import { paneEdgeSignal } from '../src/components/project/terminal/pane-edge';
import type { TabAttention } from '../src/components/project/terminal/tab-attention';

const seen = (patch: Partial<TabAttention>): TabAttention => ({
  tone: 'idle',
  from: null,
  seq: 1,
  unseen: false,
  ...patch,
});

it('draws nothing for a session it knows nothing about', () => {
  expect(paneEdgeSignal(undefined, 0)).toBeNull();
});

it('runs a line while Claude works and rings while it waits, whatever was played', () => {
  expect(paneEdgeSignal(seen({ tone: 'busy', from: 'idle', seq: 4 }), 9)).toBe('working');
  expect(paneEdgeSignal(seen({ tone: 'waiting', from: 'busy', seq: 4 }), 9)).toBe('waiting');
});

it('sweeps for a turn that ended after the stage last swept', () => {
  expect(paneEdgeSignal(seen({ tone: 'idle', from: 'busy', seq: 5 }), 3)).toBe('settled');
  expect(paneEdgeSignal(seen({ tone: 'ended', from: 'busy', seq: 5 }), 3)).toBe('settled');
});

it('never sweeps twice for the same turn, nor for one older than the stage', () => {
  expect(paneEdgeSignal(seen({ tone: 'idle', from: 'busy', seq: 5 }), 5)).toBeNull();
  expect(paneEdgeSignal(seen({ tone: 'idle', from: 'busy', seq: 2 }), 5)).toBeNull();
});

it('does not sweep when the wait was answered by a turn that has not run yet', () => {
  // waiting → idle is the user declining, not a turn Claude finished.
  expect(paneEdgeSignal(seen({ tone: 'idle', from: 'waiting', seq: 5 }), 1)).toBeNull();
  // The first reading is no change anyone saw happen.
  expect(paneEdgeSignal(seen({ tone: 'idle', from: null, seq: 5 }), 1)).toBeNull();
});
