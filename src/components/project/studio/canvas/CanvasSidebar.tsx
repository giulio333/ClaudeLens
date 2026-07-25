// The Canvas control surface. Left: phase outline + node palette + viewport
// toggles. Right: a contextual inspector that reuses StepInspector as-is for
// agent steps and verbatim editors for code/guard/output/log — no new write
// operations, every edit goes through the same Blueprint handlers as Flow.

import type {
  Blueprint,
  BlueprintIssue,
  BlueprintNode,
  BlueprintPhase,
  BlueprintStep,
} from '../../../../types';
import { useState } from 'react';
import { StepInspector } from '../StepInspector';
import { ObjectFields, SchemaBuilder } from '../SchemaBuilder';
import { serializeSchemaModel } from '../../../../../electron/shared/studio-schema';
import type { SchemaNodeModel } from '../../../../../electron/shared/studio-schema';
import { describeCode, inputCls, labelCls } from '../studioLang';
import type { CanvasColumn, CanvasGraph, NodeRef, PositionedBlock } from './graph';

export interface BlueprintHandlers {
  updateStep: (id: string, patch: Partial<BlueprintStep>) => void;
  removeStep: (id: string) => void;
  duplicateStep: (id: string) => void;
  addStep: (phaseIndex: number, parallel: boolean) => void;
  addNode: (phaseIndex: number, make: (id: string) => BlueprintNode, select?: boolean) => void;
  moveNode: (pi: number | 'pre', ni: number, delta: -1 | 1) => void;
  removeNodeAt: (pi: number | 'pre', ni: number) => void;
  updateNode: (pi: number | 'pre', ni: number, next: BlueprintNode) => void;
  updatePhase: (i: number, patch: Partial<BlueprintPhase>) => void;
  movePhase: (i: number, delta: -1 | 1) => void;
  removePhase: (i: number) => void;
  addPhase: () => void;
}

export interface ViewportToggles {
  showData: boolean;
  setShowData: (v: boolean) => void;
  showAux: boolean;
  setShowAux: (v: boolean) => void;
}

const sideLabel = 'font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cl-ink-4)] mb-3';
const miniBtn =
  'w-6 h-6 grid place-items-center rounded-md border border-[var(--cl-line)] bg-[var(--cl-paper)] font-mono text-[10px] text-[var(--cl-ink-3)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink-2)] disabled:opacity-30 transition-colors';

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between w-full text-left"
    >
      <span className="text-[13px] text-[var(--cl-ink-2)]">{label}</span>
      <span
        className="relative shrink-0"
        style={{
          width: 34,
          height: 19,
          borderRadius: 999,
          background: on ? 'var(--cl-accent)' : 'var(--cl-line)',
          transition: 'background 120ms',
        }}
      >
        <span
          className="absolute"
          style={{
            top: 2,
            left: 2,
            width: 15,
            height: 15,
            borderRadius: '50%',
            background: '#fff',
            transform: on ? 'translateX(15px)' : 'translateX(0)',
            transition: 'transform 120ms',
            boxShadow: '0 1px 2px oklch(0 0 0 / 0.2)',
          }}
        />
      </span>
    </button>
  );
}

export function CanvasLeftSidebar({
  graph,
  draft,
  activePhase,
  setActivePhase,
  onFocusColumn,
  handlers,
  toggles,
  onFit,
  onRelayout,
  floating = false,
}: {
  graph: CanvasGraph;
  draft: Blueprint;
  activePhase: number;
  setActivePhase: (i: number) => void;
  onFocusColumn: (col: number) => void;
  handlers: BlueprintHandlers;
  toggles: ViewportToggles;
  onFit: () => void;
  onRelayout: () => void;
  /** Liquid-glass floating variant (Canvas design 1b). */
  floating?: boolean;
}) {
  const phaseColumns = graph.columns.filter(c => c.phase !== 'pre');
  // Count the script's own statements: the synthetic OUTPUT and the satellite
  // schema cards are projections of another node, not nodes of their own.
  const blockById = new Map(graph.blocks.map(b => [b.id, b]));
  const nodeCount = (col: CanvasColumn) =>
    col.blockIds.filter(id => blockById.get(id)?.nodeRef).length;

  return (
    <div
      className={
        floating
          ? 'cl-studio-glass w-[236px] max-h-full overflow-y-auto rounded-2xl px-5 py-6'
          : 'w-[236px] shrink-0 h-full overflow-y-auto border-r border-[var(--cl-line)] bg-[var(--cl-paper)] px-5 py-6'
      }
    >
      <div className="flex flex-col gap-[26px]">
        <div>
          <div className={sideLabel}>Phases</div>
          <div className="space-y-[3px]">
            {graph.columns.map(col => {
              const isSetup = col.phase === 'pre';
              const pi = isSetup ? -1 : (col.phase as number);
              const activeRow = !isSetup && pi === activePhase;
              return (
                <div key={col.index} className="flex items-center gap-1 group">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSetup) setActivePhase(pi);
                      onFocusColumn(col.index);
                    }}
                    className={`flex-1 min-w-0 flex items-baseline justify-between gap-2 px-[11px] py-[9px] rounded-[9px] transition-colors ${
                      activeRow ? '' : 'hover:bg-[var(--cl-paper-2)]'
                    }`}
                    style={{
                      background: activeRow ? 'var(--cl-accent-soft)' : undefined,
                      boxShadow: activeRow ? 'inset 3px 0 0 var(--cl-accent)' : undefined,
                    }}
                  >
                    <span
                      className="truncate text-[14px] font-semibold"
                      style={{ color: activeRow ? 'var(--cl-accent-ink)' : 'var(--cl-ink-2)' }}
                    >
                      {col.title}
                    </span>
                    <span
                      className="shrink-0 font-mono text-[10.5px]"
                      style={{ color: activeRow ? 'var(--cl-accent-ink)' : 'var(--cl-ink-4)' }}
                    >
                      {nodeCount(col)} {nodeCount(col) === 1 ? 'node' : 'nodes'}
                    </span>
                  </button>
                  {!isSetup && (
                    <span className="hidden group-hover:flex flex-col gap-0.5">
                      <button
                        type="button"
                        title="Move phase up"
                        className={miniBtn}
                        disabled={pi === 0}
                        onClick={() => handlers.movePhase(pi, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="Move phase down"
                        className={miniBtn}
                        disabled={pi === draft.phases.length - 1}
                        onClick={() => handlers.movePhase(pi, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handlers.addPhase}
            className="mt-[5px] w-full px-[11px] py-2 rounded-[9px] border border-dashed border-[var(--cl-line)] text-center text-[12px] text-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)] hover:border-[var(--cl-ink-4)] transition-colors"
          >
            + add phase
          </button>
        </div>

        <div>
          <div className={sideLabel}>
            Add to{' '}
            {phaseColumns.length
              ? draft.phases[activePhase]?.title || `phase ${activePhase + 1}`
              : '—'}
          </div>
          <div className="grid grid-cols-2 gap-[7px]">
            {(
              [
                ['+ agent', () => handlers.addStep(activePhase, false)],
                ['+ parallel', () => handlers.addStep(activePhase, true)],
                [
                  '+ for-each',
                  () =>
                    handlers.addNode(activePhase, id => ({
                      kind: 'pipeline',
                      resultVar: null,
                      itemsSource: 'items',
                      stages: [{ kind: 'agent', params: 'item', step: { id, prompt: '' } }],
                    })),
                ],
                [
                  '+ note',
                  () => handlers.addNode(activePhase, () => ({ kind: 'log', message: '' }), false),
                ],
              ] as const
            ).map(([label, run]) => (
              <button
                key={label}
                type="button"
                disabled={!draft.phases[activePhase]}
                onClick={run}
                className="px-2 py-2 rounded-[9px] border border-[var(--cl-line)] text-center text-[12.5px] font-medium text-[var(--cl-ink-2)] hover:border-[var(--cl-ink-2)] hover:text-[var(--cl-ink)] disabled:opacity-40 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className={sideLabel}>Viewport</div>
          <div className="flex flex-col gap-[13px]">
            <Toggle
              on={toggles.showData}
              label="Data-flow arrows"
              onClick={() => toggles.setShowData(!toggles.showData)}
            />
            <Toggle
              on={toggles.showAux}
              label="Code / setup nodes"
              onClick={() => toggles.setShowAux(!toggles.showAux)}
            />
            <button
              type="button"
              onClick={onRelayout}
              className="mt-[3px] w-full px-2 py-[9px] rounded-[9px] border border-[var(--cl-line)] text-center text-[12.5px] text-[var(--cl-ink-2)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink-2)] transition-colors"
            >
              Re-layout
            </button>
            <button
              type="button"
              onClick={onFit}
              className="w-full px-2 py-[9px] rounded-[9px] border border-[var(--cl-line)] text-center text-[12.5px] text-[var(--cl-ink-2)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink-2)] transition-colors"
            >
              Fit to view
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeControls({
  block,
  handlers,
}: {
  block: PositionedBlock;
  handlers: BlueprintHandlers;
}) {
  if (!block.nodeRef) return null;
  const { pi, ni } = block.nodeRef;
  return (
    <div className="flex items-center gap-1.5 pt-3 mt-3 border-t border-[var(--cl-line-soft)]">
      <button
        type="button"
        className={miniBtn}
        title="Move up"
        onClick={() => handlers.moveNode(pi, ni, -1)}
      >
        ↑
      </button>
      <button
        type="button"
        className={miniBtn}
        title="Move down"
        onClick={() => handlers.moveNode(pi, ni, 1)}
      >
        ↓
      </button>
      <button
        type="button"
        className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] px-2.5 py-1 border border-[var(--cl-line)] text-[var(--cl-danger)] hover:border-[var(--cl-danger)] transition-colors"
        onClick={() => handlers.removeNodeAt(pi, ni)}
      >
        Remove
      </button>
    </div>
  );
}

/** Thin vertical rail shown when the inspector is collapsed — click to reopen. */
export function CollapsedInspectorRail({
  onExpand,
  floating = false,
}: {
  onExpand: () => void;
  floating?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title="Open inspector"
      className={
        floating
          ? 'cl-studio-glass w-9 flex flex-col items-center gap-3 py-4 rounded-2xl text-[var(--cl-ink-3)] hover:text-[var(--cl-ink)] transition-colors'
          : 'w-9 shrink-0 h-full flex flex-col items-center gap-3 pt-3 border-l border-[var(--cl-line)] bg-[var(--cl-paper)] text-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)] hover:bg-[var(--cl-paper-2)] transition-colors'
      }
    >
      <span className="font-mono text-[13px] leading-none">«</span>
      <span
        className="font-mono text-[9px] uppercase tracking-[0.2em]"
        style={{ writingMode: 'vertical-rl' }}
      >
        Inspector
      </span>
    </button>
  );
}

export function CanvasRightInspector({
  draft,
  agentNames,
  issues,
  stepCtx,
  blockSel,
  handlers,
  onSelectStep,
  onCollapse,
  width = 380,
  onResizeStart,
  resizing = false,
  floating = false,
}: {
  draft: Blueprint;
  agentNames: string[];
  issues: BlueprintIssue[];
  stepCtx: { step: BlueprintStep; refIds: string[]; inPipeline: boolean } | null;
  blockSel: PositionedBlock | null;
  handlers: BlueprintHandlers;
  onSelectStep: (id: string) => void;
  onCollapse?: () => void;
  /** Current panel width in px (resizable via the left-edge handle). */
  width?: number;
  /** Begin a drag-resize from the left edge. */
  onResizeStart?: (e: React.MouseEvent) => void;
  resizing?: boolean;
  /** Liquid-glass floating variant (Canvas design 1b). */
  floating?: boolean;
}) {
  return (
    <div
      className={
        floating
          ? 'cl-studio-glass relative h-full flex flex-col rounded-2xl overflow-hidden'
          : 'relative shrink-0 h-full flex flex-col border-l border-[var(--cl-line)] bg-[var(--cl-paper)]'
      }
      style={{ width }}
    >
      {onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          title="Drag to resize"
          className="group absolute left-0 top-0 z-20 flex h-full w-3 -ml-1.5 cursor-col-resize items-center justify-center"
        >
          {/* always-visible hairline that thickens + turns accent on hover/drag */}
          <span
            className="h-full w-px transition-colors group-hover:w-[2px]"
            style={{ background: resizing ? 'var(--cl-accent)' : 'var(--cl-line)' }}
          />
          {/* grip dots, revealed on hover to advertise the handle */}
          <span
            className="pointer-events-none absolute flex flex-col gap-[3px] opacity-0 transition-opacity group-hover:opacity-100"
            style={{ color: resizing ? 'var(--cl-accent)' : 'var(--cl-ink-4)' }}
          >
            <span className="h-[3px] w-[3px] rounded-full bg-current" />
            <span className="h-[3px] w-[3px] rounded-full bg-current" />
            <span className="h-[3px] w-[3px] rounded-full bg-current" />
          </span>
        </div>
      )}
      {onCollapse && (
        <div className="shrink-0 flex items-center justify-between h-9 px-3 border-b border-[var(--cl-line)]">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--cl-ink-4)]">
            Inspector
          </span>
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse inspector"
            className="grid place-items-center w-6 h-6 rounded-md font-mono text-[13px] text-[var(--cl-ink-4)] hover:text-[var(--cl-ink)] hover:bg-[var(--cl-paper-2)] transition-colors"
          >
            »
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {stepCtx ? (
          <div className="p-3">
            <div className={sideLabel + ' px-1'}>Agent · {stepCtx.step.id}</div>
            <StepInspector
              step={stepCtx.step}
              agentNames={agentNames}
              refIds={stepCtx.refIds}
              inPipeline={stepCtx.inPipeline}
              nested
              onChange={patch => handlers.updateStep(stepCtx.step.id, patch)}
              onDuplicate={() => handlers.duplicateStep(stepCtx.step.id)}
              onRemove={() => handlers.removeStep(stepCtx.step.id)}
            />
          </div>
        ) : blockSel ? (
          <BlockInspector
            draft={draft}
            block={blockSel}
            handlers={handlers}
            onSelectStep={onSelectStep}
          />
        ) : (
          <SummaryPanel draft={draft} issues={issues} />
        )}
      </div>
    </div>
  );
}

function BlockInspector({
  draft,
  block,
  handlers,
  onSelectStep,
}: {
  draft: Blueprint;
  block: PositionedBlock;
  handlers: BlueprintHandlers;
  onSelectStep: (id: string) => void;
}) {
  const ref = block.nodeRef;
  const node: BlueprintNode | undefined = ref
    ? ref.pi === 'pre'
      ? (draft.preamble ?? [])[ref.ni]
      : draft.phases[ref.pi]?.nodes[ref.ni]
    : undefined;

  const heading =
    block.kind === 'guard'
      ? 'Guard'
      : block.kind === 'output'
        ? 'Output'
        : block.kind === 'setup'
          ? 'Setup'
          : block.kind === 'schema'
            ? 'Schema'
            : block.kind === 'foreach'
              ? 'For-each'
              : block.kind === 'log'
                ? 'Progress note'
                : 'Code';

  return (
    <div className="p-4">
      <div className={sideLabel}>{heading}</div>

      {block.schemaOwnerStepId && (
        <StepSchemaEditor
          draft={draft}
          stepId={block.schemaOwnerStepId}
          handlers={handlers}
          onSelectStep={onSelectStep}
        />
      )}

      {block.kind === 'schema' && !ref && !block.schemaOwnerStepId && (
        <div>
          <p className="mb-2 font-mono text-[11px] text-[var(--cl-ink)]">{block.label}</p>
          <p className="mb-0 text-[12px] leading-relaxed text-[var(--cl-ink-3)]">
            The agents wired here ask for this schema by name, but the script doesn't declare it
            anywhere this view can read (imported, computed, or built at runtime). Open Script to
            edit the definition.
          </p>
        </div>
      )}

      {!ref && block.kind === 'output' && (
        <p className="text-[12px] text-[var(--cl-ink-3)]">
          This OUTPUT is the workflow's auto-return (
          <code className="font-mono">{block.label}</code>). It is derived from the last agent — add
          an explicit <code className="font-mono">return</code> statement in Script to customize it.
        </p>
      )}

      {node?.kind === 'pipeline' && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Items expression</label>
            <input
              className={inputCls + ' font-mono text-[12px]'}
              value={node.itemsSource}
              onChange={e =>
                ref && handlers.updateNode(ref.pi, ref.ni, { ...node, itemsSource: e.target.value })
              }
            />
          </div>
          <div>
            <label className={labelCls}>Collect into (variable)</label>
            <input
              className={inputCls + ' font-mono text-[12px]'}
              placeholder="(not collected)"
              value={node.resultVar ?? ''}
              onChange={e =>
                ref &&
                handlers.updateNode(ref.pi, ref.ni, { ...node, resultVar: e.target.value || null })
              }
            />
          </div>
          <div>
            <label className={labelCls}>Stages</label>
            <div className="space-y-1.5">
              {node.stages.map((stage, si) =>
                stage.kind === 'agent' ? (
                  <button
                    key={si}
                    type="button"
                    onClick={() => onSelectStep(stage.step.id)}
                    className="w-full text-left px-2.5 py-2 border border-[var(--cl-line)] hover:border-[var(--cl-ink-2)] transition-colors"
                  >
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--cl-accent-ink)]">
                      per item
                    </span>
                    <span className="block text-[12px] text-[var(--cl-ink)] truncate">
                      {stage.step.id}
                    </span>
                  </button>
                ) : (
                  <textarea
                    key={si}
                    className={inputCls + ' font-mono text-[11.5px] resize-y min-h-[64px]'}
                    value={stage.source}
                    aria-label="then stage"
                    onChange={e =>
                      ref &&
                      handlers.updateNode(ref.pi, ref.ni, {
                        ...node,
                        stages: node.stages.map((s, j) =>
                          j === si ? { kind: 'code', source: e.target.value } : s
                        ),
                      })
                    }
                  />
                )
              )}
            </div>
          </div>
        </div>
      )}

      {node?.kind === 'log' && (
        <div>
          <label className={labelCls}>Message</label>
          <input
            className={inputCls}
            value={node.message}
            placeholder="progress message shown while the workflow runs"
            onChange={e =>
              ref && handlers.updateNode(ref.pi, ref.ni, { ...node, message: e.target.value })
            }
          />
        </div>
      )}

      {block.kind === 'schema' && node?.kind === 'code' && node.schemaModel && (
        <SchemaBlockEditor node={node} nodeRef={ref} handlers={handlers} />
      )}

      {node?.kind === 'code' && !(block.kind === 'schema' && node.schemaModel) && (
        <div>
          <label className={labelCls}>
            {block.kind === 'schema'
              ? 'Schema definition (verbatim JS)'
              : describeCode(node.source).tag === 'guard'
                ? 'Guard condition (verbatim JS)'
                : describeCode(node.source).tag === 'result'
                  ? 'Return statement (verbatim JS)'
                  : 'Verbatim JS'}
          </label>
          <textarea
            className={inputCls + ' font-mono text-[12px] leading-[1.6] resize-y'}
            style={{ minHeight: Math.min(360, 64 + node.source.split('\n').length * 19) }}
            value={node.source}
            spellCheck={false}
            aria-label="Code block"
            onChange={e =>
              ref && handlers.updateNode(ref.pi, ref.ni, { ...node, source: e.target.value })
            }
          />
          <p className="mt-1.5 font-mono text-[10px] text-[var(--cl-ink-4)]">
            {describeCode(node.source).label}
          </p>
        </div>
      )}

      {ref && <NodeControls block={block} handlers={handlers} />}
    </div>
  );
}

/** The step with this id, wherever it lives (top level, parallel, pipeline stage). */
function findStep(draft: Blueprint, id: string): BlueprintStep | null {
  const nodes = [...(draft.preamble ?? []), ...draft.phases.flatMap(p => p.nodes)];
  for (const node of nodes) {
    if (node.kind === 'step' && node.step.id === id) return node.step;
    if (node.kind === 'parallel') {
      const hit = node.steps.find(s => s.id === id);
      if (hit) return hit;
    }
    if (node.kind === 'pipeline') {
      for (const stage of node.stages)
        if (stage.kind === 'agent' && stage.step.id === id) return stage.step;
    }
  }
  return null;
}

/**
 * Editor for a schema that lives on the agent's own `agent()` call (a literal
 * written in place). The block is a projection of that step — it has no node of
 * its own — so edits go through `updateStep` via the very same `SchemaBuilder`
 * the agent inspector uses: one editor, two entry points.
 */
function StepSchemaEditor({
  draft,
  stepId,
  handlers,
  onSelectStep,
}: {
  draft: Blueprint;
  stepId: string;
  handlers: BlueprintHandlers;
  onSelectStep: (id: string) => void;
}) {
  const step = findStep(draft, stepId);
  if (!step) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelectStep(stepId)}
        className="mb-3 w-full text-left px-2.5 py-2 border border-[var(--cl-line)] hover:border-[var(--cl-ink-2)] transition-colors"
        title="Open the agent that declares this schema"
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--cl-accent-ink)]">
          declared by
        </span>
        <span className="block text-[12px] text-[var(--cl-ink)] truncate">{stepId} →</span>
      </button>
      <SchemaBuilder step={step} onPatch={patch => handlers.updateStep(stepId, patch)} />
      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-[var(--cl-ink-4)]">
        Written on this agent's <code className="text-[var(--cl-ink-3)]">agent()</code> call —
        editing fields rewrites it there. To share it with other agents, move it to a{' '}
        <code className="text-[var(--cl-ink-3)]">const</code> in Script and reference it by name.
      </p>
    </div>
  );
}

/**
 * Structured editor for a shared schema const (`const NAME = {…}` referenced by
 * `schema: NAME`). Reuses the same field editor the agent inspector uses; editing
 * fields recompiles the const in place, keeping the native `.js` the source of
 * truth. Editing the raw source drops the model (structured view returns on the
 * next parse), mirroring SchemaBuilder.
 */
function SchemaBlockEditor({
  node,
  nodeRef,
  handlers,
}: {
  node: Extract<BlueprintNode, { kind: 'code' }>;
  nodeRef: NodeRef | null;
  handlers: BlueprintHandlers;
}) {
  const [showSource, setShowSource] = useState(false);
  const model = node.schemaModel as SchemaNodeModel;
  const name = node.schemaName ?? 'schema';
  const fieldN = model.children?.length ?? 0;

  const recompile = (next: SchemaNodeModel): string => {
    const prefix = /^\s*export\s+/.test(node.source) ? 'export ' : '';
    const semi = /;\s*$/.test(node.source) ? ';' : '';
    return `${prefix}const ${name} = ${serializeSchemaModel(next)}${semi}`;
  };
  const patchModel = (next: SchemaNodeModel) =>
    nodeRef &&
    handlers.updateNode(nodeRef.pi, nodeRef.ni, {
      ...node,
      source: recompile(next),
      schemaModel: next,
      schemaName: name,
    });
  const patchSource = (source: string) =>
    nodeRef &&
    handlers.updateNode(nodeRef.pi, nodeRef.ni, {
      ...node,
      source,
      schemaModel: undefined,
      schemaName: undefined,
    });

  return (
    <div>
      <div className="flex items-center mb-2">
        <span className="font-mono text-[11px] text-[var(--cl-ink)]">{name}</span>
        <span className="ml-2 font-mono text-[10px] text-[var(--cl-ink-4)]">
          {model.type}
          {model.type === 'object' ? ` · ${fieldN} field${fieldN === 1 ? '' : 's'}` : ''}
        </span>
        <button
          type="button"
          className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)] transition-colors"
          onClick={() => setShowSource(s => !s)}
        >
          {showSource ? 'fields' : 'source'}
        </button>
      </div>
      {showSource ? (
        <textarea
          className={inputCls + ' font-mono text-[12px] leading-[1.6] resize-y'}
          style={{ minHeight: Math.min(360, 64 + node.source.split('\n').length * 19) }}
          value={node.source}
          spellCheck={false}
          aria-label="Schema source"
          onChange={e => patchSource(e.target.value)}
        />
      ) : model.type === 'object' ? (
        <ObjectFields node={model} depth={0} onChange={patchModel} />
      ) : (
        <p className="font-mono text-[10.5px] text-[var(--cl-ink-4)]">
          Top-level {model.type} schema — switch to source to edit it.
        </p>
      )}
      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-[var(--cl-ink-4)]">
        Shared structured output. Editing fields rewrites the <code>const</code> in the script —
        every agent using <code className="text-[var(--cl-ink-3)]">schema: {name}</code> gets it.
      </p>
    </div>
  );
}

function SummaryPanel({ draft, issues }: { draft: Blueprint; issues: BlueprintIssue[] }) {
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  return (
    <div className="p-4">
      <div className={sideLabel}>Workflow</div>
      <div className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--cl-ink)]">
        {draft.name}
      </div>
      <p className="mt-1 mb-4 text-[12.5px] leading-relaxed text-[var(--cl-ink-2)]">
        {draft.description}
      </p>

      {draft.brief.goal && (
        <div className="mb-4">
          <div className={sideLabel}>Goal</div>
          <p className="mb-0 text-[12px] leading-relaxed text-[var(--cl-ink-2)]">
            {draft.brief.goal}
          </p>
        </div>
      )}

      <div className="mb-4">
        <div className={sideLabel}>Checks</div>
        {issues.length === 0 ? (
          <p className="mb-0 font-mono text-[11px] text-[var(--cl-ink-2)]">
            <span style={{ color: 'var(--cl-ok)' }}>✓</span> references resolve ·{' '}
            <span style={{ color: 'var(--cl-ok)' }}>✓</span> compiles clean
          </p>
        ) : (
          <ul className="list-none pl-0 mb-0 space-y-1">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={i} className="font-mono text-[11px] text-[var(--cl-ink-2)]">
                <span
                  style={{
                    color: issue.severity === 'error' ? 'var(--cl-danger)' : 'var(--cl-warn)',
                  }}
                >
                  {issue.severity === 'error' ? '✕' : '⚠'}
                </span>{' '}
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="font-mono text-[10px] leading-relaxed text-[var(--cl-ink-4)]">
        Select a block to edit it. Columns are phases; arrows are the data each agent consumes. The
        native script stays the source of truth.
      </p>
    </div>
  );
}
