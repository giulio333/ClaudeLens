import { useCallback, useMemo } from 'react';
import {
  AgentColorResolver,
  ChatDetailsFilter,
  MinimapItem,
  ProcessedMessage,
  RenderItem,
  RenderRow,
  TurnDescriptor,
  TurnFilterCounts,
  buildRenderItems,
  buildRenderRows,
  buildRowIndexByTurn,
  computeFilterCounts,
  describeTurn,
} from './utils';

export type TranscriptModel = {
  /** Per-turn descriptor (identity, what it renders, visibility) — index-aligned
   *  with `processed`. */
  descriptors: TurnDescriptor[];
  /** Visible turns enriched with a 1-based index + clock time (drives the filter
   *  counts and the minimap). */
  visibleItems: MinimapItem[];
  /** One dot per *message* turn — tool-only turns collapse into a stream badge,
   *  so they don't earn a navigation dot. */
  minimapItems: MinimapItem[];
  /** The transcript stream rows (message turns + collapsed "tools hidden" runs). */
  renderItems: RenderItem[];
  /** The same rows, resolved so each one renders from its index alone — what the
   *  windowed transcript iterates over. */
  rows: RenderRow[];
  /** Turn number → row index, for scrolling the window to a turn. */
  rowIndexByTurn: Map<number, number>;
  /** Per-type counts for the filter chips. */
  filterCounts: TurnFilterCounts;
};

/** Derives everything the Focus transcript renders from the processed messages
 *  and the current detail filter. Pure derivation (memoized) — all the heavy
 *  list work lives in `utils.ts` so it can be unit-tested in isolation. */
export function useTranscriptModel({
  processed,
  detailsFilter,
  agentColor,
}: {
  processed: ProcessedMessage[];
  detailsFilter: ChatDetailsFilter;
  /** Resolves a dispatched sub-agent's identity tint for the turn descriptor. */
  agentColor: AgentColorResolver;
}): TranscriptModel {
  // The detail filter (Minimal/Full) drives which turns are visible — Minimal
  // hides thinking/tools — so the navigation descriptors depend on it too.
  const descriptors = useMemo(
    () => processed.map(p => describeTurn(p, detailsFilter, agentColor)),
    [processed, detailsFilter, agentColor]
  );

  const fmtTurnTime = useCallback(
    (ts: string | undefined) =>
      ts
        ? new Date(ts).toLocaleTimeString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })
        : '',
    []
  );

  // Every turn that renders something — drives the type-filter counts so
  // "Tools" still reflects the collapsed tool-only turns.
  const visibleItems = useMemo<MinimapItem[]>(
    () =>
      descriptors
        .map((d, i) => ({ ...d, n: i + 1, time: fmtTurnTime(processed[i]?.msg.timestamp) }))
        .filter(d => d.visible),
    [descriptors, processed, fmtTurnTime]
  );

  const minimapItems = useMemo(() => visibleItems.filter(d => !d.toolsOnly), [visibleItems]);

  const renderItems = useMemo(
    () => buildRenderItems(processed, descriptors),
    [processed, descriptors]
  );

  const rows = useMemo(() => buildRenderRows(processed, renderItems), [processed, renderItems]);

  const rowIndexByTurn = useMemo(() => buildRowIndexByTurn(rows), [rows]);

  const filterCounts = useMemo(() => computeFilterCounts(visibleItems), [visibleItems]);

  return {
    descriptors,
    visibleItems,
    minimapItems,
    renderItems,
    rows,
    rowIndexByTurn,
    filterCounts,
  };
}
