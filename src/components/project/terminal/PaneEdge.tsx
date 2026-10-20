import { useState } from 'react';
import { paneEdgeSignal } from './pane-edge';
import { useTabAttention } from './use-tab-attention';

/**
 * The edge of the work stage (`pane-edge.ts`), drawn over the pane and never in
 * its way: no pointer events, and hidden from assistive tech, since the tab says
 * the same in words. A Mission Control parked out of sight is `display: none`,
 * so the sweep for a turn that ended meanwhile waits for the stage to be shown,
 * plays once, and is cleared when its animation ends.
 *
 * Its own component so that a change of attention re-renders this span, not the
 * whole Mission Control around it.
 */
export function PaneEdge({ instanceId }: { instanceId: string }) {
  const attention = useTabAttention();
  const [playedSeq, setPlayedSeq] = useState(() => attention.seq);
  const entry = attention.byId[instanceId];
  const signal = paneEdgeSignal(entry, playedSeq);
  if (!signal) return null;
  return (
    <span
      className="cl-pane-edge"
      data-signal={signal}
      aria-hidden
      onAnimationEnd={e => {
        if (e.animationName === 'cl-pane-edge-settle' && entry) setPlayedSeq(entry.seq);
      }}
    />
  );
}
