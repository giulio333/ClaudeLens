// Pure adapter: the Canvas domain read-model (`CanvasGraph`, built by graph.ts)
// → React Flow's rendering model. Deliberately a one-way projection — React Flow
// is never the source of truth (positions come from ELK, semantics from the
// Blueprint). Kept pure so the mapping stays testable and free of RF hooks.

import { MarkerType, type BuiltInEdge } from '@xyflow/react';
import type { CanvasGraph, PositionedBlock } from '../graph';

/** Node payload: the positioned block, read by the custom `BlockNode`. */
export interface BlockNodeData extends Record<string, unknown> {
  block: PositionedBlock;
}
export type BlockFlowNode = import('@xyflow/react').Node<BlockNodeData, 'block'>;

/** Aux blocks (verbatim code / setup) hide behind the "code & setup" toggle. */
export function visibleBlocks(graph: CanvasGraph, showAux: boolean): PositionedBlock[] {
  return showAux ? graph.blocks : graph.blocks.filter(b => b.kind !== 'code' && b.kind !== 'setup');
}

/** Blocks → RF nodes. Positions are seeded from graph.ts but overwritten by ELK. */
export function graphToNodes(graph: CanvasGraph, showAux: boolean): BlockFlowNode[] {
  return visibleBlocks(graph, showAux).map(block => ({
    id: block.id,
    type: 'block',
    position: { x: block.x, y: block.y },
    data: { block },
    // The block owns its own box; RF just positions the wrapper.
    style: { width: block.w, height: block.h },
    draggable: true,
    connectable: false,
    deletable: false,
    // Selection is our own (highlight state), not RF's default outline.
    selectable: false,
  }));
}

/**
 * Edges → RF edges. Styling: data = ink hairline, schema = dashed accent;
 * the block under the cursor/selection accents its edges and dims the rest.
 */
export function graphToEdges(
  graph: CanvasGraph,
  nodes: BlockFlowNode[],
  opts: { showData: boolean; showAux: boolean; activeId: string | null }
): BuiltInEdge[] {
  const visible = visibleBlocks(graph, opts.showAux);
  const vis = new Set(visible.map(b => b.id));
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const dimmed = opts.activeId !== null;

  return graph.edges
    .filter(e => vis.has(e.from) && vis.has(e.to))
    .filter(e => (e.kind === 'data' || e.kind === 'schema' ? opts.showData : true))
    .map(e => {
      const active = opts.activeId === e.from || opts.activeId === e.to;
      const isSchema = e.kind === 'schema';
      const stroke = active
        ? 'var(--cl-accent)'
        : isSchema
          ? 'var(--cl-accent)'
          : 'var(--cl-ink-3)';
      // Clean-lanes edges (design 1a): thin, low-opacity curves; the block under
      // the cursor/selection lights its edges to full and points an arrow.
      const opacity = active ? 1 : dimmed ? 0.16 : isSchema ? 0.5 : 0.4;

      // Choose ports from the FINAL React Flow positions, not graph.ts's seed
      // coordinates. This stays correct after ELK reorders spacing and while a
      // user drags a node. Cross-phase links always read horizontally; links
      // within one phase prefer the vertical axis unless a user has dragged the
      // nodes far enough apart horizontally to make that route unnatural.
      const from = nodeById.get(e.from);
      const to = nodeById.get(e.to);
      const fromBlock = from?.data.block;
      const toBlock = to?.data.block;
      const fromCenter = fromBlock
        ? {
            x: from.position.x + fromBlock.w / 2,
            y: from.position.y + fromBlock.h / 2,
          }
        : null;
      const toCenter = toBlock
        ? {
            x: to.position.x + toBlock.w / 2,
            y: to.position.y + toBlock.h / 2,
          }
        : null;
      const dx = fromCenter && toCenter ? toCenter.x - fromCenter.x : 1;
      const dy = fromCenter && toCenter ? toCenter.y - fromCenter.y : 0;
      const sameColumn = fromBlock?.col === toBlock?.col;
      const horizontal = !sameColumn || Math.abs(dx) > Math.abs(dy);
      const sourceHandle = horizontal ? (dx >= 0 ? 'sr' : 'sl') : dy >= 0 ? 'sb' : 'st';
      const targetHandle = horizontal ? (dx >= 0 ? 'tl' : 'tr') : dy >= 0 ? 'tt' : 'tb';

      return {
        id: e.id,
        source: e.from,
        target: e.to,
        sourceHandle,
        targetHandle,
        type: 'default',
        data: { kind: e.kind },
        style: {
          stroke,
          strokeWidth: active ? 2 : 1.8,
          strokeLinecap: 'round',
          strokeDasharray: isSchema ? '2 4' : undefined,
          opacity,
        },
        markerEnd: active
          ? { type: MarkerType.ArrowClosed, width: 12, height: 12, color: stroke }
          : undefined,
        label: active ? e.label : undefined,
        labelShowBg: true,
        labelStyle: {
          fill: 'var(--cl-accent-ink)',
          fontFamily: 'var(--cl-mono, monospace)',
          fontSize: 10,
        },
        labelBgStyle: { fill: 'var(--cl-paper)' },
        labelBgPadding: [4, 2] as [number, number],
        zIndex: active ? 10 : 1,
      } satisfies BuiltInEdge;
    });
}
