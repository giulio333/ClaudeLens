import { useMemo } from 'react';
import {
  AgentColorResolver,
  ChatDetailsFilter,
  ProcessedMessage,
  RenderItem,
  RenderRow,
  TurnDescriptor,
  buildRenderItems,
  buildRenderRows,
  buildRowIndexByTurn,
  describeTurn,
} from './utils';

export type TranscriptModel = {
  /** Per-turn descriptor (identity, what it renders, visibility) — index-aligned
   *  with `processed`. */
  descriptors: TurnDescriptor[];
  /** The transcript stream rows (message turns + collapsed "tools hidden" runs). */
  renderItems: RenderItem[];
  /** The same rows, resolved so each one renders from its index alone — what the
   *  windowed transcript iterates over. */
  rows: RenderRow[];
  /** Turn number → row index, for scrolling the window to a turn. */
  rowIndexByTurn: Map<number, number>;
  /** Per-type counts for the filter chips. */
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

  const renderItems = useMemo(
    () => buildRenderItems(processed, descriptors),
    [processed, descriptors]
  );

  const rows = useMemo(() => buildRenderRows(processed, renderItems), [processed, renderItems]);

  const rowIndexByTurn = useMemo(() => buildRowIndexByTurn(rows), [rows]);

  return {
    descriptors,
    renderItems,
    rows,
    rowIndexByTurn,
  };
}
