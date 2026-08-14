/** Presentation model for shell commands and their output (Bash tool).
 *
 *  Pure on purpose: the interesting part is *where a one-liner may be cut* so it
 *  reads as a sequence of steps instead of one wrapped paragraph — and that has
 *  to survive quotes, `$(…)`, jsonpath braces and `2>&1`. Those are rules worth
 *  unit tests (`test/shell.test.ts`), not a regex buried in JSX.
 */

import { WEB_SEARCH } from './web';

/** Operator that joins a step to the next one (`''` on the last step). */
export type ShellOp = '' | ';' | '&&' | '||' | '&' | '|';

export type ShellStep = {
  /** Pipeline stages of this step. Longer than 1 only when the step was long
   *  enough that breaking at `|` reads better than one wrapped line. */
  parts: string[];
  op: ShellOp;
};

export type ParsedShellCommand =
  /** A one-liner, split into its top-level statements. */
  | { mode: 'steps'; steps: ShellStep[] }
  /** Already-formatted source (multi-line, or carrying a heredoc we must not
   *  cut through): kept verbatim, the author's own line breaks are the model. */
  | { mode: 'script'; source: string; lines: number };

/** A step longer than this is broken at its top-level pipes. Below it, a
 *  pipeline is short enough to read on one line and splitting only adds rows. */
const PIPE_BREAK_MIN = 72;

/** `<<EOF` / `<<-'EOF'` — the body may contain anything, so we never cut it. */
const HEREDOC_RE = /<<-?\s*(['"]?)[A-Za-z_][A-Za-z0-9_]*\1/;

type OpMatch = { op: ShellOp; len: number };

/** Walks `src` at shell-lexer depth (quotes, `$(…)`, `{…}`) and cuts wherever
 *  `matchOp` recognises a top-level operator. `prev` is the last non-space
 *  character consumed, which is what tells `2>&1` from a background `&`. */
function scanSplit(
  src: string,
  matchOp: (src: string, i: number, prev: string) => OpMatch | null
): Array<{ text: string; op: ShellOp }> {
  const out: Array<{ text: string; op: ShellOp }> = [];
  let buf = '';
  let prev = '';
  let quote: string | null = null;
  let depth = 0;

  const flush = (op: ShellOp) => {
    const text = buf.trim();
    if (text) out.push({ text, op });
    else if (op && out.length > 0) out[out.length - 1].op = op;
    buf = '';
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quote) {
      buf += c;
      if (c === '\\' && quote !== "'" && i + 1 < src.length) buf += src[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') {
      buf += i + 1 < src.length ? c + src[++i] : c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      buf += c;
      prev = c;
      continue;
    }
    if (c === '(' || c === '{') {
      depth++;
      buf += c;
      prev = c;
      continue;
    }
    if (c === ')' || c === '}') {
      if (depth > 0) depth--;
      buf += c;
      prev = c;
      continue;
    }
    if (depth === 0) {
      const m = matchOp(src, i, prev);
      if (m) {
        flush(m.op);
        i += m.len - 1;
        prev = '';
        continue;
      }
    }
    buf += c;
    if (!/\s/.test(c)) prev = c;
  }
  flush('');
  return out;
}

function statementOp(src: string, i: number, prev: string): OpMatch | null {
  const c = src[i];
  if (c === '\n') return { op: '', len: 1 };
  if (c === ';') return { op: ';', len: 1 };
  if (c === '&' && src[i + 1] === '&') return { op: '&&', len: 2 };
  if (c === '|' && src[i + 1] === '|') return { op: '||', len: 2 };
  if (c === '&') {
    // `2>&1`, `>&2`, `&>log` are redirections — not a backgrounded job.
    if (src[i + 1] === '>' || prev === '>' || prev === '<') return null;
    return { op: '&', len: 1 };
  }
  return null;
}

function pipeOp(src: string, i: number): OpMatch | null {
  if (src[i] !== '|' || src[i + 1] === '|') return null;
  // `|&` pipes stderr too: consume both so no stray `&` is left behind.
  return { op: '|', len: src[i + 1] === '&' ? 2 : 1 };
}

/** Top-level pipeline stages of a single statement. */
export function splitPipeline(text: string): string[] {
  const parts = scanSplit(text, pipeOp).map(p => p.text);
  return parts.length > 1 ? parts : [text];
}

export function parseShellCommand(raw: string, pipeBreakMin = PIPE_BREAK_MIN): ParsedShellCommand {
  const source = raw.replace(/\s+$/, '');
  if (!source.trim()) return { mode: 'steps', steps: [] };
  if (source.includes('\n') || HEREDOC_RE.test(source)) {
    return { mode: 'script', source, lines: source.split('\n').length };
  }
  const steps = scanSplit(source, statementOp).map(({ text, op }) => ({
    parts: text.length >= pipeBreakMin ? splitPipeline(text) : [text],
    op,
  }));
  return { mode: 'steps', steps };
}

/** What opens a rendered line. `'❯'` is the real prompt and appears **once** per
 *  run: the command was typed at one prompt, and a glyph per statement would
 *  invent prompts that never happened. Continuation lines are opened by the
 *  connective that governs them instead. */
export type PromptLead = '❯' | '&&' | '||' | '|' | '';

export type PromptRow = {
  lead: PromptLead;
  code: string;
  /** `&` backgrounds the line it follows, so it stays a suffix of that line. */
  suffix?: '&';
};

/** Lays a command out for reading: the operator leads the line it governs, the
 *  way a formatter breaks a long shell line — never trailing the line before,
 *  where the eye has already moved on.
 *
 *  `;` prints nothing: to the shell a `;` and a newline are the same thing, so
 *  the line break already says it. Only the connectives that change *what runs
 *  next* (`&&`, `||`, `|`) earn ink. */
export function promptRows(command: string): PromptRow[] {
  const parsed = parseShellCommand(command);
  if (parsed.mode === 'script') {
    return parsed.source.split('\n').map((code, i) => ({ lead: i === 0 ? '❯' : '', code }));
  }
  const rows: PromptRow[] = [];
  parsed.steps.forEach((step, i) => {
    const prev = i === 0 ? null : parsed.steps[i - 1].op;
    const lead: PromptLead = i === 0 ? '❯' : prev === '&&' || prev === '||' ? prev : '';
    step.parts.forEach((code, j) => {
      const last = j === step.parts.length - 1;
      rows.push({
        lead: j === 0 ? lead : '|',
        code,
        ...(last && step.op === '&' ? { suffix: '&' as const } : {}),
      });
    });
  });
  return rows;
}

/* eslint-disable-next-line no-control-regex --
   Matching the ESC byte is the whole point: shell output recorded from a command
   that thought it had a tty carries CSI/OSC sequences, which render as garbage. */
const ANSI_RE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_])/g;

/** Makes recorded shell output printable: drops ANSI escapes and collapses each
 *  carriage-return run to what a terminal would actually have left on screen
 *  (progress bars and spinners rewrite one line instead of adding thousands). */
export function normalizeOutput(raw: string): string {
  return raw
    .replace(ANSI_RE, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => (line.includes('\r') ? line.slice(line.lastIndexOf('\r') + 1) : line))
    .join('\n')
    .replace(/\s+$/, '');
}

/** Tools rendered as ONE unit spanning input and result (`CommandSheet`), so the
 *  host must not split them into an "Input" section and a "Result" section with
 *  a head each: the output is the answer to the command, not a second topic. */
export function ownsToolBody(tool: string): boolean {
  return tool === 'Bash';
}

/** Results rendered as shell output (`CommandOutput`): a `BashOutput` read is
 *  plain shell output, but its input (`bash_id`) is nothing special, so only the
 *  result side is claimed. */
export function isShellOutput(tool: string): boolean {
  return tool === 'BashOutput' || ownsToolBody(tool);
}

/** Tools whose *result* renderer draws its own labelled head, so the host must
 *  not print one above it. Shell output labels itself; a `WebSearch` opens with
 *  its own SOURCES head, and an "Output · 47 lines" above that is a second title
 *  for one block. Name-only, deliberately: a **failed** result still takes the
 *  host's "Error" label, which no body draws for itself. */
export function ownsOutputHead(tool: string): boolean {
  return isShellOutput(tool) || tool === WEB_SEARCH;
}
