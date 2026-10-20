// What the edge of the work stage says about the session on it: a line running
// along the top while Claude works, a ring while it waits for the user, and one
// sweep when a turn ends. Read from what the tab remembers (`TabAttention`), not
// from the registry directly: the tone there is held across a reading that
// missed the entry (`heldTone`), so a blip never sweeps a turn that did not end.

import { justSettled, type TabAttention } from './tab-attention';

export type PaneEdgeSignal = 'working' | 'waiting' | 'settled';

/** The edge for one reading. `playedSeq` is the newest change the stage has
 *  already swept for (or the one it mounted at): the sweep plays once per turn
 *  that ends, never because the stage was shown again. */
export function paneEdgeSignal(
  a: TabAttention | undefined,
  playedSeq: number
): PaneEdgeSignal | null {
  if (!a) return null;
  if (a.tone === 'busy') return 'working';
  if (a.tone === 'waiting') return 'waiting';
  return justSettled(a, playedSeq) ? 'settled' : null;
}
