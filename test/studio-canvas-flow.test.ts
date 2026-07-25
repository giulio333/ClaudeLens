import { describe, expect, it } from 'vitest';
import type {
  CanvasEdge,
  CanvasGraph,
  PositionedBlock,
} from '../src/components/project/studio/canvas/graph';
import { layoutWorkflow } from '../src/components/project/studio/canvas/flow/layout';
import {
  graphToEdges,
  graphToNodes,
  type BlockFlowNode,
} from '../src/components/project/studio/canvas/flow/toFlow';

function block(id: string, col: number, y: number): PositionedBlock {
  return {
    id,
    kind: 'agent',
    col,
    phase: col,
    x: 40 + col * 404,
    y,
    w: 300,
    h: 100,
    nodeRef: { pi: col, ni: 0 },
    produces: [id],
  };
}

function graph(blocks: PositionedBlock[], edges: CanvasEdge[]): CanvasGraph {
  return {
    blocks,
    edges,
    columns: [],
    bounds: { w: 900, h: 500 },
  };
}

describe('Agent Studio Canvas layout and routing', () => {
  it('preserves script order inside each phase even when crossing edges favor a swap', async () => {
    const blocks = [block('a', 0, 40), block('b', 0, 162), block('x', 1, 40), block('y', 1, 162)];
    const edges: CanvasEdge[] = [
      { id: 'a-y', from: 'a', to: 'y', kind: 'data' },
      { id: 'b-x', from: 'b', to: 'x', kind: 'data' },
    ];

    const laid = await layoutWorkflow(graphToNodes(graph(blocks, edges), true), edges);
    const yOf = (id: string) => laid.find(node => node.id === id)!.position.y;

    expect(yOf('a')).toBeLessThan(yOf('b'));
    expect(yOf('x')).toBeLessThan(yOf('y'));
  });

  it('chooses vertical handles from the final node positions, not the seed layout', () => {
    const blocks = [block('source', 0, 40), block('target', 0, 162)];
    const edge: CanvasEdge = {
      id: 'source-target',
      from: 'source',
      to: 'target',
      kind: 'data',
    };
    const canvas = graph(blocks, [edge]);
    const nodes = graphToNodes(canvas, true).map((node): BlockFlowNode => ({
      ...node,
      // Reverse the nodes after the seed layout, as ELK or a drag can do.
      position: { ...node.position, y: node.id === 'source' ? 300 : 0 },
    }));

    expect(
      graphToEdges(canvas, nodes, {
        showData: true,
        showAux: true,
        activeId: null,
      })[0]
    ).toMatchObject({
      sourceHandle: 'st',
      targetHandle: 'tb',
      type: 'default',
    });
  });

  it('switches to the outward horizontal handles after a node crosses to the left', () => {
    const blocks = [block('source', 0, 40), block('target', 1, 40)];
    const edge: CanvasEdge = {
      id: 'source-target',
      from: 'source',
      to: 'target',
      kind: 'data',
    };
    const canvas = graph(blocks, [edge]);
    const nodes = graphToNodes(canvas, true).map((node): BlockFlowNode => ({
      ...node,
      position: { ...node.position, x: node.id === 'source' ? 500 : 0 },
    }));

    expect(
      graphToEdges(canvas, nodes, {
        showData: true,
        showAux: true,
        activeId: null,
      })[0]
    ).toMatchObject({
      sourceHandle: 'sl',
      targetHandle: 'tr',
    });
  });
});
