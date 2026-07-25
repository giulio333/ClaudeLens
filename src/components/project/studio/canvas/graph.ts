// Pure, unit-tested derivation of the Agent Studio "Canvas" read-model. The
// native workflow is a barrier model — ordered phases, each an ordered list of
// nodes — so the Canvas is a projection of that model, never a free DAG:
//   • column x  = phase index (preamble → column 0 "Setup")
//   • row    y  = source order within the phase (deterministic auto-layout)
//   • edges     = data dependencies DERIVED from `${ref}` interpolation and
//                 identifier use in verbatim code. A guard has no outgoing edge:
//                 it is a distinct early termination, not a feeder of the output.
//                 The OUTPUT block has no INCOMING edges either: a final return
//                 composes most of the flow, so it declares its inputs in the
//                 pill (`returnTokens`) instead of dragging a line across every
//                 column to say what "terminal" already says.
// Nothing here is persisted; `saveBlueprint`/round-trip are untouched. React
// never appears in this file — it is the testable heart of the Canvas.

import type {
  Blueprint,
  BlueprintNode,
  BlueprintPhase,
  BlueprintStep,
  PipelineStage,
} from '../../../../types';
import type { SchemaNodeModel } from '../../../../../electron/shared/studio-schema';
import {
  describeCode,
  guardCondition,
  promptRefs,
  scanIdentifiers,
  stepRefKeys,
  stepVarName,
} from '../studioLang';

export type CanvasBlockKind =
  'agent' | 'parallel' | 'foreach' | 'guard' | 'output' | 'setup' | 'log' | 'code' | 'schema';

/** Locates a node in the Blueprint for edit dispatch. `pi = 'pre'` = preamble. */
export interface NodeRef {
  pi: number | 'pre';
  ni: number;
}

export interface CanvasMember {
  step: BlueprintStep;
  /** Upstream step ids available to this step's prompt (for StepInspector). */
  refIds: string[];
}

export interface CanvasPipelineStage {
  kind: 'agent' | 'code';
  stageIndex: number;
  step?: BlueprintStep;
  params?: string;
  source?: string;
  refIds?: string[];
}

export interface PositionedBlock {
  id: string;
  kind: CanvasBlockKind;
  /** Column index used for x (0 = first column). */
  col: number;
  /** Source phase index, `'pre'` for the preamble, or null for a synthetic block. */
  phase: number | 'pre' | null;
  x: number;
  y: number;
  w: number;
  h: number;
  nodeRef: NodeRef | null;
  // ── kind-specific render payload ──
  step?: BlueprintStep;
  refIds?: string[];
  members?: CanvasMember[];
  pipeline?: { itemsSource: string; resultVar: string | null; stages: CanvasPipelineStage[] };
  source?: string;
  /** For a `schema` block: the editable projection of the schema literal. */
  schemaModel?: SchemaNodeModel;
  /** For a `schema` block written on a call: the step whose `agent()` carries it. */
  schemaOwnerStepId?: string;
  /** For a `schema` block with no node of its own: the consumer it is parked under. */
  schemaOwnerBlockId?: string;
  message?: string;
  tag?: string;
  /** Display tokens this block exposes to downstream consumers. */
  produces: string[];
  /** For an `output` block: the producers its return composes, shown inside the pill. */
  returnTokens?: string[];
  /** Short label (e.g. output block "returns finalize"). */
  label?: string;
}

export type CanvasEdgeKind = 'data' | 'schema';

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  kind: CanvasEdgeKind;
  label?: string;
}

export interface CanvasColumn {
  index: number;
  title: string;
  phase: number | 'pre';
  blockIds: string[];
}

export interface CanvasGraph {
  blocks: PositionedBlock[];
  edges: CanvasEdge[];
  columns: CanvasColumn[];
  bounds: { w: number; h: number };
}

// ── Layout constants (compact density — the Canvas default) ───────────────────

const PAD = 40;
const COL_W = 300;
const COL_GAP = 104;
const BLOCK_GAP = 22;

// Heights tuned for the "clean lanes" canvas (design 1a): essential cards with
// a monogram row + two mono lines. Containers stay compact; the OUTPUT block is
// a floating pill, and a for-each collapses to a single card (its stages open in
// the inspector) instead of expanding every stage inline.
//
// Verbatim JS (setup / guard / log / code) is NOT a card: it is a one-line
// annotation on the lane — the same rule the Flow spine already follows, where
// agent cards are the only large objects. A fixed card height with free-form
// source inside can only truncate mid-glyph; one line with a real ellipsis
// cannot, and the full text lives in the inspector (and the row's tooltip).
const ROW = 44;
const H = {
  agent: 118,
  guard: ROW,
  output: 48,
  setup: ROW,
  log: ROW,
  code: ROW,
  foreach: 132,
  parHead: 50,
  parMember: 52,
} as const;

const OUTPUT_ID = '__output__';

function colX(col: number): number {
  return PAD + col * (COL_W + COL_GAP);
}

// ── Classification ────────────────────────────────────────────────────────────

function nodeBlockKind(node: BlueprintNode): CanvasBlockKind {
  switch (node.kind) {
    case 'step':
      return 'agent';
    case 'parallel':
      return 'parallel';
    case 'pipeline':
      return 'foreach';
    case 'log':
      return 'log';
    case 'code': {
      const tag = describeCode(node.source).tag;
      if (tag === 'guard') return 'guard';
      if (tag === 'result') return 'output';
      if (tag === 'setup') return 'setup';
      return 'code';
    }
  }
}

/** Sized to content: header + summary line, plus one row for the field chips. */
function schemaHeight(fieldCount: number): number {
  return fieldCount > 0 ? 130 : 94;
}

function blockHeight(kind: CanvasBlockKind, node: BlueprintNode): number {
  if (kind === 'parallel' && node.kind === 'parallel') {
    return H.parHead + node.steps.length * H.parMember;
  }
  if (kind === 'foreach') return H.foreach;
  if (kind === 'schema') {
    return schemaHeight(node.kind === 'code' ? (node.schemaModel?.children?.length ?? 0) : 0);
  }
  return H[kind as 'agent' | 'guard' | 'output' | 'setup' | 'log' | 'code'] ?? H.code;
}

/** `const/let/var` bindings (incl. simple array/object destructuring) declared by a code node. */
function declaredVars(source: string): string[] {
  const out: string[] = [];
  const re = /\b(?:const|let|var)\s+(\[[^\]]*\]|\{[^}]*\}|[A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const binding = m[1];
    if (binding.startsWith('[') || binding.startsWith('{')) {
      for (const part of binding.slice(1, -1).split(',')) {
        const name = part.trim().split(':').pop() ?? '';
        const clean = /^[A-Za-z_$][\w$]*/.exec(name.replace(/^\.\.\./, '').trim())?.[0];
        if (clean) out.push(clean);
      }
    } else {
      out.push(binding);
    }
  }
  return out;
}

function leadingIdent(expr: string): string | null {
  return /^\s*([A-Za-z_$][A-Za-z0-9_$]*)/.exec(expr)?.[1] ?? null;
}

const SCHEMA_IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/** A step's `schema:` option when it's a bare identifier (a shared const), else null. */
function schemaIdentOf(step: BlueprintStep): string | null {
  const s = step.schemaSource?.trim();
  return s && SCHEMA_IDENT_RE.test(s) ? s : null;
}

/** Every agent step a node carries (itself, its parallel members, its stages). */
function stepsOf(node: BlueprintNode): BlueprintStep[] {
  if (node.kind === 'step') return [node.step];
  if (node.kind === 'parallel') return node.steps;
  if (node.kind === 'pipeline')
    return node.stages.flatMap(s => (s.kind === 'agent' ? [s.step] : []));
  return [];
}

/**
 * One agent's declared structured output. The `schema:` option IS the signal —
 * how it is written only decides WHERE the definition is read from, never
 * whether the Canvas shows it. `name` is the shared const it points at (null for
 * a literal written on the call), and doubles as the identity key: agents
 * pointing at the same const share one card, a literal belongs to its agent.
 */
interface SchemaUse {
  key: string;
  name: string | null;
  step: BlueprintStep;
  /** Block that runs the agent (the container, for a parallel/pipeline member). */
  consumerId: string;
}

function schemaUseOf(step: BlueprintStep, consumerId: string): SchemaUse | null {
  if (!step.schemaSource?.trim()) return null;
  const name = schemaIdentOf(step);
  return { key: name ?? `literal@${step.id}`, name, step, consumerId };
}

// ── Build ─────────────────────────────────────────────────────────────────────

export function buildGraph(bp: Blueprint): CanvasGraph {
  const blocks: PositionedBlock[] = [];
  const columns: CanvasColumn[] = [];

  // Producer index: every key a downstream consumer might use (the step id, its
  // compiled var name AND the parsed `resultVar`, or a pipeline's collect
  // variable) → the block id that exposes it. A prompt refs the id form
  // (`${security-check}`); a code node uses the compiled form (`securityCheck`);
  // a parsed native script refs the variable the source actually binds
  // (`label: 'pick-issue'` → `const picked = …` → `${picked.number}`) — all
  // three resolve to the same block.
  const producersByKey = new Map<string, string>();
  const registerProducer = (blockId: string, keys: string[]) => {
    for (const key of keys) if (key && !producersByKey.has(key)) producersByKey.set(key, blockId);
  };

  // Upstream step ids in source order, snapshotted per step for the inspector.
  const seenIds: string[] = [];

  const columnSources: { phase: number | 'pre'; title: string; nodes: BlueprintNode[] }[] = [];
  if ((bp.preamble ?? []).length > 0) {
    columnSources.push({ phase: 'pre', title: 'Setup', nodes: bp.preamble ?? [] });
  }
  bp.phases.forEach((phase: BlueprintPhase, pi) => {
    columnSources.push({ phase: pi, title: phase.title || `Phase ${pi + 1}`, nodes: phase.nodes });
  });

  // Schema identifiers referenced by any agent via `schema: X` (X a bare const).
  // A code node that declares one of these is the schema's own block instead of
  // an anonymous setup/code note — so the definition is edited where the script
  // actually declares it, and every consumer is wired to that one card.
  const referencedSchemaIds = new Set<string>();
  for (const column of columnSources) {
    for (const node of column.nodes) {
      for (const step of stepsOf(node)) {
        const id = schemaIdentOf(step);
        if (id) referencedSchemaIds.add(id);
      }
    }
  }
  const schemaProducers = new Map<string, string>(); // schema id → declaring block id
  const schemaUses: SchemaUse[] = [];

  // First pass: create blocks (unpositioned) and register producers. Consumers
  // are wired in the second pass once every producer key exists.
  columnSources.forEach((column, col) => {
    const blockIds: string[] = [];
    column.nodes.forEach((node, ni) => {
      let kind = nodeBlockKind(node);
      // A verbatim const that defines a schema referenced by an agent is a
      // first-class `schema` block, not an anonymous setup/code note.
      if (
        node.kind === 'code' &&
        (kind === 'setup' || kind === 'code') &&
        declaredVars(node.source).some(v => referencedSchemaIds.has(v))
      ) {
        kind = 'schema';
      }
      const id = `${column.phase}:${ni}`;
      const nodeRef: NodeRef = { pi: column.phase, ni };
      const base: PositionedBlock = {
        id,
        kind,
        col,
        phase: column.phase,
        x: 0,
        y: 0,
        w: COL_W,
        h: blockHeight(kind, node),
        nodeRef,
        produces: [],
      };

      if (node.kind === 'step') {
        base.step = node.step;
        base.refIds = [...seenIds];
        base.produces = [node.step.resultVar ?? node.step.id];
        registerProducer(id, stepRefKeys(node.step));
        seenIds.push(node.step.id);
      } else if (node.kind === 'parallel') {
        const upstream = [...seenIds];
        base.members = node.steps.map(step => ({ step, refIds: upstream }));
        base.produces = node.steps.map(s => s.resultVar ?? s.id);
        for (const step of node.steps) {
          registerProducer(id, stepRefKeys(step));
        }
        for (const step of node.steps) seenIds.push(step.id);
      } else if (node.kind === 'pipeline') {
        const upstream = [...seenIds];
        base.pipeline = {
          itemsSource: node.itemsSource,
          resultVar: node.resultVar,
          stages: node.stages.map((stage: PipelineStage, stageIndex) =>
            stage.kind === 'agent'
              ? {
                  kind: 'agent',
                  stageIndex,
                  step: stage.step,
                  params: stage.params,
                  refIds: upstream,
                }
              : { kind: 'code', stageIndex, source: stage.source }
          ),
        };
        if (node.resultVar) {
          base.produces = [node.resultVar];
          registerProducer(id, [node.resultVar, stepVarName(node.resultVar)]);
        }
      } else if (node.kind === 'log') {
        base.message = node.message;
      } else if (node.kind === 'code') {
        base.source = node.source;
        base.tag = describeCode(node.source).tag;
        const declared = declaredVars(node.source);
        if (kind === 'schema') {
          const ids = declared.filter(v => referencedSchemaIds.has(v));
          base.produces = ids;
          base.label = node.schemaName ?? ids.join(', ');
          base.schemaModel = node.schemaModel;
          for (const sid of ids) if (!schemaProducers.has(sid)) schemaProducers.set(sid, id);
        } else if (kind === 'setup' && declared.length > 0) {
          base.produces = declared;
          registerProducer(id, declared);
        }
        if (kind === 'output') base.label = 'workflow output';
      }

      blocks.push(base);
      blockIds.push(id);

      // Every agent carrying a `schema:` option declares a structured output —
      // that alone is the signal, whatever the option's shape.
      for (const step of stepsOf(node)) {
        const use = schemaUseOf(step, id);
        if (use) schemaUses.push(use);
      }
    });
    columns.push({ index: col, title: column.title, phase: column.phase, blockIds });
  });

  // ── Schema cards: one per distinct declared schema ──
  // Agents pointing at the same const share the card the script declares (the
  // 1-to-many stays visible). Everything else — a literal written on the call,
  // or a const this model can't locate (imported, computed, declared in a shape
  // the scan misses) — gets a card anchored under its agent. The card is the
  // same either way; only where its definition is READ from differs.
  const schemaCardByKey = new Map<string, string>();
  for (const use of schemaUses) {
    if (schemaCardByKey.has(use.key)) continue;
    const declared = use.name ? schemaProducers.get(use.name) : undefined;
    if (declared) {
      schemaCardByKey.set(use.key, declared);
      continue;
    }
    const owner = blocks.find(b => b.id === use.consumerId);
    if (!owner) continue;
    const id = `${use.consumerId}#schema:${use.key}`;
    const literal = use.name === null;
    blocks.splice(blocks.indexOf(owner) + 1, 0, {
      id,
      kind: 'schema',
      col: owner.col,
      phase: owner.phase,
      x: 0,
      y: 0,
      w: COL_W,
      h: schemaHeight(literal ? (use.step.schemaModel?.children?.length ?? 0) : 0),
      nodeRef: null, // it has no statement of its own in this script
      produces: [],
      label: use.name ?? use.step.id,
      source: use.step.schemaSource,
      schemaModel: literal ? use.step.schemaModel : undefined,
      // Only a literal is editable here — it lives on the agent's own call.
      schemaOwnerStepId: literal ? use.step.id : undefined,
      schemaOwnerBlockId: owner.id,
    });
    const column = columns.find(c => c.index === owner.col);
    column?.blockIds.splice(column.blockIds.indexOf(owner.id) + 1, 0, id);
    schemaCardByKey.set(use.key, id);
  }

  // Synthetic output: no explicit `return` code node but the flow produces a
  // last agent result — the compiler emits `return <lastVar>` (auto-return), so
  // anchor a read-only OUTPUT block at the tail of the last column.
  const hasExplicitOutput = blocks.some(b => b.kind === 'output');
  const lastAgentLike = [...blocks]
    .reverse()
    .find(b => b.kind === 'agent' || b.kind === 'parallel' || b.kind === 'foreach');
  if (!hasExplicitOutput && lastAgentLike) {
    const lastCol = columns[columns.length - 1];
    const returnToken = lastAgentLike.produces[0] ?? '';
    const virtual: PositionedBlock = {
      id: OUTPUT_ID,
      kind: 'output',
      col: lastCol.index,
      phase: null,
      x: 0,
      y: 0,
      w: COL_W,
      h: H.output,
      nodeRef: null,
      produces: [],
      returnTokens: returnToken ? [returnToken] : [],
      label: returnToken ? `returns ${returnToken}` : 'returns',
    };
    blocks.push(virtual);
    lastCol.blockIds.push(OUTPUT_ID);
  }

  // ── Second pass: derive edges ──
  const edges: CanvasEdge[] = [];
  const edgeSeen = new Set<string>();
  const pushEdge = (from: string, to: string, kind: CanvasEdgeKind, label?: string) => {
    if (!from || !to || from === to) return;
    const key = `${kind}:${from}->${to}`;
    if (edgeSeen.has(key)) {
      if (label) {
        const existing = edges.find(e => e.id === key);
        if (existing && existing.label && !existing.label.split(', ').includes(label)) {
          existing.label = `${existing.label}, ${label}`;
        }
      }
      return;
    }
    edgeSeen.add(key);
    edges.push({ id: key, from, to, kind, label });
  };

  /** Resolve a prompt `${ref}` (id form) to its producer block, honouring `a.b` bases. */
  const resolvePromptRef = (ref: string): { blockId: string; label: string } | null => {
    const full = ref.trim();
    if (producersByKey.has(full)) return { blockId: producersByKey.get(full)!, label: full };
    const base = leadingIdent(ref);
    if (base && producersByKey.has(base))
      return { blockId: producersByKey.get(base)!, label: base };
    return null;
  };

  /** Resolve a verbatim-code identifier (var form) to its producer block. */
  const resolveIdent = (ident: string): { blockId: string; label: string } | null =>
    producersByKey.has(ident) ? { blockId: producersByKey.get(ident)!, label: ident } : null;

  // `log` blocks are deliberately absent from this pass: a progress line
  // interpolates step outputs but consumes nothing — it narrates the step
  // directly above it. Its edge only ever duplicated the real dependency
  // (same producer, same label) with an extra arrow, so it is not drawn.
  for (const block of blocks) {
    if (block.kind === 'agent' && block.step) {
      for (const ref of promptRefs(block.step.prompt)) {
        const hit = resolvePromptRef(ref);
        if (hit) pushEdge(hit.blockId, block.id, 'data', hit.label);
      }
    } else if (block.kind === 'parallel' && block.members) {
      for (const member of block.members) {
        for (const ref of promptRefs(member.step.prompt)) {
          const hit = resolvePromptRef(ref);
          if (hit) pushEdge(hit.blockId, block.id, 'data', hit.label);
        }
      }
    } else if (block.kind === 'foreach' && block.pipeline) {
      const own = new Set(
        [block.pipeline.resultVar, ...block.pipeline.stages.map(s => s.params)].filter(
          (x): x is string => !!x
        )
      );
      const consume = (candidates: { blockId: string; label: string } | null) => {
        if (candidates && !own.has(candidates.label)) {
          pushEdge(candidates.blockId, block.id, 'data', candidates.label);
        }
      };
      for (const ident of scanIdentifiers(block.pipeline.itemsSource)) consume(resolveIdent(ident));
      for (const stage of block.pipeline.stages) {
        if (stage.kind === 'agent' && stage.step) {
          for (const ref of promptRefs(stage.step.prompt)) consume(resolvePromptRef(ref));
        } else if (stage.kind === 'code' && stage.source) {
          for (const ident of scanIdentifiers(stage.source)) consume(resolveIdent(ident));
        }
      }
    } else if (block.kind === 'output' && block.source) {
      // The final return composes whatever survived — often every producer in
      // the flow. Drawn as edges those are the longest lines on the canvas and
      // say the least (that everything converges on the terminal node is what
      // "terminal" means), so the block DECLARES its inputs instead.
      const tokens: string[] = [];
      for (const ident of scanIdentifiers(block.source)) {
        const hit = resolveIdent(ident);
        if (hit && !tokens.includes(hit.label)) tokens.push(hit.label);
      }
      block.returnTokens = tokens;
    } else if (
      (block.kind === 'guard' ||
        block.kind === 'code' ||
        block.kind === 'output' ||
        block.kind === 'setup') &&
      block.source
    ) {
      const own = new Set(block.produces);
      // A guard reads its CONDITION; the object it returns when the condition
      // trips is its own early output. Scanning that payload too would draw a
      // dependency for every value the guard merely passes along on the way out
      // (`if (!fix …) return { issue: picked, branch, fix, … }` would claim the
      // guard consumes picked and branch), which is the same confusion the
      // missing guard→output edge already avoids.
      const read =
        block.kind === 'guard' ? (guardCondition(block.source) ?? block.source) : block.source;
      for (const ident of scanIdentifiers(read)) {
        if (own.has(ident)) continue;
        const hit = resolveIdent(ident);
        if (hit) pushEdge(hit.blockId, block.id, 'data', hit.label);
      }
    }
  }

  // Every declared schema, wired to each agent that asked for it — one uniform
  // rule, so a literal and a shared const produce the very same picture.
  for (const use of schemaUses) {
    const card = schemaCardByKey.get(use.key);
    if (card) pushEdge(card, use.consumerId, 'schema', use.name ?? 'schema');
  }

  // ── Position blocks: stack per column in source order ──
  const cursors = new Map<number, number>();
  for (const block of blocks) {
    const y = cursors.get(block.col) ?? PAD;
    block.x = colX(block.col);
    block.y = y;
    cursors.set(block.col, y + block.h + BLOCK_GAP);
  }

  const colCount = columns.length;
  const width = PAD + colCount * COL_W + Math.max(0, colCount - 1) * COL_GAP + PAD;
  const height = Math.max(PAD * 4, ...[...cursors.values()].map(v => v - BLOCK_GAP + PAD));

  return { blocks, edges, columns, bounds: { w: width, h: height } };
}
