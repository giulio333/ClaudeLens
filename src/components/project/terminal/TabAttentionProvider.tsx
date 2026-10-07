import { useState, type ReactNode } from 'react';
import { useActiveSessions } from '../../../hooks/useIPC';
import { heldTone, nextAttention, NO_ATTENTION, type AttentionState } from './tab-attention';
import { chipTone, registryEntryFor, type TerminalInstance } from './terminal-instances';
import { TabAttentionContext } from './use-tab-attention';

/**
 * Keeps reading every open session's state while no tab strip is mounted, so a
 * turn that ends out of sight is still marked when the user comes back.
 *
 * A provider and not a hook in ProjectOverview: the registry changes on every
 * status transition, and the state living here re-renders only the tabs and the
 * background badge that read it, not the whole navigation shell. Derived during
 * render, the way React stores information from previous renders — an effect
 * would paint one frame of the old state before the orb starts to settle.
 */
export function TabAttentionProvider({
  instances,
  currentId,
  children,
}: {
  instances: readonly TerminalInstance[];
  currentId: string | null;
  children: ReactNode;
}) {
  const { data: registry } = useActiveSessions();
  const [state, setState] = useState<AttentionState>(NO_ATTENTION);
  const readings = instances.map(i => {
    const missed = i.report.termStatus === 'running' && !registryEntryFor(i.report, registry);
    return { id: i.id, tone: heldTone(state.byId[i.id], chipTone(i.report, registry), missed) };
  });
  const next = nextAttention(state, readings, currentId);
  if (next !== state) setState(next);
  return <TabAttentionContext.Provider value={next}>{children}</TabAttentionContext.Provider>;
}
