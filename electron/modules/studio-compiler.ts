// Agent Studio — design-time blueprint model + compiler to native Claude Code
// workflow scripts. Pure module (no fs/IPC) so the whole compile/validate
// surface is unit-testable. The runtime is always Claude Code itself: the
// Studio only ever emits formats it executes natively (.claude/workflows/*.js),
// never a proprietary manifest.
//
// The blueprint is a NODE model: each phase holds an ordered list of nodes.
// Structured nodes (agent steps, parallel groups, pipelines, log calls) are
// edited visually; everything else is preserved as verbatim `code` nodes and
// re-emitted byte-for-byte, so arbitrary JS round-trips without loss.

import { parse } from 'acorn';
import type { SchemaNodeModel } from '../shared/studio-schema';

export interface BlueprintInput {
  name: string;
  description?: string;
  required?: boolean;
}

export interface BlueprintBrief {
  goal: string;
  inputs: BlueprintInput[];
  expectedOutput: string;
  successCriteria: string[];
  onError: string;
}

export interface BlueprintStep {
  /** Slug, unique across the blueprint; doubles as the agent label. */
  id: string;
  /** Prompt template. `${args}`/`${<step-id>}` interpolate at runtime; any other `${expr}` is preserved verbatim. */
  prompt: string;
  /** The source wrote the prompt as `` `...`.trim() `` — re-emit the call so whitespace stays stripped. */
  promptTrim?: boolean;
  /** Native agent type (`.claude/agents/<name>.md`); omitted = default subagent. */
  agentType?: string;
  model?: string;
  effort?: string;
  /** Verbatim JS literal for the agent() `schema` option (structured output). */
  schemaSource?: string;
  /**
   * Editable projection of `schemaSource`, derived by the parser when the
   * literal is fully static (see shared/studio-schema). Display/editing aid
   * only: the compiler always emits `schemaSource` verbatim, and the schema
   * builder keeps the two in sync by re-serializing the model on every edit.
   */
  schemaModel?: SchemaNodeModel;
  /** agent() `isolation` option ('worktree'). */
  isolation?: string;
  /** Verbatim source of a computed label (template literal); `id` is then a display fallback. */
  dynamicLabel?: string;
  /** Original variable name from a parsed script — preserved so verbatim code that references it keeps working. */
  resultVar?: string;
  /** The parsed call carried an explicit `phase:` option; re-emit it with the current phase title. */
  explicitPhase?: boolean;
}

export type PipelineStage =
  { kind: 'agent'; params: string; step: BlueprintStep } | { kind: 'code'; source: string };

export type BlueprintNode =
  | { kind: 'step'; step: BlueprintStep; leading?: string }
  | { kind: 'parallel'; steps: BlueprintStep[]; leading?: string }
  | {
      kind: 'pipeline';
      resultVar: string | null;
      /** Verbatim expression for the items argument. */
      itemsSource: string;
      stages: PipelineStage[];
      leading?: string;
    }
  | { kind: 'log'; message: string; trim?: boolean; leading?: string }
  | {
      kind: 'code';
      source: string;
      leading?: string;
      /** For a `const NAME = {schema literal}`: the binding name, for display. */
      schemaName?: string;
      /** Editable projection of the schema literal (present only when static). */
      schemaModel?: SchemaNodeModel;
    };

export interface BlueprintPhase {
  title: string;
  detail?: string;
  /** Extra literal keys of this phase's meta.phases entry (e.g. `model`), preserved on save. */
  metaExtra?: Record<string, unknown>;
  leading?: string;
  nodes: BlueprintNode[];
}

export interface Blueprint {
  /** Comments above the meta block (e.g. a hand-written banner). */
  header?: string;
  /** Command-safe name: the compiled script runs as `/name`. */
  name: string;
  description: string;
  version: string;
  brief: BlueprintBrief;
  /** Extra literal top-level meta keys, preserved on save. */
  metaExtras?: Record<string, unknown>;
  /** Nodes before the first phase() call (e.g. args extraction). */
  preamble?: BlueprintNode[];
  phases: BlueprintPhase[];
  /** Comments after the last statement. */
  trailer?: string;
}

export interface BlueprintIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  stepId?: string;
  phaseIndex?: number;
}

export interface ValidateContext {
  /** Known agent names; when provided, unknown agentType refs become warnings. */
  agentTypes?: string[];
}

export const BLUEPRINT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const STEP_ID_RE = /^[a-z0-9][a-z0-9:._-]*$/;

export const KNOWN_MODELS = ['sonnet', 'opus', 'haiku', 'inherit'];
export const KNOWN_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Identifiers the generated script already binds (workflow runtime globals).
const RESERVED_VARS = new Set([
  'args',
  'agent',
  'parallel',
  'pipeline',
  'phase',
  'log',
  'budget',
  'workflow',
  'meta',
]);

/** All agent steps of a phase, in order — step nodes, parallel members, pipeline agent stages. */
export function phaseSteps(phase: BlueprintPhase): BlueprintStep[] {
  return phase.nodes.flatMap(n => nodeSteps(n));
}

function nodeSteps(node: BlueprintNode): BlueprintStep[] {
  if (node.kind === 'step') return [node.step];
  if (node.kind === 'parallel') return node.steps;
  if (node.kind === 'pipeline') {
    return node.stages.flatMap(s => (s.kind === 'agent' ? [s.step] : []));
  }
  return [];
}

export function blueprintSteps(bp: Blueprint): BlueprintStep[] {
  return [...(bp.preamble ?? []), ...bp.phases.flatMap(p => p.nodes)].flatMap(nodeSteps);
}

/** Nodes that carry verbatim JS the visual editor cannot restructure. */
export function countCodeNodes(bp: Blueprint): number {
  const all = [...(bp.preamble ?? []), ...bp.phases.flatMap(p => p.nodes)];
  let count = 0;
  for (const node of all) {
    if (node.kind === 'code') count++;
    if (node.kind === 'pipeline') count += node.stages.filter(s => s.kind === 'code').length;
  }
  return count;
}

/**
 * A hybrid blueprint contains verbatim JS (code nodes, pipelines, a preamble):
 * local variables may exist that the visual model cannot see, so unknown
 * `${expr}` interpolations are emitted LIVE instead of escaped to text.
 */
export function isHybridBlueprint(bp: Blueprint): boolean {
  if ((bp.preamble ?? []).length > 0) return true;
  return bp.phases.some(p => p.nodes.some(n => n.kind === 'code' || n.kind === 'pipeline'));
}

/** `security-check` → `securityCheck`; always a safe, non-reserved JS identifier. */
export function stepVarName(id: string): string {
  let v = id
    .replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, (_, c: string) => c.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, '');
  if (!v || /^[0-9]/.test(v)) v = `step${v.charAt(0).toUpperCase()}${v.slice(1)}`;
  if (RESERVED_VARS.has(v)) v = `${v}Step`;
  return v;
}

/** Unique variable per step id (honouring parsed `resultVar`), deduped deterministically. */
function buildVarMap(bp: Blueprint): Map<string, string> {
  const vars = new Map<string, string>();
  const used = new Set<string>();
  for (const step of blueprintSteps(bp)) {
    const base = step.resultVar ?? stepVarName(step.id);
    let v = base;
    let n = 2;
    while (used.has(v)) v = `${base}${n++}`;
    used.add(v);
    vars.set(step.id, v);
  }
  return vars;
}

export interface Interpolation {
  start: number;
  end: number;
  expr: string;
}

/**
 * Balanced-brace scan for `${...}` interpolations in a prompt template.
 * Handles nested braces (`${JSON.stringify({a: 1})}`); an unclosed opener is
 * treated as plain text. Brace characters inside string literals within the
 * expression are not special-cased — a pathological case the editor tolerates.
 */
export function scanInterpolations(text: string): Interpolation[] {
  const out: Interpolation[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '$' && text[i + 1] === '{' && text[i - 1] !== '\\') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      if (depth === 0) {
        out.push({ start: i, end: j, expr: text.slice(i + 2, j - 1) });
        i = j;
        continue;
      }
    }
    i++;
  }
  return out;
}

/**
 * Escape prompt text for a backtick template literal. Recognized refs
 * (`${args}`, `${<step-id>}`) stay live and are rewritten to their JS
 * variable. Any other `${expr}`: emitted verbatim (live) when
 * `verbatimUnknown` — hybrid scripts, where code nodes may define it — else
 * rendered as literal text (safe default for pure visual blueprints).
 *
 * In the logical prompt string a live interpolation is `${expr}`, while a
 * literal dollar-brace is written `\${` (the parser escapes it so it never
 * scans as an interpolation). `scanInterpolations` skips `\${`, so those stay
 * in the surrounding text and `escapeTemplateText` re-emits them as literal
 * `${` — this is what keeps a native `agent("cost is ${x}")` (plain string,
 * literal text) from being turned into a live interpolation on Visual Save.
 */
export function emitPromptLiteral(
  prompt: string,
  known: Set<string>,
  vars: Map<string, string>,
  verbatimUnknown = false
): string {
  let out = '';
  let last = 0;
  for (const m of scanInterpolations(prompt)) {
    out += escapeTemplateText(prompt.slice(last, m.start));
    if (m.expr === 'args') out += '${args}';
    else if (known.has(m.expr)) out += `\${${vars.get(m.expr) ?? m.expr}}`;
    else if (verbatimUnknown) out += `\${${m.expr}}`;
    else out += escapeTemplateText(prompt.slice(m.start, m.end));
    last = m.end;
  }
  out += escapeTemplateText(prompt.slice(last));
  return `\`${out}\``;
}

/**
 * Emit literal text into a backtick template body. A logical `\${` (escaped
 * dollar-brace) becomes a template-literal `\${` (which cooks back to a bare
 * `${`, no stray backslash); a lone backslash and a backtick are escaped so
 * the template body stays valid; a bare `${` — defensive, should not reach
 * here since scanInterpolations claims those — is escaped to stay literal.
 */
function escapeTemplateText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '$' && text[i + 2] === '{') {
      out += '\\${';
      i += 2;
    } else if (ch === '\\') {
      out += '\\\\';
    } else if (ch === '`') {
      out += '\\`';
    } else if (ch === '$' && text[i + 1] === '{') {
      out += '\\${';
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** JS string literal via JSON (double quotes, fully escaped). */
function js(value: string): string {
  return JSON.stringify(value);
}

/** Extra literal meta entries (`key: <json>`); JSON is valid JS for pure literals. */
function extraEntries(extra: Record<string, unknown> | undefined): string[] {
  if (!extra) return [];
  return Object.entries(extra).map(([key, value]) => {
    const emittedKey =
      key !== '__proto__' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    return `${emittedKey}: ${JSON.stringify(value)}`;
  });
}

interface EmitCtx {
  vars: Map<string, string>;
  known: Set<string>;
  hybrid: boolean;
}

function agentCall(
  step: BlueprintStep,
  phaseTitle: string | null,
  ctx: EmitCtx,
  opts: { inParallel: boolean; verbatimPrompt?: boolean }
): string {
  const options: string[] = [`label: ${step.dynamicLabel ?? js(step.id)}`];
  if (phaseTitle !== null && (opts.inParallel || step.explicitPhase)) {
    options.push(`phase: ${js(phaseTitle)}`);
  }
  if (step.agentType) options.push(`agentType: ${js(step.agentType)}`);
  if (step.model && step.model !== 'inherit') options.push(`model: ${js(step.model)}`);
  if (step.effort) options.push(`effort: ${js(step.effort)}`);
  if (step.isolation) options.push(`isolation: ${js(step.isolation)}`);
  if (step.schemaSource) options.push(`schema: ${step.schemaSource}`);
  const prompt = emitPromptLiteral(
    step.prompt,
    ctx.known,
    ctx.vars,
    opts.verbatimPrompt ?? ctx.hybrid
  );
  return `agent(${prompt}${step.promptTrim ? '.trim()' : ''}, { ${options.join(', ')} })`;
}

function pushLeading(lines: string[], leading: string | undefined): void {
  if (!leading) return;
  for (const line of leading.split('\n')) lines.push(line);
}

function emitNode(
  lines: string[],
  node: BlueprintNode,
  phaseTitle: string | null,
  ctx: EmitCtx
): void {
  lines.push('');
  pushLeading(lines, node.leading);
  if (node.kind === 'code') {
    lines.push(node.source);
    return;
  }
  if (node.kind === 'log') {
    const message = emitPromptLiteral(node.message, ctx.known, ctx.vars, ctx.hybrid);
    lines.push(`log(${message}${node.trim ? '.trim()' : ''})`);
    return;
  }
  if (node.kind === 'step') {
    const call = agentCall(node.step, phaseTitle, ctx, { inParallel: false });
    lines.push(`const ${ctx.vars.get(node.step.id)} = await ${call}`);
    ctx.known.add(node.step.id);
    return;
  }
  if (node.kind === 'parallel') {
    const names = node.steps.map(s => ctx.vars.get(s.id)).join(', ');
    lines.push(`const [${names}] = await parallel([`);
    for (const step of node.steps) {
      lines.push(`  () => ${agentCall(step, phaseTitle, ctx, { inParallel: true })},`);
    }
    lines.push('])');
    for (const step of node.steps) ctx.known.add(step.id);
    return;
  }
  // pipeline
  const head = node.resultVar ? `const ${node.resultVar} = await pipeline(` : 'await pipeline(';
  lines.push(head);
  lines.push(`  ${node.itemsSource},`);
  for (const stage of node.stages) {
    if (stage.kind === 'code') {
      lines.push(`  ${stage.source},`);
    } else {
      // Stage prompts reference the stage parameters — always emitted verbatim.
      const call = agentCall(stage.step, phaseTitle, ctx, {
        inParallel: true,
        verbatimPrompt: true,
      });
      lines.push(`  (${stage.params}) => ${call},`);
    }
  }
  lines.push(')');
}

/**
 * A `return` in the workflow's own (top-level) scope — inside blocks, ifs and
 * loops, but NOT inside a nested function/arrow, whose `return` is local. Walks
 * every child except function bodies.
 */
function containsTopLevelReturn(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: string }).type;
  if (type === 'ReturnStatement') return true;
  if (
    type === 'FunctionDeclaration' ||
    type === 'FunctionExpression' ||
    type === 'ArrowFunctionExpression'
  ) {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    if (Array.isArray(child)) {
      if (child.some(containsTopLevelReturn)) return true;
    } else if (containsTopLevelReturn(child)) {
      return true;
    }
  }
  return false;
}

/**
 * True when a verbatim code node already returns from the workflow — the
 * compiler must not append its own auto-return. Parsing (rather than a regex)
 * is essential: a `return` inside a nested helper (`data.map(x => { return … })`)
 * must NOT count, or the real return value is silently dropped on save.
 */
function codeNodeReturns(source: string): boolean {
  try {
    const program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as unknown;
    return containsTopLevelReturn(program);
  } catch {
    // A partial fragment that does not parse on its own: fall back to the
    // conservative line-anchored heuristic rather than risk a duplicate return.
    return /(^|\n)\s*return\b/.test(source);
  }
}

/** True when any code node already returns — the compiler must not append its own. */
function hasExplicitReturn(bp: Blueprint): boolean {
  const all = [...(bp.preamble ?? []), ...bp.phases.flatMap(p => p.nodes)];
  return all.some(n => n.kind === 'code' && codeNodeReturns(n.source));
}

/**
 * Compile a blueprint into a native Claude Code dynamic workflow script.
 * Tolerant by design (unknown refs degrade to literal text in pure visual
 * blueprints) so the editor can live-preview invalid drafts; gate actual
 * writes behind validateBlueprint.
 */
export function compileBlueprint(bp: Blueprint): string {
  const ctx: EmitCtx = {
    vars: buildVarMap(bp),
    known: new Set<string>(),
    hybrid: isHybridBlueprint(bp),
  };
  const lines: string[] = [];

  if (bp.header) {
    pushLeading(lines, bp.header);
  }
  lines.push('export const meta = {');
  lines.push(`  name: ${js(bp.name)},`);
  lines.push(`  description: ${js(bp.description || bp.brief.goal || bp.name)},`);
  lines.push(`  version: ${js(bp.version || '0.1.0')},`);
  if (bp.brief.goal) lines.push(`  whenToUse: ${js(bp.brief.goal)},`);
  for (const entry of extraEntries(bp.metaExtras)) lines.push(`  ${entry},`);
  if (bp.phases.length > 0) {
    lines.push('  phases: [');
    for (const p of bp.phases) {
      const parts = [`title: ${js(p.title)}`];
      if (p.detail) parts.push(`detail: ${js(p.detail)}`);
      parts.push(...extraEntries(p.metaExtra));
      lines.push(`    { ${parts.join(', ')} },`);
    }
    lines.push('  ],');
  }
  lines.push('}');
  lines.push('');
  lines.push(
    '// Generated by ClaudeLens Agent Studio — plain Claude Code workflow script, edit freely.'
  );
  lines.push(
    `// Run from any session as: /${bp.name}${bp.brief.inputs.length ? ' <' + bp.brief.inputs.map(i => i.name).join('> <') + '>' : ''}`
  );
  for (const c of bp.brief.successCriteria) lines.push(`// Success: ${c.replace(/\r?\n/g, ' ')}`);
  if (bp.brief.expectedOutput) {
    lines.push(`// Expected output: ${bp.brief.expectedOutput.replace(/\r?\n/g, ' ')}`);
  }
  if (bp.brief.onError) lines.push(`// On error: ${bp.brief.onError.replace(/\r?\n/g, ' ')}`);

  for (const node of bp.preamble ?? []) emitNode(lines, node, null, ctx);

  for (const phase of bp.phases) {
    lines.push('');
    pushLeading(lines, phase.leading);
    lines.push(`phase(${js(phase.title)})`);
    for (const node of phase.nodes) {
      // emitNode adds its own blank separator; collapse it for the first node
      // right under the phase() line to keep the compact historical shape.
      const before = lines.length;
      emitNode(lines, node, phase.title, ctx);
      if (node === phase.nodes[0] && lines[before] === '' && !node.leading) {
        lines.splice(before, 1);
      }
    }
  }

  if (!hasExplicitReturn(bp)) {
    const lastPhase = bp.phases[bp.phases.length - 1];
    const returnable = lastPhase
      ? lastPhase.nodes.flatMap(n =>
          n.kind === 'step' || n.kind === 'parallel' ? nodeSteps(n) : []
        )
      : [];
    if (returnable.length === 1) {
      lines.push('');
      lines.push(`return ${ctx.vars.get(returnable[0].id)}`);
    } else if (returnable.length > 1) {
      lines.push('');
      lines.push(`return { ${returnable.map(s => ctx.vars.get(s.id)).join(', ')} }`);
    }
  }

  if (bp.trailer) {
    lines.push('');
    pushLeading(lines, bp.trailer);
  }

  return lines.join('\n') + '\n';
}

/** Design-time checks. Errors block compile-to-disk; warnings only inform. */
export function validateBlueprint(bp: Blueprint, ctx: ValidateContext = {}): BlueprintIssue[] {
  const issues: BlueprintIssue[] = [];
  const err = (code: string, message: string, extra: Partial<BlueprintIssue> = {}) =>
    issues.push({ severity: 'error', code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<BlueprintIssue> = {}) =>
    issues.push({ severity: 'warning', code, message, ...extra });

  const hybrid = isHybridBlueprint(bp);

  if (!BLUEPRINT_NAME_RE.test(bp.name)) {
    err(
      'invalid-name',
      `Blueprint name "${bp.name}" must be lowercase letters, digits and dashes (it becomes the /${bp.name || 'name'} command).`
    );
  }
  if (!bp.description.trim() && !bp.brief.goal.trim()) {
    warn(
      'no-description',
      'Add a description or a brief goal — it becomes the workflow description.'
    );
  }
  if (bp.phases.length === 0 && (bp.preamble ?? []).length === 0) {
    err('no-phases', 'The flow is empty: add at least one phase with a step.');
  }

  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const allIds = new Set(blueprintSteps(bp).map(s => s.id));
  const inputNames = new Set(bp.brief.inputs.map(i => i.name));
  let argsUsed = false;

  const checkStep = (
    step: BlueprintStep,
    pi: number | undefined,
    known: Set<string>,
    siblingIds: Set<string>,
    inPipeline: boolean
  ) => {
    if (!STEP_ID_RE.test(step.id)) {
      err(
        'invalid-step-id',
        `Step id "${step.id}" must be lowercase letters, digits, dots, colons and dashes.`,
        { stepId: step.id, phaseIndex: pi }
      );
    }
    if (seenIds.has(step.id)) {
      err('duplicate-step', `Step id "${step.id}" is used more than once.`, {
        stepId: step.id,
        phaseIndex: pi,
      });
    }
    seenIds.add(step.id);
    if (!step.prompt.trim()) {
      err('empty-prompt', `Step "${step.id}" has an empty prompt.`, {
        stepId: step.id,
        phaseIndex: pi,
      });
    }
    if (
      step.model &&
      step.model !== '' &&
      !KNOWN_MODELS.includes(step.model) &&
      !step.model.startsWith('claude-')
    ) {
      warn('unknown-model', `Step "${step.id}" uses unrecognized model "${step.model}".`, {
        stepId: step.id,
        phaseIndex: pi,
      });
    }
    if (step.effort && !KNOWN_EFFORTS.includes(step.effort)) {
      warn('unknown-effort', `Step "${step.id}" uses unrecognized effort "${step.effort}".`, {
        stepId: step.id,
        phaseIndex: pi,
      });
    }
    if (step.agentType && ctx.agentTypes && !ctx.agentTypes.includes(step.agentType)) {
      warn(
        'unknown-agent',
        `Step "${step.id}" references agent "${step.agentType}", which does not exist yet.`,
        { stepId: step.id, phaseIndex: pi }
      );
    }

    for (const m of scanInterpolations(step.prompt)) {
      const ref = m.expr;
      if (ref === 'args') {
        argsUsed = true;
        continue;
      }
      if (known.has(ref)) continue;
      if (ref !== step.id && siblingIds.has(ref)) {
        err(
          'sibling-ref',
          `Step "${step.id}" references "${ref}", which runs in parallel in the same phase — its output is not available. Move it to an earlier phase.`,
          { stepId: step.id, phaseIndex: pi }
        );
        continue;
      }
      if (allIds.has(ref)) {
        err('forward-ref', `Step "${step.id}" references "${ref}", which runs later in the flow.`, {
          stepId: step.id,
          phaseIndex: pi,
        });
        continue;
      }
      // Pipeline stage prompts legitimately reference stage parameters; hybrid
      // scripts legitimately reference variables defined in code nodes — both
      // are emitted live and cannot be checked statically.
      if (inPipeline || hybrid) continue;
      if (inputNames.has(ref)) {
        err(
          'input-ref',
          `Step "${step.id}" references input "${ref}" directly — inputs arrive as the single \${args} string.`,
          { stepId: step.id, phaseIndex: pi }
        );
      } else {
        err(
          'unknown-ref',
          `Step "${step.id}" references "\${${ref}}", which is neither \${args} nor an earlier step.`,
          { stepId: step.id, phaseIndex: pi }
        );
      }
    }
  };

  const known = new Set<string>();
  const walkNodes = (nodes: BlueprintNode[], pi: number | undefined) => {
    for (const node of nodes) {
      if (node.kind === 'step') {
        checkStep(node.step, pi, known, new Set(), false);
        known.add(node.step.id);
      } else if (node.kind === 'parallel') {
        const siblings = new Set(node.steps.map(s => s.id));
        for (const step of node.steps) checkStep(step, pi, known, siblings, false);
        for (const step of node.steps) known.add(step.id);
      } else if (node.kind === 'pipeline') {
        for (const stage of node.stages) {
          if (stage.kind === 'agent') checkStep(stage.step, pi, known, new Set(), true);
        }
      }
    }
  };

  walkNodes(bp.preamble ?? [], undefined);

  bp.phases.forEach((phase, pi) => {
    if (!phase.title.trim())
      err('empty-phase-title', `Phase ${pi + 1} has no title.`, { phaseIndex: pi });
    if (seenTitles.has(phase.title)) {
      warn(
        'duplicate-phase-title',
        `Phase title "${phase.title}" is used more than once — progress grouping matches by title.`,
        { phaseIndex: pi }
      );
    }
    seenTitles.add(phase.title);
    if (phase.nodes.length === 0) {
      err('empty-phase', `Phase "${phase.title || pi + 1}" has no steps.`, { phaseIndex: pi });
    }
    walkNodes(phase.nodes, pi);
  });

  if (
    bp.brief.inputs.length > 0 &&
    !argsUsed &&
    !hybrid &&
    bp.phases.some(p => phaseSteps(p).length > 0)
  ) {
    warn('args-never-used', 'The brief declares inputs but no step interpolates ${args}.');
  }

  return issues;
}
