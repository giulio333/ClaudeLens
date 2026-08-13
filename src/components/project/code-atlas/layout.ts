import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { CodeAtlasEdge, CodeAtlasModule } from '../../../types';

export const ATLAS_NODE_WIDTH = 224;
export const ATLAS_NODE_HEIGHT = 96;

const elk = new ELK();

const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '44',
  'elk.layered.spacing.nodeNodeBetweenLayers': '108',
  'elk.layered.spacing.edgeNodeBetweenLayers': '34',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

export type AtlasPosition = { x: number; y: number };

function fallback(modules: CodeAtlasModule[]): Map<string, AtlasPosition> {
  const columns = Math.max(1, Math.ceil(Math.sqrt(modules.length)));
  return new Map(
    modules.map((module, index) => [
      module.id,
      {
        x: (index % columns) * (ATLAS_NODE_WIDTH + 96),
        y: Math.floor(index / columns) * (ATLAS_NODE_HEIGHT + 54),
      },
    ])
  );
}

export async function layoutAtlas(
  modules: CodeAtlasModule[],
  edges: CodeAtlasEdge[]
): Promise<Map<string, AtlasPosition>> {
  if (modules.length === 0) return new Map();
  const ids = new Set(modules.map(module => module.id));
  const graph: ElkNode = {
    id: 'atlas',
    layoutOptions: OPTIONS,
    children: modules.map(module => ({
      id: module.id,
      width: ATLAS_NODE_WIDTH,
      height: ATLAS_NODE_HEIGHT,
    })),
    edges: edges
      .filter(edge => ids.has(edge.source) && ids.has(edge.target))
      .map(edge => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
  };

  try {
    const result = await elk.layout(graph);
    const positions = new Map<string, AtlasPosition>();
    for (const node of result.children ?? []) {
      positions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
    }
    return positions.size === modules.length ? positions : fallback(modules);
  } catch {
    return fallback(modules);
  }
}
