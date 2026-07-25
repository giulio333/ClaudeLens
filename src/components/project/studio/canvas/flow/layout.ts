// Automatic layout for the React Flow canvas. React Flow ships no layout engine
// (by design), so coordinates come from ELK — but the native workflow is a
// barrier model (ordered phases, each an ordered node list), so a phase must
// stay exactly ONE column. Pure ELK layering wants to assign columns from the
// edges, which fights that. So we split the job:
//
//   • X (which column) is DETERMINISTIC — `col * pitch`, the same phase-column
//     mapping graph.ts uses. This guarantees columns == phases and keeps even a
//     disconnected tail node (e.g. a synthetic OUTPUT) in its own phase.
//   • Y alignment comes from ELK's `layered` run with partitioning keyed on the
//     column, but the vertical ORDER is the script order. A workflow is not a
//     free DAG: moving a guard above the statement it follows makes the Canvas
//     contradict the source even if it removes an edge crossing.
//
// We then snap X to the canonical column and sweep each column top-to-bottom to
// guarantee no overlap. Only cross-column `data` edges feed ELK; `schema`
// edges are annotations and every edge is still drawn by React Flow. Layout is
// decoupled from the display toggles (it consumes the domain edges, not the
// rendered ones). If ELK throws, we fall back to graph.ts's seed Y.

import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { CanvasEdge } from '../graph';
import type { BlockFlowNode } from './toFlow';

const elk = new ELK();

// Must mirror graph.ts so a fallback (or a mixed read) lines up pixel-for-pixel.
const PAD = 40;
const COL_W = 300;
const COL_GAP = 104;
const BLOCK_GAP = 22;
const colX = (col: number) => PAD + col * (COL_W + COL_GAP);

const LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '104',
  'elk.spacing.nodeNode': '26',
  'elk.layered.spacing.edgeNodeBetweenLayers': '28',
  // Group same-phase nodes so ELK stacks them without overlap.
  'elk.partitioning.activate': 'true',
  // Break ties by source order so the reading order matches the script.
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  // `considerModelOrder` alone is only a preference. Keep the source order
  // during crossing minimization as well; the final sweep below enforces it a
  // second time so the guarantee survives future ELK option changes.
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
};

export async function layoutWorkflow(
  nodes: BlockFlowNode[],
  canvasEdges: CanvasEdge[]
): Promise<BlockFlowNode[]> {
  if (nodes.length === 0) return nodes;
  const colOf = new Map(nodes.map(n => [n.id, n.data.block.col]));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: nodes.map(n => ({
      id: n.id,
      width: n.data.block.w,
      height: n.data.block.h,
      layoutOptions: { 'elk.partitioning.partition': String(n.data.block.col) },
    })),
    edges: canvasEdges
      .filter(
        e =>
          e.kind === 'data' &&
          colOf.has(e.from) &&
          colOf.has(e.to) &&
          colOf.get(e.from) !== colOf.get(e.to)
      )
      .map(e => ({ id: `elk-${e.id}`, sources: [e.from], targets: [e.to] })),
  };

  const elkY = new Map<string, number>();
  try {
    const res = await elk.layout(graph);
    for (const c of res.children ?? []) elkY.set(c.id, c.y ?? 0);
  } catch {
    // Fall back to graph.ts's seed Y; X is deterministic below regardless.
  }

  // Snap X to the phase column; take Y from ELK (or the seed) as a starting hint.
  // A schema card with no node of its own is a satellite of its agent: it takes
  // the agent's hint
  // (+1 to sort right after it), so the sweep below always parks it immediately
  // underneath — ELK has no edge to keep the pair together on its own.
  const hint = new Map(nodes.map(n => [n.id, elkY.get(n.id) ?? n.data.block.y]));
  const sourceOrder = new Map(nodes.map((n, index) => [n.id, index]));
  const placed = nodes.map(n => {
    const owner = n.data.block.schemaOwnerBlockId;
    const y = owner !== undefined && hint.has(owner) ? hint.get(owner)! + 1 : hint.get(n.id)!;
    return { node: n, y };
  });

  // Per column: source order is a hard semantic constraint. ELK's hinted Y may
  // add useful whitespace/alignment, but it may never swap two statements.
  const byCol = new Map<number, typeof placed>();
  for (const p of placed) {
    const col = p.node.data.block.col;
    (byCol.get(col) ?? byCol.set(col, []).get(col)!).push(p);
  }
  const out = new Map<string, { x: number; y: number }>();
  for (const [col, items] of byCol) {
    items.sort((a, b) => (sourceOrder.get(a.node.id) ?? 0) - (sourceOrder.get(b.node.id) ?? 0));
    let cursor = -Infinity;
    for (const item of items) {
      const y = Math.max(item.y, cursor);
      out.set(item.node.id, { x: colX(col), y });
      cursor = y + item.node.data.block.h + BLOCK_GAP;
    }
  }

  return nodes.map(n => ({
    ...n,
    position: out.get(n.id) ?? { x: n.data.block.x, y: n.data.block.y },
  }));
}
