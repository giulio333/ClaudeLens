import { useEffect, useMemo, useState } from 'react';
import {
  useBlueprint,
  useSaveBlueprint,
  useDeleteBlueprint,
  useGlobalAgents,
  useWriteNativeWorkflowScript,
} from '../../../hooks/useIPC';
import type {
  Blueprint,
  BlueprintIssue,
  BlueprintNode,
  BlueprintPhase,
  BlueprintStep,
} from '../../../types';
import { QueryError } from '../../QueryError';
import { TopBar } from '../shared/TopBar';
import { FieldHint } from '../shared/CreateFormKit';
import { StepInspector } from './StepInspector';
import { buildRefIndex, inputCls, labelCls, promptRefs, resolveRef } from './studioLang';
import { AgentCard, CodeNote, LogNote, RefChip, SpineMarker, SpineRail } from './flowAtoms';
import { StudioCanvasFlow } from './canvas/flow/StudioCanvasFlow';
import { SourceEditor } from './SourceEditor';

function phaseStepsOf(phase: BlueprintPhase): BlueprintStep[] {
  return phase.nodes.flatMap(nodeSteps);
}

function nodeSteps(node: BlueprintNode): BlueprintStep[] {
  if (node.kind === 'step') return [node.step];
  if (node.kind === 'parallel') return node.steps;
  if (node.kind === 'pipeline')
    return node.stages.flatMap(s => (s.kind === 'agent' ? [s.step] : []));
  return [];
}

function allSteps(bp: Blueprint): BlueprintStep[] {
  return [...(bp.preamble ?? []), ...bp.phases.flatMap(p => p.nodes)].flatMap(nodeSteps);
}

function nextStepId(bp: Blueprint): string {
  const ids = new Set(allSteps(bp).map(s => s.id));
  let n = ids.size + 1;
  while (ids.has(`step-${n}`)) n++;
  return `step-${n}`;
}

/** Immutable step patch applied wherever the step lives (node, parallel group, pipeline stage). */
function patchStepInNodes(
  nodes: BlueprintNode[],
  id: string,
  patch: Partial<BlueprintStep>
): BlueprintNode[] {
  const apply = (s: BlueprintStep) => (s.id === id ? { ...s, ...patch } : s);
  return nodes.map(node => {
    if (node.kind === 'step') return { ...node, step: apply(node.step) };
    if (node.kind === 'parallel') return { ...node, steps: node.steps.map(apply) };
    if (node.kind === 'pipeline') {
      return {
        ...node,
        stages: node.stages.map(stage =>
          stage.kind === 'agent' ? { ...stage, step: apply(stage.step) } : stage
        ),
      };
    }
    return node;
  });
}

/** Remove the step everywhere; empty parallel groups collapse, pipeline stages drop. */
function removeStepInNodes(nodes: BlueprintNode[], id: string): BlueprintNode[] {
  return nodes
    .map(node => {
      if (node.kind === 'step') return node.step.id === id ? null : node;
      if (node.kind === 'parallel') {
        const steps = node.steps.filter(s => s.id !== id);
        return steps.length === 0 ? null : { ...node, steps };
      }
      if (node.kind === 'pipeline') {
        return {
          ...node,
          stages: node.stages.filter(stage => stage.kind !== 'agent' || stage.step.id !== id),
        };
      }
      return node;
    })
    .filter((node): node is BlueprintNode => node !== null);
}

// ── Brief tab ────────────────────────────────────────────────────────────────

function ListEditor({
  label,
  hint,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  hint: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <div>
      <label className={labelCls}>
        <span>{label}</span>
        <FieldHint text={hint} />
      </label>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={inputCls}
              value={item}
              placeholder={placeholder}
              onChange={e => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              className="cl-btn"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="cl-btn" onClick={() => onChange([...items, ''])}>
          + add
        </button>
      </div>
    </div>
  );
}

function BriefTab({ draft, onChange }: { draft: Blueprint; onChange: (bp: Blueprint) => void }) {
  const brief = draft.brief;
  const setBrief = (patch: Partial<Blueprint['brief']>) =>
    onChange({ ...draft, brief: { ...brief, ...patch } });
  return (
    <section className="cl-section" style={{ paddingTop: 24, paddingBottom: 80, maxWidth: 720 }}>
      <div className="space-y-5">
        <div>
          <label className={labelCls}>
            <span>Description</span>
            <FieldHint text="One line shown by Claude Code as the workflow description." />
          </label>
          <input
            className={inputCls}
            value={draft.description}
            onChange={e => onChange({ ...draft, description: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls}>
            <span>Goal</span>
            <FieldHint text="What the workflow should achieve. Compiled into the script's whenToUse." />
          </label>
          <textarea
            className={inputCls + ' min-h-[100px] resize-y'}
            value={brief.goal}
            onChange={e => setBrief({ goal: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls}>
            <span>Inputs</span>
            <FieldHint text="Design-time documentation of the /command arguments. At runtime they arrive as the single ${args} string." />
          </label>
          <div className="space-y-2">
            {brief.inputs.map((input, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  className={inputCls + ' !w-[180px]'}
                  placeholder="tag"
                  value={input.name}
                  onChange={e =>
                    setBrief({
                      inputs: brief.inputs.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x
                      ),
                    })
                  }
                />
                <input
                  className={inputCls}
                  placeholder="what this input is"
                  value={input.description ?? ''}
                  onChange={e =>
                    setBrief({
                      inputs: brief.inputs.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x
                      ),
                    })
                  }
                />
                <label className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--cl-ink-3)]">
                  <input
                    type="checkbox"
                    checked={input.required === true}
                    onChange={e =>
                      setBrief({
                        inputs: brief.inputs.map((x, j) =>
                          j === i ? { ...x, required: e.target.checked } : x
                        ),
                      })
                    }
                  />
                  req
                </label>
                <button
                  type="button"
                  className="cl-btn"
                  onClick={() => setBrief({ inputs: brief.inputs.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="cl-btn"
              onClick={() => setBrief({ inputs: [...brief.inputs, { name: '' }] })}
            >
              + add input
            </button>
          </div>
        </div>
        <div>
          <label className={labelCls}>
            <span>Expected output</span>
            <FieldHint text="What a successful run produces." />
          </label>
          <textarea
            className={inputCls + ' min-h-[80px] resize-y'}
            value={brief.expectedOutput}
            onChange={e => setBrief({ expectedOutput: e.target.value })}
          />
        </div>
        <ListEditor
          label="Success criteria"
          hint="Compiled as comments into the script header."
          items={brief.successCriteria}
          placeholder="every changed file inspected"
          onChange={successCriteria => setBrief({ successCriteria })}
        />
        <div>
          <label className={labelCls}>
            <span>On error</span>
            <FieldHint text="Expected behavior when a step fails." />
          </label>
          <input
            className={inputCls}
            placeholder="halt and report the failing step"
            value={brief.onError}
            onChange={e => setBrief({ onError: e.target.value })}
          />
        </div>
        <p className="pt-3 border-t border-[var(--cl-line-soft)] font-mono text-[9.5px] leading-relaxed text-[var(--cl-ink-4)]">
          Every brief field is stored in the native workflow itself: runtime metadata in
          <code>meta</code>, supporting detail in readable script comments.
        </p>
      </div>
    </section>
  );
}

// ── Script panel / checks ────────────────────────────────────────────────────

function ChecksBar({
  issues,
  onSelectStep,
}: {
  issues: BlueprintIssue[];
  onSelectStep: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 py-3 border-t border-[var(--cl-line)] font-mono text-[10.5px]">
      <span className="text-[9.5px] tracking-[0.18em] text-[var(--cl-ink-4)]">
        DESIGN-TIME CHECKS
      </span>
      {issues.length === 0 ? (
        <>
          <span className="text-[var(--cl-ink-2)]">
            <span style={{ color: 'var(--cl-ok)' }}>✓</span> references resolve
          </span>
          <span className="text-[var(--cl-ink-2)]">
            <span style={{ color: 'var(--cl-ok)' }}>✓</span> no cycles
          </span>
          <span className="text-[var(--cl-ink-2)]">
            <span style={{ color: 'var(--cl-ok)' }}>✓</span> compiles clean
          </span>
        </>
      ) : (
        issues.map((issue, i) => (
          <button
            key={i}
            type="button"
            disabled={!issue.stepId}
            onClick={() => issue.stepId && onSelectStep(issue.stepId)}
            className="text-left text-[var(--cl-ink-2)] disabled:cursor-default"
          >
            <span
              style={{ color: issue.severity === 'error' ? 'var(--cl-danger)' : 'var(--cl-warn)' }}
            >
              {issue.severity === 'error' ? '✕' : '⚠'}
            </span>{' '}
            {issue.message}
          </button>
        ))
      )}
      <span className="ml-auto text-[var(--cl-ink-4)]">
        checked by Studio · runtime stays native
      </span>
    </div>
  );
}

function nodeKey(pi: number | 'pre', ni: number): string {
  return `${pi}:${ni}`;
}

function sameBlueprint(a: Blueprint, b: Blueprint): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface EditorDraft<T> {
  value: T;
  /** Native source this edit started from, used for optimistic concurrency. */
  baseSource: string;
}

// ── Main view ────────────────────────────────────────────────────────────────

export function BlueprintEditorView({
  name,
  projectPath,
  onBack,
}: {
  name: string;
  projectPath?: string;
  onBack: () => void;
}) {
  const { data: detail, isLoading, error, refetch } = useBlueprint(name, projectPath);
  const scopeCrumb = projectPath
    ? (projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath)
    : 'Global';
  const { data: agents } = useGlobalAgents();
  const save = useSaveBlueprint();
  const writeSource = useWriteNativeWorkflowScript();
  const del = useDeleteBlueprint();

  const [visualDraft, setVisualDraft] = useState<EditorDraft<Blueprint> | null>(null);
  const [tab, setTab] = useState<'brief' | 'flow' | 'canvas' | 'script'>('flow');
  const [sourceDraft, setSourceDraft] = useState<EditorDraft<string> | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [livePreview, setLivePreview] = useState<{
    script: string;
    issues: BlueprintIssue[];
  } | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [addMenuFor, setAddMenuFor] = useState<number | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The editable draft is DERIVED: local edits when present, else the parsed
  // native script (which stays watcher-live).
  const draft = visualDraft?.value ?? detail?.blueprint ?? null;
  const dirty =
    visualDraft !== null && !!detail && !sameBlueprint(visualDraft.value, detail.blueprint);
  const setDraft = (next: Blueprint) => {
    if (!detail || sameBlueprint(next, detail.blueprint)) {
      setVisualDraft(null);
      return;
    }
    setVisualDraft(current => ({
      value: next,
      baseSource: current?.baseSource ?? detail.source,
    }));
  };

  const discardVisualDraft = () => {
    setVisualDraft(null);
  };

  const discardSourceDraft = () => {
    setSourceDraft(null);
  };

  // Undoing back to the native value should remove the draft completely. The
  // same reconciliation also lets a watcher refresh retire a just-saved draft
  // without letting it reappear after a later external edit.
  useEffect(() => {
    if (visualDraft && detail && sameBlueprint(visualDraft.value, detail.blueprint)) {
      const matchedDraft = visualDraft;
      queueMicrotask(() => {
        setVisualDraft(current => (current === matchedDraft ? null : current));
      });
    }
  }, [visualDraft, detail]);

  useEffect(() => {
    if (sourceDraft && detail && sourceDraft.value === detail.source) {
      const matchedDraft = sourceDraft;
      queueMicrotask(() => {
        setSourceDraft(current => (current === matchedDraft ? null : current));
      });
    }
  }, [sourceDraft, detail]);

  // Debounced in-memory compile of the draft — the live "compiles to" panel.
  useEffect(() => {
    if (!visualDraft || !dirty) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void window.electronAPI.studio.preview(visualDraft.value).then(r => {
        if (!cancelled && r.data) setLivePreview(r.data);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visualDraft, dirty]);

  const serverPreview = detail ? { script: detail.source, issues: detail.issues } : null;
  const preview = dirty ? (livePreview ?? serverPreview) : serverPreview;

  const agentNames = useMemo(() => (agents ?? []).map(a => a.name), [agents]);
  const issues = preview?.issues ?? [];
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const sourceDirty = sourceDraft !== null && !!detail && sourceDraft.value !== detail.source;

  // Protect both editor models: visual changes live in `visualDraft`, while
  // direct script edits live in `sourceDraft`. Neither is persisted until the
  // corresponding Save action completes.
  useEffect(() => {
    if (!dirty && !sourceDirty) return;
    const preventAccidentalUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventAccidentalUnload);
    return () => window.removeEventListener('beforeunload', preventAccidentalUnload);
  }, [dirty, sourceDirty]);

  const requestBack = () => {
    if (
      (dirty || sourceDirty) &&
      !window.confirm('Discard the unsaved changes to this workflow?')
    ) {
      return;
    }
    onBack();
  };

  const activeTab = detail?.structured ? tab : 'script';
  const codeNodeCount = useMemo(
    () =>
      detail
        ? [
            ...(detail.blueprint.preamble ?? []),
            ...detail.blueprint.phases.flatMap(p => p.nodes),
          ].reduce(
            (count, n) =>
              count +
              (n.kind === 'code' ? 1 : 0) +
              (n.kind === 'pipeline' ? n.stages.filter(s => s.kind === 'code').length : 0),
            0
          )
        : 0,
    [detail]
  );
  const status =
    errorCount > 0
      ? 'invalid'
      : !detail?.structured
        ? 'source'
        : codeNodeCount > 0
          ? 'hybrid'
          : 'visual';
  const statusColor =
    errorCount > 0
      ? 'var(--cl-danger)'
      : detail?.structured
        ? codeNodeCount > 0
          ? 'var(--cl-accent)'
          : 'var(--cl-ok)'
        : 'var(--cl-ink-4)';

  if (error) {
    return (
      <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
        <TopBar onBack={requestBack} crumbs={[{ label: `${scopeCrumb} · Studio · ${name}` }]} />
        <section className="cl-section">
          <QueryError error={error} onRetry={() => void refetch()} />
        </section>
      </div>
    );
  }
  if (isLoading || !draft || !detail) {
    return (
      <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
        <TopBar onBack={requestBack} crumbs={[{ label: `${scopeCrumb} · Studio · ${name}` }]} />
        <section className="cl-section">
          <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
        </section>
      </div>
    );
  }

  const steps = allSteps(draft);
  // Cross-highlight state. Both sides go through the ref index, so a prompt
  // that reads a step by the variable the script binds (`${picked.number}`)
  // lights up the step whose label is `pick-issue` — id, compiled name and
  // result variable are three names for the same output.
  const refIndex = buildRefIndex(steps);
  const selectedStepObj = selectedStep ? (steps.find(s => s.id === selectedStep) ?? null) : null;
  const selectedRefs: ReadonlySet<string> = new Set(
    (selectedStepObj ? promptRefs(selectedStepObj.prompt) : []).flatMap(ref => {
      const target = resolveRef(refIndex, ref);
      return target ? [target] : [];
    })
  );
  const inputsHint = draft.brief.inputs.length
    ? ` <${draft.brief.inputs.map(i => i.name || '…').join('> <')}>`
    : '';

  const updateStep = (id: string, patch: Partial<BlueprintStep>) => {
    setDraft({
      ...draft,
      preamble: draft.preamble ? patchStepInNodes(draft.preamble, id, patch) : draft.preamble,
      phases: draft.phases.map(p => ({ ...p, nodes: patchStepInNodes(p.nodes, id, patch) })),
    });
    if (patch.id) setSelectedStep(patch.id);
  };

  const removeStep = (id: string) => {
    setDraft({
      ...draft,
      preamble: draft.preamble ? removeStepInNodes(draft.preamble, id) : draft.preamble,
      phases: draft.phases.map(p => ({ ...p, nodes: removeStepInNodes(p.nodes, id) })),
    });
    setSelectedStep(null);
  };

  const addStep = (phaseIndex: number, parallel: boolean) => {
    const id = nextStepId(draft);
    setDraft({
      ...draft,
      phases: draft.phases.map((p, i) => {
        if (i !== phaseIndex) return p;
        if (!parallel) {
          return { ...p, nodes: [...p.nodes, { kind: 'step', step: { id, prompt: '' } }] };
        }
        const lastParallel = [...p.nodes].reverse().find(n => n.kind === 'parallel');
        if (lastParallel && lastParallel.kind === 'parallel') {
          return {
            ...p,
            nodes: p.nodes.map(n =>
              n === lastParallel ? { ...n, steps: [...n.steps, { id, prompt: '' }] } : n
            ),
          };
        }
        return { ...p, nodes: [...p.nodes, { kind: 'parallel', steps: [{ id, prompt: '' }] }] };
      }),
    });
    setSelectedStep(id);
  };

  const addNode = (phaseIndex: number, make: (id: string) => BlueprintNode, select = true) => {
    const id = nextStepId(draft);
    setDraft({
      ...draft,
      phases: draft.phases.map((p, i) =>
        i === phaseIndex ? { ...p, nodes: [...p.nodes, make(id)] } : p
      ),
    });
    if (select) setSelectedStep(id);
  };

  /** `plan` → `plan-copy` (deduped) for duplicated steps. */
  const copyId = (base: string): string => {
    const ids = new Set(steps.map(s => s.id));
    let id = `${base}-copy`;
    let n = 2;
    while (ids.has(id)) id = `${base}-copy-${n++}`;
    return id;
  };

  const duplicateStep = (id: string) => {
    const source = steps.find(s => s.id === id);
    if (!source) return;
    const newId = copyId(id);
    const clone: BlueprintStep = structuredClone({ ...source, id: newId });
    delete clone.resultVar; // the copy's variable derives from its new id
    const dupInNodes = (nodes: BlueprintNode[]): BlueprintNode[] =>
      nodes.flatMap<BlueprintNode>(node => {
        if (node.kind === 'step' && node.step.id === id) {
          return [node, { kind: 'step', step: clone }];
        }
        if (node.kind === 'parallel' && node.steps.some(s => s.id === id)) {
          const at = node.steps.findIndex(s => s.id === id);
          const parallelSteps = [...node.steps];
          parallelSteps.splice(at + 1, 0, clone);
          return [{ ...node, steps: parallelSteps }];
        }
        if (node.kind === 'pipeline') {
          const at = node.stages.findIndex(s => s.kind === 'agent' && s.step.id === id);
          if (at >= 0) {
            const original = node.stages[at];
            if (original.kind === 'agent') {
              const stages = [...node.stages];
              stages.splice(at + 1, 0, { ...original, step: clone });
              return [{ ...node, stages }];
            }
          }
        }
        return [node];
      });
    setDraft({
      ...draft,
      preamble: draft.preamble ? dupInNodes(draft.preamble) : draft.preamble,
      phases: draft.phases.map(p => ({ ...p, nodes: dupInNodes(p.nodes) })),
    });
    setSelectedStep(newId);
  };

  const nodesOf = (pi: number | 'pre'): BlueprintNode[] =>
    pi === 'pre' ? (draft.preamble ?? []) : draft.phases[pi].nodes;

  const setNodes = (pi: number | 'pre', nodes: BlueprintNode[]) => {
    if (pi === 'pre') setDraft({ ...draft, preamble: nodes });
    else
      setDraft({
        ...draft,
        phases: draft.phases.map((p, i) => (i === pi ? { ...p, nodes } : p)),
      });
  };

  const moveNode = (pi: number | 'pre', ni: number, delta: -1 | 1) => {
    const nodes = [...nodesOf(pi)];
    const j = ni + delta;
    if (j < 0 || j >= nodes.length) return;
    [nodes[ni], nodes[j]] = [nodes[j], nodes[ni]];
    setNodes(pi, nodes);
  };

  const removeNodeAt = (pi: number | 'pre', ni: number) => {
    setNodes(
      pi,
      nodesOf(pi).filter((_, j) => j !== ni)
    );
  };

  const updateNode = (pi: number | 'pre', ni: number, next: BlueprintNode) => {
    if (pi === 'pre') {
      setDraft({
        ...draft,
        preamble: (draft.preamble ?? []).map((n, j) => (j === ni ? next : n)),
      });
      return;
    }
    setDraft({
      ...draft,
      phases: draft.phases.map((p, i) =>
        i === pi ? { ...p, nodes: p.nodes.map((n, j) => (j === ni ? next : n)) } : p
      ),
    });
  };

  const updatePhase = (i: number, patch: Partial<BlueprintPhase>) => {
    setDraft({ ...draft, phases: draft.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  };

  const movePhase = (i: number, delta: -1 | 1) => {
    const phases = [...draft.phases];
    const j = i + delta;
    if (j < 0 || j >= phases.length) return;
    [phases[i], phases[j]] = [phases[j], phases[i]];
    setDraft({ ...draft, phases });
  };

  const removePhase = (i: number) => {
    setDraft({ ...draft, phases: draft.phases.filter((_, j) => j !== i) });
    setSelectedStep(null);
  };

  const addPhase = () => {
    setDraft({
      ...draft,
      phases: [...draft.phases, { title: `Phase ${draft.phases.length + 1}`, nodes: [] }],
    });
  };

  async function handleSave(): Promise<boolean> {
    if (!draft || !detail) return false;
    const savedDraft = draft;
    setActionError(null);
    try {
      const result = await save.mutateAsync({
        input: draft,
        fileName: detail.fileName,
        projectPath,
        expectedSource: visualDraft?.baseSource ?? detail.source,
      });
      // The mutation waits for the fresh query snapshot. Preserve any newer
      // edits made while it was pending and rebase only those onto what won.
      setVisualDraft(current =>
        current && !sameBlueprint(current.value, savedDraft)
          ? { ...current, baseSource: result.script }
          : null
      );
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      void refetch();
      return false;
    }
  }

  async function handleSourceSave() {
    if (!sourceDirty || sourceDraft === null) return;
    const savedSource = sourceDraft.value;
    const visualDraftAtSave = visualDraft;
    setActionError(null);
    try {
      await writeSource.mutateAsync({
        fileName: detail.fileName,
        content: savedSource,
        projectPath,
        expectedSource: sourceDraft.baseSource,
      });
      setSourceDraft(current =>
        current && current.value !== savedSource ? { ...current, baseSource: savedSource } : null
      );
      // A source save supersedes the visual draft that existed when it began,
      // but never drops a new visual edit made while the save was pending.
      setVisualDraft(current => (current === visualDraftAtSave ? null : current));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      void refetch();
    }
  }

  async function handleDelete() {
    if (!detail) return;
    setActionError(null);
    try {
      await del.mutateAsync({ name: detail.fileName, alsoScript: true, projectPath });
      onBack();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  const agentBlock = (
    step: BlueprintStep,
    kicker: string | undefined,
    earlierIds: string[],
    opts: { showOut?: boolean; nested?: boolean; inPipeline?: boolean } = {}
  ) => (
    <div key={step.id}>
      <AgentCard
        step={step}
        kicker={kicker}
        showOut={opts.showOut ?? true}
        nested={opts.nested ?? false}
        selected={selectedStep === step.id}
        selectedId={selectedStep}
        selectedRefs={selectedRefs}
        refIndex={refIndex}
        onSelect={() => setSelectedStep(selectedStep === step.id ? null : step.id)}
      />
      {selectedStep === step.id && (
        <StepInspector
          step={step}
          agentNames={agentNames}
          refIds={earlierIds}
          inPipeline={opts.inPipeline ?? false}
          nested={opts.nested ?? false}
          onChange={patch => updateStep(step.id, patch)}
          onDuplicate={() => duplicateStep(step.id)}
          onRemove={() => removeStep(step.id)}
        />
      )}
    </div>
  );

  const groupBadge = (label: string) => (
    <span
      className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 border"
      style={{ color: 'var(--cl-accent-ink)', borderColor: 'var(--cl-accent)' }}
    >
      {label}
    </span>
  );

  /** Hover controls on a top-level node: move up/down, and remove for notes. */
  const nodeControls = (pi: number | 'pre', ni: number, count: number, removable: boolean) => (
    <span className="absolute right-1.5 top-1.5 z-10 hidden group-hover:flex gap-0.5">
      {(
        [
          ['↑', 'Move up', -1],
          ['↓', 'Move down', 1],
        ] as const
      ).map(([glyph, title, delta]) => (
        <button
          key={glyph}
          type="button"
          title={title}
          disabled={delta === -1 ? ni === 0 : ni === count - 1}
          onClick={() => moveNode(pi, ni, delta)}
          className="w-6 h-6 grid place-items-center border border-[var(--cl-line)] bg-[var(--cl-paper)] font-mono text-[10px] text-[var(--cl-ink-3)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink-2)] disabled:opacity-30 disabled:hover:text-[var(--cl-ink-3)] disabled:hover:border-[var(--cl-line)] transition-colors"
        >
          {glyph}
        </button>
      ))}
      {removable && (
        <button
          type="button"
          title="Remove note"
          onClick={() => removeNodeAt(pi, ni)}
          className="w-6 h-6 grid place-items-center border border-[var(--cl-line)] bg-[var(--cl-paper)] font-mono text-[10px] text-[var(--cl-ink-3)] hover:text-[var(--cl-danger)] hover:border-[var(--cl-danger)] transition-colors"
        >
          ✕
        </button>
      )}
    </span>
  );

  const renderNodes = (nodes: BlueprintNode[], pi: number | 'pre', earlierIds: string[]) => {
    const seen = [...earlierIds];
    return nodes.map((node, ni) => {
      const key = nodeKey(pi, ni);
      let el: React.ReactNode;
      if (node.kind === 'step') {
        el = agentBlock(node.step, undefined, [...seen]);
        seen.push(node.step.id);
      } else if (node.kind === 'parallel') {
        el = (
          <div className="relative pl-10 py-2.5">
            <SpineMarker kind="group" />
            <div className="border border-[var(--cl-line)] bg-[var(--cl-paper-2)]">
              <div
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pt-3 pb-2.5"
                style={{ borderBottom: '1px solid var(--cl-line-soft)' }}
              >
                {groupBadge('In parallel')}
                <span className="text-[12px] text-[var(--cl-ink-3)]">
                  {node.steps.length} agents at once — every output below is a separate result
                </span>
              </div>
              <div className="divide-y divide-[var(--cl-line-soft)]">
                {node.steps.map(step => agentBlock(step, 'parallel', [...seen], { nested: true }))}
              </div>
            </div>
          </div>
        );
        for (const s of node.steps) seen.push(s.id);
      } else if (node.kind === 'log') {
        el = (
          <LogNote
            message={node.message}
            onChange={message => updateNode(pi, ni, { ...node, message })}
          />
        );
      } else if (node.kind === 'code') {
        el = (
          <CodeNote
            source={node.source}
            onChange={source => updateNode(pi, ni, { ...node, source })}
          />
        );
      } else {
        // pipeline: a for-each box — stages run per item, results collect into one array
        el = (
          <div className="relative pl-10 py-2.5">
            <SpineMarker kind="group" />
            <div className="border border-[var(--cl-line)] bg-[var(--cl-paper-2)]">
              <div
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-3 pb-2.5"
                style={{ borderBottom: '1px solid var(--cl-line-soft)' }}
              >
                {groupBadge('For each')}
                <span className="text-[12px] text-[var(--cl-ink-3)]">item in</span>
                <input
                  className="font-mono text-[11px] px-1.5 py-[1px] border border-[var(--cl-line)] bg-[var(--cl-paper)] text-[var(--cl-ink)] outline-none focus:border-[var(--cl-ink)] transition-colors"
                  style={{ width: `${Math.max(8, node.itemsSource.length + 1)}ch` }}
                  value={node.itemsSource}
                  onChange={e => updateNode(pi, ni, { ...node, itemsSource: e.target.value })}
                  aria-label="Pipeline items expression"
                  title="The list expression the stages run over"
                />
                <span className="text-[12px] text-[var(--cl-ink-3)]">
                  — one agent per item, items run in parallel
                </span>
              </div>
              <div className="divide-y divide-[var(--cl-line-soft)]">
                {node.stages.map((stage, si) =>
                  stage.kind === 'agent' ? (
                    <div key={si}>
                      {agentBlock(stage.step, 'per item', [...seen], {
                        showOut: false,
                        nested: true,
                        inPipeline: true,
                      })}
                    </div>
                  ) : (
                    <CodeNote
                      key={si}
                      source={stage.source}
                      tagOverride="then"
                      nested
                      onChange={source =>
                        updateNode(pi, ni, {
                          ...node,
                          stages: node.stages.map((s, j) =>
                            j === si ? { kind: 'code', source } : s
                          ),
                        })
                      }
                    />
                  )
                )}
              </div>
              {node.resultVar && (
                <div
                  className="flex flex-wrap items-center gap-1.5 px-4 py-2 font-mono text-[10px]"
                  style={{ borderTop: '1px solid var(--cl-line-soft)' }}
                >
                  <span
                    className="uppercase tracking-[0.14em]"
                    style={{ color: 'var(--cl-accent-ink)' }}
                  >
                    collects
                  </span>
                  <RefChip
                    token={node.resultVar}
                    dollar={false}
                    title="The variable holding the pipeline results"
                  />
                  <span className="text-[var(--cl-ink-4)]">
                    array — one result per item, available to later code
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      }
      return (
        <div key={key} className="relative group">
          {el}
          {nodeControls(pi, ni, nodes.length, node.kind === 'log')}
        </div>
      );
    });
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={requestBack} crumbs={[{ label: `${scopeCrumb} · Studio · ${draft.name}` }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero" style={{ paddingTop: 28 }}>
          <div className="cl-eyebrow">
            <span className="pip" style={{ background: statusColor }} />
            <span>
              Agent Studio · Native workflow · {status}
              {dirty || sourceDirty ? ' · unsaved' : ''}
            </span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">{draft.name}</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-hero-actions">
            {activeTab !== 'script' && dirty && (
              <button type="button" className="cl-btn" onClick={discardVisualDraft}>
                Discard
              </button>
            )}
            {activeTab !== 'script' && detail.structured && (
              <button
                type="button"
                className="cl-btn cl-btn--primary"
                disabled={!dirty || save.isPending || errorCount > 0}
                onClick={() => void handleSave()}
              >
                Save script
              </button>
            )}
            {activeTab === 'script' && sourceDirty && (
              <button type="button" className="cl-btn" onClick={discardSourceDraft}>
                Discard
              </button>
            )}
            {activeTab === 'script' && (
              <button
                type="button"
                className="cl-btn cl-btn--primary"
                disabled={!sourceDirty || writeSource.isPending}
                onClick={() => void handleSourceSave()}
              >
                Save script
              </button>
            )}
            <button type="button" className="cl-btn" onClick={() => setRunOpen(o => !o)}>
              Run
            </button>
            <button type="button" className="cl-btn" onClick={() => setDeleteArmed(a => !a)}>
              Delete
            </button>
          </div>
          <div className="cl-h-meta">
            <span>
              <b>{steps.length}</b> {steps.length === 1 ? 'agent' : 'agents'}
            </span>
            <span className="sep">·</span>
            <span>
              <b>{draft.phases.length}</b> phases
            </span>
            {codeNodeCount > 0 && (
              <>
                <span className="sep">·</span>
                <span>
                  <b>{codeNodeCount}</b> code {codeNodeCount === 1 ? 'block' : 'blocks'}
                </span>
              </>
            )}
            <span className="sep">·</span>
            <span>
              source{' '}
              <span className="font-mono" style={{ color: 'var(--cl-accent-ink)', fontSize: 12 }}>
                {detail.scriptPath}
              </span>
            </span>
          </div>
          {actionError && (
            <p className="mt-3 font-mono text-[11px] text-[var(--cl-danger)]">{actionError}</p>
          )}
          {deleteArmed && (
            <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-[var(--cl-ink-2)]">
              <span>Delete this workflow script?</span>
              <button type="button" className="cl-btn" onClick={() => void handleDelete()}>
                Delete script
              </button>
              <button type="button" className="cl-btn" onClick={() => setDeleteArmed(false)}>
                Cancel
              </button>
            </div>
          )}
          {runOpen && (
            <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-[var(--cl-ink-2)]">
              <span>Run it from any Claude Code session:</span>
              <code className="px-2.5 py-1 border border-[var(--cl-line)] bg-[var(--cl-paper-2)] text-[var(--cl-accent-ink)]">
                /{draft.name}
                {inputsHint}
              </code>
              <button
                type="button"
                className="cl-btn"
                onClick={() => void navigator.clipboard.writeText(`/${draft.name}`)}
              >
                Copy
              </button>
              {dirty || sourceDirty ? (
                <span style={{ color: 'var(--cl-warn)' }}>save first</span>
              ) : null}
            </div>
          )}
        </section>

        <div className="cl-subtabs">
          <button
            type="button"
            className={`cl-subtab ${activeTab === 'brief' ? 'on' : ''}`}
            disabled={!detail.structured || sourceDirty}
            onClick={() => setTab('brief')}
          >
            Brief
          </button>
          <button
            type="button"
            className={`cl-subtab ${activeTab === 'flow' ? 'on' : ''}`}
            disabled={!detail.structured || sourceDirty}
            onClick={() => setTab('flow')}
          >
            Flow <span className="ct">{steps.length}</span>
          </button>
          <button
            type="button"
            className={`cl-subtab ${activeTab === 'canvas' ? 'on' : ''}`}
            disabled={!detail.structured || sourceDirty}
            onClick={() => setTab('canvas')}
          >
            Canvas
          </button>
          <button
            type="button"
            className={`cl-subtab ${activeTab === 'script' ? 'on' : ''}`}
            onClick={() => setTab('script')}
          >
            Script
          </button>
        </div>

        {activeTab === 'brief' && <BriefTab draft={draft} onChange={setDraft} />}

        {activeTab === 'flow' && (
          <section className="cl-section" style={{ paddingTop: 20, paddingBottom: 60 }}>
            <div>
              <div className="max-w-[960px]">
                {(draft.preamble ?? []).length > 0 && (
                  <div className="mb-5">
                    <div
                      className="px-1 pb-1.5"
                      style={{ borderBottom: '1px solid var(--cl-line)' }}
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cl-ink-4)]">
                        Setup
                      </span>
                      <span className="ml-3 font-mono text-[10.5px] text-[var(--cl-ink-4)]">
                        prepared before the first phase — inputs and defaults
                      </span>
                    </div>
                    <SpineRail>{renderNodes(draft.preamble ?? [], 'pre', [])}</SpineRail>
                  </div>
                )}
                {draft.phases.map((phase, pi) => {
                  const earlierIds = draft.phases
                    .slice(0, pi)
                    .flatMap(p => phaseStepsOf(p).map(s => s.id));
                  return (
                    <div key={pi} className="mb-5">
                      <div
                        className="grid items-start gap-x-4 px-1 pb-2"
                        style={{
                          gridTemplateColumns: 'minmax(0,1fr) auto',
                          borderBottom: '1px solid var(--cl-ink)',
                        }}
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cl-ink-4)]">
                            Phase {pi + 1}
                          </div>
                          <input
                            className="w-full bg-transparent border-none outline-none text-[17px] font-semibold tracking-[-0.015em] text-[var(--cl-ink)] focus:text-[var(--cl-accent-ink)]"
                            value={phase.title}
                            placeholder="Phase title"
                            onChange={e => updatePhase(pi, { title: e.target.value })}
                          />
                          <input
                            className="w-full bg-transparent border-none outline-none text-[12.5px] text-[var(--cl-ink-3)] placeholder:text-[var(--cl-ink-4)] italic"
                            value={phase.detail ?? ''}
                            placeholder="What this phase does — shown in the run progress"
                            onChange={e => updatePhase(pi, { detail: e.target.value || undefined })}
                          />
                        </div>
                        <span className="flex gap-1 pt-1">
                          <button
                            type="button"
                            className="cl-btn"
                            title="Move phase up"
                            onClick={() => movePhase(pi, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="cl-btn"
                            title="Move phase down"
                            onClick={() => movePhase(pi, 1)}
                          >
                            ↓
                          </button>
                          <span className="relative">
                            <button
                              type="button"
                              className="cl-btn"
                              title="Add a node to this phase"
                              onClick={() => setAddMenuFor(open => (open === pi ? null : pi))}
                            >
                              + add ▾
                            </button>
                            {addMenuFor === pi && (
                              <>
                                <span
                                  className="fixed inset-0 z-10"
                                  onClick={() => setAddMenuFor(null)}
                                />
                                <span className="absolute right-0 top-full mt-1 z-20 flex flex-col min-w-[230px] border border-[var(--cl-line)] bg-[var(--cl-paper)] shadow-lg">
                                  {(
                                    [
                                      [
                                        'agent',
                                        'runs after the previous node',
                                        () => addStep(pi, false),
                                      ],
                                      [
                                        'parallel agent',
                                        'runs at the same time as its siblings',
                                        () => addStep(pi, true),
                                      ],
                                      [
                                        'for-each',
                                        'one agent per item of a list',
                                        () =>
                                          addNode(pi, id => ({
                                            kind: 'pipeline',
                                            resultVar: null,
                                            itemsSource: 'items',
                                            stages: [
                                              {
                                                kind: 'agent',
                                                params: 'item',
                                                step: { id, prompt: '' },
                                              },
                                            ],
                                          })),
                                      ],
                                      [
                                        'progress note',
                                        'log() line shown while the run progresses',
                                        () =>
                                          addNode(pi, () => ({ kind: 'log', message: '' }), false),
                                      ],
                                    ] as const
                                  ).map(([label, hint, run]) => (
                                    <button
                                      key={label}
                                      type="button"
                                      className="text-left px-3 py-2 hover:bg-[var(--cl-paper-2)] transition-colors"
                                      onClick={() => {
                                        run();
                                        setAddMenuFor(null);
                                      }}
                                    >
                                      <span className="block font-mono text-[11px] text-[var(--cl-ink)]">
                                        + {label}
                                      </span>
                                      <span className="block text-[11px] text-[var(--cl-ink-4)]">
                                        {hint}
                                      </span>
                                    </button>
                                  ))}
                                </span>
                              </>
                            )}
                          </span>
                          <button
                            type="button"
                            className="cl-btn"
                            title="Remove phase"
                            onClick={() => removePhase(pi)}
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                      <SpineRail>{renderNodes(phase.nodes, pi, earlierIds)}</SpineRail>
                      {phase.nodes.length === 0 && (
                        <div className="px-1 py-3 font-mono text-[10.5px] text-[var(--cl-ink-4)]">
                          Empty phase — use “+ add” to insert an agent, or remove it.
                        </div>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={addPhase}
                  className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-full border border-dashed border-[var(--cl-ink-4)] font-mono text-[10.5px] text-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)] hover:border-[var(--cl-ink-2)] transition-colors"
                >
                  + add phase
                </button>
                <ChecksBar
                  issues={issues}
                  onSelectStep={id => {
                    setTab('flow');
                    setSelectedStep(id);
                  }}
                />
              </div>
            </div>
          </section>
        )}

        {activeTab === 'canvas' && (
          <StudioCanvasFlow
            draft={draft}
            agentNames={agentNames}
            issues={issues}
            selectedStep={selectedStep}
            setSelectedStep={setSelectedStep}
            handlers={{
              updateStep,
              removeStep,
              duplicateStep,
              addStep,
              addNode,
              moveNode,
              removeNodeAt,
              updateNode,
              updatePhase,
              movePhase,
              removePhase,
              addPhase,
            }}
          />
        )}

        {activeTab === 'script' && (
          <section className="cl-section" style={{ paddingTop: 20, paddingBottom: 60 }}>
            <div className="cl-sec-head">
              <h2>Native script</h2>
              <span className="ct">single source of truth · {detail.fileName}</span>
              <button
                type="button"
                className="all"
                onClick={() =>
                  void navigator.clipboard.writeText(sourceDraft?.value ?? detail.source)
                }
              >
                Copy script
              </button>
            </div>
            {!detail.structured && (
              <div className="mb-4 border border-[var(--cl-line)] px-4 py-3 font-mono text-[10.5px] leading-relaxed text-[var(--cl-ink-3)]">
                This script cannot be represented safely in the visual editor, so Brief, Flow and
                Canvas are unavailable. Edit the native source directly to preserve its behavior.
                {detail.parseError ? ` Reason: ${detail.parseError}` : ''}
              </div>
            )}
            <SourceEditor
              value={sourceDraft?.value ?? detail.source}
              onChange={next =>
                setSourceDraft(current =>
                  next === detail.source
                    ? null
                    : { value: next, baseSource: current?.baseSource ?? detail.source }
                )
              }
              ariaLabel={`Source for ${detail.fileName}`}
            />
            <p className="pt-3 font-mono text-[9.5px] leading-relaxed text-[var(--cl-ink-4)]">
              The visual views are parsed from this exact file when it can be round-tripped safely.
              Other scripts stay source-only. Saving writes this native workflow directly;
              ClaudeLens stores no parallel manifest.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
