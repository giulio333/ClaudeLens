// Pure helpers for the Agent Studio editor UI. The interpolation scanner
// mirrors `scanInterpolations` in electron/modules/studio-compiler.ts (the
// canonical, unit-tested implementation the compiler uses) — duplicated here
// because renderer code cannot import electron modules.

// Shared form styling (kept here so the editor view and the inspector don't drift).
export const labelCls =
  'flex items-center font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cl-ink-3)] mb-1.5';
export const inputCls =
  'w-full rounded-[7px] border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[13px] text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink-2)] transition-colors';

export interface Interpolation {
  start: number;
  end: number;
  expr: string;
}

/** Balanced-brace scan for `${...}` interpolations in a prompt template. */
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

/** Unique `${ref}` expressions used by a prompt, in order of first use. */
export function promptRefs(prompt: string): string[] {
  const seen = new Set<string>();
  for (const m of scanInterpolations(prompt)) seen.add(m.expr);
  return [...seen];
}

// A name only: an identifier, a step-id slug (`security-check`) or a property
// path (`picked.number`). Anything with an operator, a call, a quote or a space
// is not a reference to a producer — it is JavaScript that BUILDS prompt text.
const SIMPLE_REF_RE = /^[A-Za-z0-9_$][A-Za-z0-9_$:.-]*$/;

export function isSimpleRef(expr: string): boolean {
  return SIMPLE_REF_RE.test(expr.trim());
}

/**
 * Every name that reaches a step's output: the step id (what a visual prompt
 * interpolates), the compiled variable, and the variable a parsed native script
 * actually binds — routinely a third, unrelated name (`label: 'pick-issue'`
 * assigned to `const picked`).
 */
export function stepRefKeys(step: { id: string; resultVar?: string }): string[] {
  return [step.id, stepVarName(step.id), ...(step.resultVar ? [step.resultVar] : [])];
}

/** Index of every such name → the id of the step that produces it. */
export function buildRefIndex(steps: { id: string; resultVar?: string }[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const step of steps) {
    for (const key of stepRefKeys(step)) if (key && !index.has(key)) index.set(key, step.id);
  }
  return index;
}

/** The step a `${ref}` reads from — matching the whole token, else its base (`a` of `a.b`). */
export function resolveRef(index: ReadonlyMap<string, string>, expr: string): string | null {
  const token = expr.trim();
  const hit = index.get(token);
  if (hit) return hit;
  const base = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(token)?.[0];
  return (base && index.get(base)) ?? null;
}

/**
 * Display form of a live expression: string/template bodies elided (their text
 * is prompt content, not structure — a ternary reads as
 * `forcedIssue ? `…` : `…``), whitespace collapsed, then clamped. The full
 * expression stays available in the chip's tooltip.
 */
export function compactExpr(expr: string, max = 44): string {
  let out = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < expr.length && expr[j] !== ch) j += expr[j] === '\\' ? 2 : 1;
      out += j > i + 1 ? `${ch}…${ch}` : `${ch}${ch}`;
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  const compact = out.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

// Private-use sentinels for `maskInterpolations`. A prompt is a template
// literal, not a markdown document: its `${…}` bodies carry dollars, nested
// backticks and braces that a markdown parser happily reinterprets (math
// delimiters, code spans), rendering a prompt the agent will never receive.
// Masking each interpolation to an opaque token keeps that syntax out of the
// parse entirely; the renderer puts the real expression back afterwards.
const MASK_OPEN = '\uE000';
const MASK_CLOSE = '\uE001';
const MASK_RE = /\uE000(\d+)\uE001/g;

export interface MaskedPrompt {
  /** Prompt text with every live `${expr}` replaced by an opaque sentinel. */
  text: string;
  /** The masked expressions, indexed by the sentinel they replaced. */
  exprs: string[];
}

export function maskInterpolations(prompt: string): MaskedPrompt {
  // Strip stray sentinels first: they can only come from the prompt itself, and
  // leaving them in would let user text impersonate a mask.
  const source = prompt.replace(/[\uE000\uE001]/g, '');
  const exprs: string[] = [];
  let out = '';
  let last = 0;
  for (const m of scanInterpolations(source)) {
    out += source.slice(last, m.start) + `${MASK_OPEN}${exprs.length}${MASK_CLOSE}`;
    exprs.push(m.expr);
    last = m.end;
  }
  return { text: out + source.slice(last), exprs };
}

export type MaskSegment = { kind: 'text'; text: string } | { kind: 'expr'; index: number };

/** Split rendered text back into literal runs and the interpolations it masked. */
export function maskSegments(text: string): MaskSegment[] {
  const segments: MaskSegment[] = [];
  let last = 0;
  MASK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MASK_RE.exec(text)) !== null) {
    if (m.index > last) segments.push({ kind: 'text', text: text.slice(last, m.index) });
    segments.push({ kind: 'expr', index: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/** Text/expression segments of a dynamic label template literal, for display. */
export type LabelPart = { kind: 'text'; text: string } | { kind: 'expr'; expr: string };

export function labelParts(dynamicLabel: string): LabelPart[] {
  const body = dynamicLabel.replace(/^`|`$/g, '');
  const parts: LabelPart[] = [];
  let last = 0;
  for (const m of scanInterpolations(body)) {
    if (m.start > last) parts.push({ kind: 'text', text: body.slice(last, m.start) });
    parts.push({ kind: 'expr', expr: m.expr });
    last = m.end;
  }
  if (last < body.length) parts.push({ kind: 'text', text: body.slice(last) });
  return parts;
}

/** Accent hue for a step's model dot (mirrors the model families elsewhere). */
export function modelDot(model?: string): string {
  if (model === 'opus') return 'var(--cl-violet)';
  if (model === 'haiku') return 'var(--cl-haiku)';
  if (model === 'sonnet') return 'var(--cl-cyan)';
  return 'var(--cl-ink-4)';
}

/** Single-line excerpt of a prompt for card display. */
export function promptExcerpt(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, ' ');
  return text.length > 230 ? `${text.slice(0, 230)}…` : text;
}

/**
 * The tested condition of a guard (`if (…) return …`), source-verbatim. What a
 * guard READS is its condition: the value it returns when the condition trips
 * is its own early output, not an input — the same reason a guard draws no edge
 * into the workflow's final output.
 */
export function guardCondition(source: string): string | null {
  return /^if\s*\(([\s\S]*?)\)\s*(?:\{|return)/.exec(source.trim())?.[1]?.trim() ?? null;
}

/** Plain-language reading of a verbatim code block for the spine note / canvas block. */
export function describeCode(source: string): { tag: string; label: string } {
  const compact = source.trim().replace(/\s+/g, ' ');
  const excerpt = compact.length > 110 ? `${compact.slice(0, 110)}…` : compact;
  if (/^if\b/.test(compact) && /\breturn\b/.test(compact)) {
    const cond = guardCondition(source);
    return {
      tag: 'guard',
      label: cond ? `stops early when ${cond}` : `stops early — ${excerpt}`,
    };
  }
  if (/^return\b/.test(compact)) return { tag: 'result', label: `workflow output — ${excerpt}` };
  if (/^(const|let|var)\b/.test(compact)) return { tag: 'setup', label: excerpt };
  return { tag: 'code', label: excerpt };
}

/**
 * The value a guard returns when its condition trips, as a compact display
 * string — read verbatim from the guard's own `return`. `null` for a bare
 * `return;` (no value). A guard is a distinct early termination: it returns
 * THIS value and short-circuits the rest, so the card shows it instead of
 * implying the guard feeds the workflow's (unrelated) final output.
 */
export function guardReturnValue(source: string): string | null {
  const idx = source.search(/\breturn\b/);
  if (idx < 0) return null;
  let rest = source.slice(idx + 'return'.length);
  const semi = rest.indexOf(';');
  if (semi >= 0) rest = rest.slice(0, semi);
  else rest = rest.replace(/\s*\}\s*$/, ''); // drop the guard block's closing brace
  const expr = rest.replace(/\s+/g, ' ').trim();
  if (!expr) return null;
  return expr.length > 64 ? `${expr.slice(0, 64)}…` : expr;
}

// The reserved-var set and stepVarName mirror studio-compiler.ts (the canonical,
// unit-tested implementation) — duplicated here because renderer code cannot
// import electron modules. Kept in lock-step so the Canvas can match a code
// node's compiled identifier (`securityCheck`) back to its step id
// (`security-check`).
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

/** `security-check` → `securityCheck`; always a safe, non-reserved JS identifier. */
export function stepVarName(id: string): string {
  let v = id
    .replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, (_, c: string) => c.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, '');
  if (!v || /^[0-9]/.test(v)) v = `step${v.charAt(0).toUpperCase()}${v.slice(1)}`;
  if (RESERVED_VARS.has(v)) v = `${v}Step`;
  return v;
}

const JS_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'void',
  'this',
  'null',
  'true',
  'false',
  'undefined',
  'await',
  'async',
  'yield',
  'throw',
  'try',
  'catch',
  'finally',
  'class',
  'extends',
  'super',
  'import',
  'export',
  'default',
  'from',
]);

/**
 * Blank out string/template contents so an identifier scan does not pick up
 * words inside quotes. Interpolation bodies (`${…}`) are dropped along with the
 * template text — the code nodes we scan (guards, mappers, returns) reference
 * producers outside of strings.
 */
function stripStringLiterals(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    // Line + block comments
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Distinct top-level identifiers referenced in a verbatim code source, with
 * string/comment contents removed and JS keywords filtered out. Property
 * accesses (`a.b`) contribute the base identifier `a`; the graph matches these
 * against the set of known producer variables.
 */
export function scanIdentifiers(source: string): string[] {
  const stripped = stripStringLiterals(source);
  const seen = new Set<string>();
  // A member/property name (preceded by `.`) is not a free variable reference.
  const re = /(\.)?\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    if (m[1] === '.') continue; // property access — skip the name after a dot
    const name = m[2];
    if (JS_KEYWORDS.has(name)) continue;
    seen.add(name);
  }
  return [...seen];
}

/**
 * Strip the common indentation a verbatim source slice carries from its
 * original position in the script (the first line starts at the expression,
 * so only the continuation lines are measured).
 */
export function dedentSource(source: string): string {
  const lines = source.split('\n');
  if (lines.length <= 1) return source;
  const rest = lines.slice(1);
  const indents = rest
    .filter(line => line.trim().length > 0)
    .map(line => /^[ \t]*/.exec(line)![0].length);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  if (common === 0) return source;
  return [lines[0], ...rest.map(line => line.slice(common))].join('\n');
}
