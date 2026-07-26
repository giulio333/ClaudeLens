// Agent Studio parser — projects a native Claude Code workflow script into the
// blueprint NODE model. Structured constructs (meta, phase(), agent(),
// parallel(), pipeline(), log()) become editable visual nodes; every other
// top-level statement is preserved as a verbatim `code` node (source slice),
// so the whole script round-trips through the visual editor without loss.
// Files with syntax errors or dynamic `meta` declarations stay source-only:
// rebuilding computed/spread metadata from a lossy object projection would
// otherwise silently change a valid native workflow.

import { parse } from 'acorn';
import type {
  Blueprint,
  BlueprintNode,
  BlueprintPhase,
  BlueprintStep,
  PipelineStage,
} from './studio-compiler';
import { stepVarName } from './studio-compiler';
import { schemaModelFromLiteral } from '../shared/studio-schema';

type AstNode = { type: string; start: number; end: number; [key: string]: unknown };

export interface ParsedWorkflowScript {
  blueprint: Blueprint;
  /** False when visual editing cannot safely round-trip the native source. */
  structured: boolean;
  parseError: string | null;
}

const node = (value: unknown): AstNode | null =>
  value && typeof value === 'object' && 'type' in value ? (value as AstNode) : null;
const nodes = (value: unknown): AstNode[] =>
  Array.isArray(value) ? value.map(node).filter((n): n is AstNode => n !== null) : [];

function keyOf(value: unknown): string | null {
  const n = node(value);
  if (!n) return null;
  if (n.type === 'Identifier') return typeof n.name === 'string' ? n.name : null;
  if (n.type === 'Literal') return typeof n.value === 'string' ? n.value : null;
  return null;
}

function literalValue(value: unknown): unknown {
  const n = node(value);
  if (!n) return undefined;
  if (n.type === 'Literal') return n.value;
  if (n.type === 'ArrayExpression') return nodes(n.elements).map(literalValue);
  if (n.type === 'ObjectExpression') {
    const out = Object.create(null) as Record<string, unknown>;
    for (const property of nodes(n.properties)) {
      if (property.type !== 'Property' || property.computed === true) continue;
      const key = keyOf(property.key);
      if (key) out[key] = literalValue(property.value);
    }
    return out;
  }
  return undefined;
}

/**
 * Like `literalValue` but strict: fails on ANY node that is not a pure
 * literal (identifiers, calls, spreads, computed keys), instead of silently
 * dropping it. Required anywhere the visual model will rebuild JavaScript — a
 * permissive read would let the compiler emit a literal with pieces missing.
 */
function strictLiteralValue(value: unknown): { ok: boolean; value?: unknown } {
  const n = node(value);
  if (!n) return { ok: false };
  if (n.type === 'Literal') {
    const literal = n.value;
    const jsonScalar =
      literal === null ||
      typeof literal === 'string' ||
      typeof literal === 'boolean' ||
      (typeof literal === 'number' && Number.isFinite(literal));
    return jsonScalar ? { ok: true, value: literal } : { ok: false };
  }
  if (n.type === 'ArrayExpression') {
    const elements = Array.isArray(n.elements) ? n.elements : [];
    const out: unknown[] = [];
    for (const element of elements) {
      const item = strictLiteralValue(element);
      if (!item.ok) return { ok: false };
      out.push(item.value);
    }
    return { ok: true, value: out };
  }
  if (n.type === 'ObjectExpression') {
    const out = Object.create(null) as Record<string, unknown>;
    for (const property of nodes(n.properties)) {
      if (property.type !== 'Property' || property.computed === true) return { ok: false };
      const key = keyOf(property.key);
      if (!key) return { ok: false };
      const item = strictLiteralValue(property.value);
      if (!item.ok) return { ok: false };
      out[key] = item.value;
    }
    return { ok: true, value: out };
  }
  return { ok: false };
}

function callName(value: unknown): string | null {
  const n = node(value);
  if (!n || n.type !== 'CallExpression') return null;
  const callee = node(n.callee);
  return callee?.type === 'Identifier' && typeof callee.name === 'string' ? callee.name : null;
}

function stringValue(value: unknown): string | null {
  const n = node(value);
  return n?.type === 'Literal' && typeof n.value === 'string' ? n.value : null;
}

/**
 * `` `...`.trim() `` — the idiom native workflows use for multi-line prompts —
 * is a CallExpression, not a template literal, so the prompt readers must see
 * through it. The flag travels on the node so the compiler re-emits `.trim()`
 * and the round-trip keeps stripping the leading/trailing newline.
 */
function unwrapTrim(value: unknown): { inner: AstNode | null; trimmed: boolean } {
  const n = node(value);
  if (!n) return { inner: null, trimmed: false };
  if (n.type !== 'CallExpression' || nodes(n.arguments).length !== 0) {
    return { inner: n, trimmed: false };
  }
  const callee = node(n.callee);
  if (callee?.type !== 'MemberExpression' || callee.computed === true) {
    return { inner: n, trimmed: false };
  }
  if (keyOf(callee.property) !== 'trim') return { inner: n, trimmed: false };
  const object = node(callee.object);
  if (!object || (object.type !== 'TemplateLiteral' && object.type !== 'Literal')) {
    return { inner: n, trimmed: false };
  }
  return { inner: object, trimmed: true };
}

/**
 * Escape `${` → `\${` in text that was literal in the source (a plain string
 * value, or a template quasi between expressions). The compiler's
 * `scanInterpolations` skips `\${`, so the sequence stays literal on round-trip
 * instead of being reinterpreted as a live interpolation.
 */
function escapeLiteralInterp(text: string): string {
  return text.replace(/\$\{/g, '\\${');
}

/** `repoMap` → `repo-map`: a display slug for steps that only have a variable name. */
function slugify(name: string): string {
  const slug = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '');
  return slug || 'step';
}

interface Comment {
  block: boolean;
  text: string;
  start: number;
  end: number;
}

/** Comment lines the compiler regenerates from the brief/meta — never captured as node trivia. */
const GENERATED_COMMENT_RE =
  /^\s*(Generated by ClaudeLens Agent Studio|Run from any session as:|Success:|Expected output:|On error:)/;

function renderComments(comments: Comment[]): string | undefined {
  if (comments.length === 0) return undefined;
  return comments.map(c => (c.block ? `/*${c.text}*/` : `//${c.text}`)).join('\n');
}

function commentsBrief(source: string): Blueprint['brief'] {
  const run = /^\/\/ Run from any session as: \/\S+(.*)$/m.exec(source)?.[1] ?? '';
  const inputs = [...run.matchAll(/<([^>]+)>/g)].map(match => ({ name: match[1], required: true }));
  const successes = [...source.matchAll(/^\/\/ Success: (.*)$/gm)].map(match => match[1]);
  return {
    goal: '',
    inputs,
    expectedOutput: /^\/\/ Expected output: (.*)$/m.exec(source)?.[1] ?? '',
    successCriteria: successes,
    onError: /^\/\/ On error: (.*)$/m.exec(source)?.[1] ?? '',
  };
}

const META_KEYS = new Set(['name', 'description', 'version', 'whenToUse', 'phases']);
const PHASE_META_KEYS = new Set(['title', 'detail']);
type MetaParseResult = 'not-meta' | 'safe' | 'unsafe';

class ScriptParser {
  private readonly source: string;
  private readonly variables = new Map<string, string>(); // JS var → step id
  private readonly usedIds = new Set<string>();
  readonly preamble: BlueprintNode[] = [];
  readonly phases: BlueprintPhase[] = [];
  meta: Record<string, unknown> = {};
  metaExtras: Record<string, unknown> | undefined;
  header: string | undefined;
  private current: BlueprintPhase | null = null;
  private phaseMeta: Array<Record<string, unknown>> = [];

  constructor(source: string) {
    this.source = source;
  }

  private src(n: AstNode): string {
    return this.source.slice(n.start, n.end);
  }

  private sink(): BlueprintNode[] {
    return this.current ? this.current.nodes : this.preamble;
  }

  private uniqueId(base: string): string {
    let id = base;
    let n = 2;
    while (this.usedIds.has(id)) id = `${base}-${n++}`;
    this.usedIds.add(id);
    return id;
  }

  /** Rebuild a prompt string from a template/string literal; non-step interpolations stay verbatim. */
  private promptOf(value: unknown): string | null {
    const n = node(value);
    if (!n) return null;
    // A `${...}` in literal text (a plain string never interpolates; a template
    // quasi is the text between expressions) is NOT a live interpolation. Escape
    // it to `\${` so the compiler re-emits it as literal text instead of turning
    // it into a runtime interpolation (which would break the prompt or throw).
    const plain = stringValue(n);
    if (plain !== null) return escapeLiteralInterp(plain);
    if (n.type !== 'TemplateLiteral') return null;
    const quasis = nodes(n.quasis);
    const expressions = nodes(n.expressions);
    let out = '';
    for (let i = 0; i < quasis.length; i++) {
      const valueRecord = quasis[i].value as Record<string, unknown> | undefined;
      out += typeof valueRecord?.cooked === 'string' ? escapeLiteralInterp(valueRecord.cooked) : '';
      const expression = expressions[i];
      if (!expression) continue;
      if (expression.type === 'Identifier' && typeof expression.name === 'string') {
        const ref =
          expression.name === 'args'
            ? 'args'
            : (this.variables.get(expression.name) ?? expression.name);
        out += `\${${ref}}`;
      } else {
        out += `\${${this.src(expression)}}`;
      }
    }
    return out;
  }

  /** Parse an agent(...) call into a step, or null when it exceeds the structured option set. */
  private parseAgentCall(
    value: unknown,
    fallbackIdBase: string,
    resultVar?: string
  ): BlueprintStep | null {
    const call = node(value);
    if (!call || callName(call) !== 'agent') return null;
    const args = nodes(call.arguments);
    if (args.length > 2) return null;
    const promptArg = unwrapTrim(args[0]);
    const prompt = this.promptOf(promptArg.inner);
    if (prompt === null) return null;

    const step: BlueprintStep = { id: '', prompt };
    if (promptArg.trimmed) step.promptTrim = true;
    if (resultVar) step.resultVar = resultVar;
    let literalLabel: string | null = null;

    const opts = node(args[1]);
    if (opts) {
      if (opts.type !== 'ObjectExpression') return null;
      for (const property of nodes(opts.properties)) {
        if (property.type !== 'Property' || property.computed === true) return null;
        const key = keyOf(property.key);
        const valueNode = node(property.value);
        if (!key || !valueNode) return null;
        if (key === 'label') {
          const label = stringValue(valueNode);
          if (label !== null) literalLabel = label;
          else if (valueNode.type === 'TemplateLiteral') step.dynamicLabel = this.src(valueNode);
          else return null;
          continue;
        }
        if (key === 'phase') {
          if (stringValue(valueNode) === null) return null;
          step.explicitPhase = true;
          continue;
        }
        if (key === 'schema') {
          step.schemaSource = this.src(valueNode);
          const literal = strictLiteralValue(valueNode);
          if (literal.ok) {
            const model = schemaModelFromLiteral(literal.value);
            if (model) step.schemaModel = model;
          }
          continue;
        }
        if (key === 'agentType' || key === 'model' || key === 'effort' || key === 'isolation') {
          const v = stringValue(valueNode);
          if (v === null) return null;
          step[key] = v;
          continue;
        }
        return null;
      }
    }

    step.id = literalLabel ?? this.uniqueId(slugify(fallbackIdBase));
    if (literalLabel !== null) this.usedIds.add(literalLabel);
    return step;
  }

  private applyMeta(value: Record<string, unknown>): void {
    this.meta = value;
    const extras = Object.create(null) as Record<string, unknown>;
    for (const [key, v] of Object.entries(this.meta)) {
      if (!META_KEYS.has(key)) extras[key] = v;
    }
    if (Object.keys(extras).length > 0) this.metaExtras = extras;
    this.phaseMeta = Array.isArray(this.meta.phases)
      ? (this.meta.phases as Array<Record<string, unknown>>)
      : [];
  }

  parseMetaDeclaration(statement: AstNode): MetaParseResult {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? node(statement.declaration) : null;
    if (declaration?.type !== 'VariableDeclaration') return 'not-meta';
    const declarations = nodes(declaration.declarations);
    for (const item of declarations) {
      const id = node(item.id);
      if (id?.type !== 'Identifier' || id.name !== 'meta') continue;

      // Preserve useful read-only labels for a source-only file, but only
      // expose Brief/Flow/Canvas when the ENTIRE declaration is JSON-literal.
      // A sibling declarator would also be lost when the compiler regenerates
      // `export const meta`, so it is intentionally source-only too.
      const permissive = literalValue(item.init);
      if (permissive && typeof permissive === 'object' && !Array.isArray(permissive)) {
        this.applyMeta(permissive as Record<string, unknown>);
      }
      if (declaration.kind !== 'const' || declarations.length !== 1) return 'unsafe';

      const literal = strictLiteralValue(item.init);
      if (
        !literal.ok ||
        !literal.value ||
        typeof literal.value !== 'object' ||
        Array.isArray(literal.value)
      ) {
        return 'unsafe';
      }
      this.applyMeta(literal.value as Record<string, unknown>);
      return 'safe';
    }
    return 'not-meta';
  }

  private tryPhase(statement: AstNode, leading: string | undefined): boolean {
    if (statement.type !== 'ExpressionStatement') return false;
    const expression = node(statement.expression);
    if (callName(expression) !== 'phase') return false;
    const args = nodes(expression!.arguments);
    const title = args.length === 1 ? stringValue(args[0]) : null;
    if (title === null) return false;
    const metaPhase = this.phaseMeta[this.phases.length];
    const phase: BlueprintPhase = { title, nodes: [] };
    if (typeof metaPhase?.detail === 'string') phase.detail = metaPhase.detail;
    if (metaPhase) {
      const extra = Object.create(null) as Record<string, unknown>;
      for (const [key, v] of Object.entries(metaPhase)) {
        if (!PHASE_META_KEYS.has(key)) extra[key] = v;
      }
      if (Object.keys(extra).length > 0) phase.metaExtra = extra;
    }
    if (leading) phase.leading = leading;
    this.phases.push(phase);
    this.current = phase;
    return true;
  }

  private tryLog(statement: AstNode, leading: string | undefined): boolean {
    if (statement.type !== 'ExpressionStatement') return false;
    const expression = node(statement.expression);
    if (callName(expression) !== 'log') return false;
    const args = nodes(expression!.arguments);
    if (args.length !== 1) return false;
    const messageArg = unwrapTrim(args[0]);
    const message = this.promptOf(messageArg.inner);
    if (message === null) return false;
    this.sink().push({
      kind: 'log',
      message,
      ...(messageArg.trimmed ? { trim: true } : {}),
      ...(leading ? { leading } : {}),
    });
    return true;
  }

  private tryDeclaration(statement: AstNode, leading: string | undefined): boolean {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') return false;
    const declarations = nodes(statement.declarations);
    if (declarations.length !== 1) return false;
    const declaration = declarations[0];
    const id = node(declaration.id);
    const rawInit = node(declaration.init);
    const init = rawInit?.type === 'AwaitExpression' ? node(rawInit.argument) : rawInit;
    if (!id || !init) return false;

    if (id.type === 'Identifier' && typeof id.name === 'string') {
      if (callName(init) === 'agent') {
        const step = this.parseAgentCall(init, id.name, id.name);
        if (!step) return false;
        this.variables.set(id.name, step.id);
        this.sink().push({ kind: 'step', step, ...(leading ? { leading } : {}) });
        return true;
      }
      if (callName(init) === 'pipeline') {
        return this.tryPipeline(init!, id.name, leading);
      }
      return false;
    }

    if (id.type === 'ArrayPattern' && callName(init) === 'parallel') {
      if (nodes(init!.arguments).length !== 1) return false;
      const array = node(nodes(init!.arguments)[0]);
      if (array?.type !== 'ArrayExpression') return false;
      const names = nodes(id.elements).map(element =>
        element.type === 'Identifier' && typeof element.name === 'string' ? element.name : ''
      );
      const steps: BlueprintStep[] = [];
      const elements = nodes(array.elements);
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.type !== 'ArrowFunctionExpression' || element.async === true) return false;
        if (nodes(element.params).length !== 0) return false;
        const step = this.parseAgentCall(
          element.body,
          names[i] || `step-${i + 1}`,
          names[i] || undefined
        );
        if (!step) return false;
        steps.push(step);
      }
      for (let i = 0; i < steps.length; i++) {
        if (names[i]) this.variables.set(names[i], steps[i].id);
      }
      this.sink().push({ kind: 'parallel', steps, ...(leading ? { leading } : {}) });
      return true;
    }

    return false;
  }

  private tryPipeline(init: AstNode, resultVar: string, leading: string | undefined): boolean {
    const args = nodes(init.arguments);
    if (args.length < 2) return false;
    const stages: PipelineStage[] = [];
    for (let i = 1; i < args.length; i++) {
      const arrow = args[i];
      if (arrow.type !== 'ArrowFunctionExpression') return false;
      const body = node(arrow.body);
      if (
        arrow.async !== true &&
        body &&
        body.type === 'CallExpression' &&
        callName(body) === 'agent'
      ) {
        const params = nodes(arrow.params)
          .map(p => this.src(p))
          .join(', ');
        const step = this.parseAgentCall(body, `${resultVar}-stage-${i}`);
        if (step) {
          stages.push({ kind: 'agent', params, step });
          continue;
        }
      }
      stages.push({ kind: 'code', source: this.src(arrow) });
    }
    this.sink().push({
      kind: 'pipeline',
      resultVar,
      itemsSource: this.src(args[0]),
      stages,
      ...(leading ? { leading } : {}),
    });
    return true;
  }

  /**
   * A return the compiler regenerates identically (the last phase's step
   * variables) is dropped; anything else must survive as a code node.
   */
  private isAutoReturn(statement: AstNode): boolean {
    const last = this.phases[this.phases.length - 1];
    if (!last) return false;
    const returnable = last.nodes.flatMap(n =>
      n.kind === 'step' ? [n.step] : n.kind === 'parallel' ? n.steps : []
    );
    if (returnable.length === 0) return false;
    const expected = returnable.map(s => s.resultVar ?? stepVarName(s.id));
    const argument = node(statement.argument);
    if (!argument) return false;
    if (argument.type === 'Identifier') {
      return expected.length === 1 && argument.name === expected[0];
    }
    if (argument.type === 'ObjectExpression') {
      const props = nodes(argument.properties);
      if (props.length !== expected.length) return false;
      return props.every((property, i) => {
        if (property.type !== 'Property' || property.shorthand !== true) return false;
        const value = node(property.value);
        return value?.type === 'Identifier' && value.name === expected[i];
      });
    }
    return false;
  }

  handleStatement(statement: AstNode, leading: string | undefined): void {
    if (statement.type === 'EmptyStatement') return;
    if (statement.type === 'ReturnStatement' && this.isAutoReturn(statement)) return;
    if (this.tryPhase(statement, leading)) return;
    if (this.tryLog(statement, leading)) return;
    if (this.tryDeclaration(statement, leading)) return;
    const schema = this.detectSchemaConst(statement);
    this.sink().push({
      kind: 'code',
      source: this.src(statement),
      ...(leading ? { leading } : {}),
      ...(schema?.name ? { schemaName: schema.name } : {}),
      ...(schema?.model ? { schemaModel: schema.model } : {}),
    });
  }

  /**
   * A verbatim `const NAME = {schema literal}` that survived the structured
   * parsers (it is not agent/parallel/pipeline). We keep the source verbatim but
   * attach the binding name and a static schema projection so the Canvas can
   * present it as a first-class schema — and edit its fields — when an agent
   * references it via `schema: NAME`. Non-schema object consts return null.
   */
  private detectSchemaConst(
    statement: AstNode
  ): { name: string; model?: ReturnType<typeof schemaModelFromLiteral> } | null {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') return null;
    const declarations = nodes(statement.declarations);
    if (declarations.length !== 1) return null;
    const id = node(declarations[0].id);
    const init = node(declarations[0].init);
    if (id?.type !== 'Identifier' || typeof id.name !== 'string') return null;
    if (init?.type !== 'ObjectExpression') return null;
    const literal = strictLiteralValue(init);
    if (!literal.ok) return null;
    const model = schemaModelFromLiteral(literal.value);
    return model ? { name: id.name, model } : null;
  }
}

export function parseWorkflowScript(source: string, fileName: string): ParsedWorkflowScript {
  const stem = fileName.replace(/\.js$/, '');
  const comments: Comment[] = [];
  let program: AstNode;
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      onComment: (block, text, start, end) => {
        comments.push({ block, text, start, end });
      },
    }) as unknown as AstNode;
  } catch (error) {
    return {
      blueprint: {
        name: stem,
        description: '',
        version: '0.1.0',
        brief: commentsBrief(source),
        phases: [],
      },
      structured: false,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  const parser = new ScriptParser(source);
  const brief = commentsBrief(source);
  const body = nodes(program.body);
  const trivia = comments.filter(c => c.block || !GENERATED_COMMENT_RE.test(c.text));

  let cursor = 0;
  const leadingFor = (upTo: number): string | undefined => {
    const own: Comment[] = [];
    while (trivia.length > 0 && trivia[0].start < upTo) {
      const c = trivia.shift()!;
      if (c.start >= cursor) own.push(c);
    }
    return renderComments(own);
  };

  // The meta export is regenerated from structured fields; find it first so
  // its position anchors the header comments and it never becomes a code node.
  let metaHandled = false;
  let unsafeMeta = false;
  for (const statement of body) {
    const leading = leadingFor(statement.start);
    if (!metaHandled) {
      const metaResult = parser.parseMetaDeclaration(statement);
      if (metaResult !== 'not-meta') {
        metaHandled = true;
        if (metaResult === 'safe') {
          if (leading) parser.header = leading;
          cursor = statement.end;
          continue;
        }
        // Keep the declaration visible in the read-only projection as well as
        // intact in `source`; visual saving is disabled below.
        unsafeMeta = true;
      }
    }
    parser.handleStatement(statement, leading);
    cursor = statement.end;
  }
  const trailer = renderComments(trivia.filter(c => c.start >= cursor));

  const meta = parser.meta;
  brief.goal = typeof meta.whenToUse === 'string' ? meta.whenToUse : '';

  const blueprint: Blueprint = {
    ...(parser.header ? { header: parser.header } : {}),
    name: typeof meta.name === 'string' ? meta.name : stem,
    description: typeof meta.description === 'string' ? meta.description : '',
    version: typeof meta.version === 'string' ? meta.version : '0.1.0',
    brief,
    ...(parser.metaExtras ? { metaExtras: parser.metaExtras } : {}),
    ...(parser.preamble.length > 0 ? { preamble: parser.preamble } : {}),
    phases: parser.phases,
    ...(trailer ? { trailer } : {}),
  };

  return {
    blueprint,
    structured: !unsafeMeta,
    parseError: unsafeMeta
      ? 'Dynamic workflow metadata cannot be represented safely in the visual editor.'
      : null,
  };
}
