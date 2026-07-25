// Shared selection/highlight state for the React Flow canvas. RF custom nodes
// only receive their `data`, so the cross-cutting selection (which step is
// selected, which block is hovered, the ref sets used for in-card highlighting)
// travels via context rather than being baked into every node's data — that
// keeps the node array stable across selection changes (only the context value
// churns, exactly like the hand-rolled canvas re-rendered its blocks on hover).

import { createContext, useContext } from 'react';

export interface CanvasSelection {
  selectedStep: string | null;
  /** Block currently hovered or holding the selected step (accents its edges). */
  activeBlockId: string | null;
  onSelectStep: (id: string) => void;
  onSelectBlock: (id: string) => void;
  onHover: (id: string | null) => void;
}

export const CanvasSelectionContext = createContext<CanvasSelection | null>(null);

export function useCanvasSelection(): CanvasSelection {
  const ctx = useContext(CanvasSelectionContext);
  if (!ctx) throw new Error('useCanvasSelection must be used within CanvasSelectionContext');
  return ctx;
}
