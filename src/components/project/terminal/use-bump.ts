import { useState } from 'react';

/**
 * How many times `value` has moved on since this component mounted: a count
 * that grew, or a key that changed. A one-shot animation is keyed on it, so it
 * plays once per change and never for what was already there when the tab
 * mounted — the strip remounts on every switch of tab.
 *
 * `ready` is false until the data has arrived at all: its first value is the
 * state the tab found, not a change.
 */
export function useBump(value: number | string | null | undefined, ready: boolean): number {
  const [prev, setPrev] = useState({ ready, value });
  const [bumps, setBumps] = useState(0);
  if (prev.ready !== ready || prev.value !== value) {
    const moved =
      typeof value === 'number' && typeof prev.value === 'number'
        ? value > prev.value
        : value != null && value !== prev.value;
    if (prev.ready && ready && moved) setBumps(b => b + 1);
    setPrev({ ready, value });
  }
  return bumps;
}
