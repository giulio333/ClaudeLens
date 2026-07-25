// Canvas lens, React Flow edition. React Flow owns pan/zoom/fit/minimap and
// renders the typed blocks as custom nodes, with ELK computing the layout. The
// two sidebars and the shared `selectedStep` are the same as Flow; every
// mutation still routes through the same BlueprintHandlers, so the round-trip to
// the native `.js` is untouched.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Blueprint, BlueprintIssue } from '../../../../../types';
import { useTheme } from '../../../../../hooks/useTheme';
import { buildGraph, type CanvasGraph } from '../graph';
import {
  CanvasLeftSidebar,
  CanvasRightInspector,
  CollapsedInspectorRail,
  type BlueprintHandlers,
} from '../CanvasSidebar';
import { BlockNode } from './BlockNode';
import { CanvasSelectionContext, type CanvasSelection } from './selection';
import { graphToEdges, graphToNodes, type BlockFlowNode } from './toFlow';
import { layoutWorkflow } from './layout';

const nodeTypes = { block: BlockNode };

interface FlowApi {
  fit: () => void;
  relayout: () => void;
  focusColumn: (col: number) => void;
}

export function StudioCanvasFlow({
  draft,
  agentNames,
  issues,
  selectedStep,
  setSelectedStep,
  handlers,
}: {
  draft: Blueprint;
  agentNames: string[];
  issues: BlueprintIssue[];
  selectedStep: string | null;
  setSelectedStep: (id: string | null) => void;
  handlers: BlueprintHandlers;
}) {
  const graph = useMemo(() => buildGraph(draft), [draft]);
  const { resolved } = useTheme();

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState(0);
  const [showData, setShowData] = useState(true);
  const [showAux, setShowAux] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const saved = Number(localStorage.getItem('cl-studio-inspector-width'));
    return saved >= 320 && saved <= 900 ? saved : 380;
  });
  const [resizing, setResizing] = useState(false);

  const apiRef = useRef<FlowApi | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      resizeRef.current = { startX: e.clientX, startW: inspectorWidth };
      setResizing(true);
      e.preventDefault();
    },
    [inspectorWidth]
  );

  // Drag-resize of the right inspector (left-edge handle). Dragging left widens
  // the panel; clamped so the canvas + left rail always keep room. Persisted.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const max = Math.min(900, window.innerWidth - 480);
      const next = Math.min(max, Math.max(320, r.startW - (e.clientX - r.startX)));
      setInspectorWidth(next);
      localStorage.setItem('cl-studio-inspector-width', String(Math.round(next)));
    };
    const onUp = () => {
      resizeRef.current = null;
      setResizing(false);
    };
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [resizing]);

  // Resolve `selectedStep` (shared with Flow) to its render context, so the
  // inspector behaves the same across lenses.
  const stepIndex = useMemo(() => {
    const map = new Map<
      string,
      {
        step: (typeof graph.blocks)[number]['step'];
        refIds: string[];
        inPipeline: boolean;
        blockId: string;
      }
    >();
    for (const b of graph.blocks) {
      if (b.kind === 'agent' && b.step) {
        map.set(b.step.id, {
          step: b.step,
          refIds: b.refIds ?? [],
          inPipeline: false,
          blockId: b.id,
        });
      } else if (b.kind === 'parallel' && b.members) {
        for (const m of b.members)
          map.set(m.step.id, { step: m.step, refIds: m.refIds, inPipeline: false, blockId: b.id });
      } else if (b.kind === 'foreach' && b.pipeline) {
        for (const s of b.pipeline.stages)
          if (s.kind === 'agent' && s.step)
            map.set(s.step.id, {
              step: s.step,
              refIds: s.refIds ?? [],
              inPipeline: true,
              blockId: b.id,
            });
      }
    }
    return map;
  }, [graph]);

  const stepEntry = selectedStep ? (stepIndex.get(selectedStep) ?? null) : null;
  const stepCtx =
    stepEntry && stepEntry.step
      ? { step: stepEntry.step, refIds: stepEntry.refIds, inPipeline: stepEntry.inPipeline }
      : null;
  const blockSel = selectedBlockId
    ? (graph.blocks.find(b => b.id === selectedBlockId) ?? null)
    : null;

  const activeBlockId = hovered ?? stepEntry?.blockId ?? selectedBlockId ?? null;

  const onSelectStep = useCallback(
    (id: string) => {
      const next = selectedStep === id ? null : id;
      setSelectedStep(next);
      setSelectedBlockId(null);
      if (next) setInspectorOpen(true);
    },
    [selectedStep, setSelectedStep]
  );
  const onSelectBlock = useCallback(
    (id: string) => {
      setSelectedBlockId(prev => (prev === id ? null : id));
      setSelectedStep(null);
      setInspectorOpen(true);
    },
    [setSelectedStep]
  );

  const clearSelection = useCallback(() => {
    setSelectedStep(null);
    setSelectedBlockId(null);
  }, [setSelectedStep]);

  const toggles = { showData, setShowData, showAux, setShowAux };

  const selection = useMemo<CanvasSelection>(
    () => ({
      selectedStep,
      activeBlockId,
      onSelectStep,
      onSelectBlock,
      onHover: setHovered,
    }),
    [selectedStep, activeBlockId, onSelectStep, onSelectBlock]
  );

  return (
    <div className="cl-studio-canvas" style={{ height: 'calc(100vh - 240px)', minHeight: 460 }}>
      {/* Full-bleed React Flow viewport; the control panels float on top of it. */}
      <div className="absolute inset-0">
        <CanvasSelectionContext.Provider value={selection}>
          <ReactFlowProvider>
            <FlowViewport
              graph={graph}
              showData={showData}
              showAux={showAux}
              activeBlockId={activeBlockId}
              colorMode={resolved}
              apiRef={apiRef}
              onPaneClick={clearSelection}
              onHover={setHovered}
            />
          </ReactFlowProvider>
        </CanvasSelectionContext.Provider>
      </div>

      {/* Floating glass phase rail (top-left) */}
      <div className="absolute left-4 top-4 bottom-4 z-10 flex items-start">
        <CanvasLeftSidebar
          graph={graph}
          draft={draft}
          activePhase={activePhase}
          setActivePhase={setActivePhase}
          onFocusColumn={col => apiRef.current?.focusColumn(col)}
          handlers={handlers}
          toggles={toggles}
          onFit={() => apiRef.current?.fit()}
          onRelayout={() => apiRef.current?.relayout()}
          floating
        />
      </div>

      {/* Floating glass inspector (top-right), resizable via its left edge */}
      {inspectorOpen ? (
        <div className="absolute right-4 top-4 bottom-4 z-10">
          <CanvasRightInspector
            draft={draft}
            agentNames={agentNames}
            issues={issues}
            stepCtx={stepCtx}
            blockSel={blockSel}
            handlers={handlers}
            onSelectStep={onSelectStep}
            onCollapse={() => setInspectorOpen(false)}
            width={inspectorWidth}
            onResizeStart={startResize}
            resizing={resizing}
            floating
          />
        </div>
      ) : (
        <div className="absolute right-4 top-4 z-10">
          <CollapsedInspectorRail onExpand={() => setInspectorOpen(true)} floating />
        </div>
      )}
    </div>
  );
}

function FlowViewport({
  graph,
  showData,
  showAux,
  activeBlockId,
  colorMode,
  apiRef,
  onPaneClick,
  onHover,
}: {
  graph: CanvasGraph;
  showData: boolean;
  showAux: boolean;
  activeBlockId: string | null;
  colorMode: 'light' | 'dark';
  apiRef: React.MutableRefObject<FlowApi | null>;
  onPaneClick: () => void;
  onHover: (id: string | null) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockFlowNode>([]);
  const rf = useReactFlow();
  const layoutRequest = useRef(0);

  // ELK layout runs whenever the graph or the aux-visibility changes. Edges are
  // derived separately (from display toggles + hover) so they don't re-trigger a
  // relayout.
  const relayout = useCallback(() => {
    const request = ++layoutRequest.current;
    const seeds = graphToNodes(graph, showAux);
    void layoutWorkflow(seeds, graph.edges).then(laid => {
      if (request !== layoutRequest.current) return;
      setNodes(laid);
      requestAnimationFrame(() => rf.fitView({ padding: 0.18, duration: 300 }));
    });
  }, [graph, showAux, setNodes, rf]);

  useEffect(() => {
    relayout();
    return () => {
      layoutRequest.current += 1;
    };
  }, [relayout]);

  const edges = useMemo(
    () =>
      nodes.length
        ? graphToEdges(graph, nodes, { showData, showAux, activeId: activeBlockId })
        : [],
    [nodes, graph, showData, showAux, activeBlockId]
  );

  useEffect(() => {
    apiRef.current = {
      fit: () => void rf.fitView({ padding: 0.18, duration: 300 }),
      relayout,
      focusColumn: col => {
        const cols = rf.getNodes().filter(n => (n as BlockFlowNode).data.block.col === col);
        if (cols.length)
          void rf.fitView({ nodes: cols.map(n => ({ id: n.id })), padding: 0.3, duration: 300 });
      },
    };
  }, [apiRef, relayout, rf]);

  const onNodeMouseEnter = useCallback<NodeMouseHandler>((_, node) => onHover(node.id), [onHover]);
  const onNodeMouseLeave = useCallback(() => onHover(null), [onHover]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      colorMode={colorMode}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.2}
      maxZoom={2}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      onPaneClick={onPaneClick}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={26}
        size={1.1}
        color="color-mix(in oklch, var(--cl-line) 62%, transparent)"
        bgColor="var(--cl-paper)"
      />
      <Controls showInteractive={false} position="bottom-center" orientation="horizontal" />
    </ReactFlow>
  );
}
