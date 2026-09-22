import { contentRows, numberedRows } from './file-view';
import type { FileRow } from './file-view';
import { hasHeredoc, splitPipeline, splitStatements } from './shell';
import { fileExt } from './utils';
import type { ProcessedMessage, ToolGroup } from './utils';

/**
 * The files a session read — what the Lens context rail lists.
 *
 * Two sources. A `Read` call names its file and prints the lines it read,
 * numbered, so both are facts. A shell command names files only in its text,
 * and in this corpus that is where most reading happens (`sed -n`, `cat`,
 * `grep` outnumber `Read` a hundred to one), so it is parsed — conservatively:
 * a command Claude Code recorded as having changed files (`bashEditDiff`) read
 * nothing for our purposes, and a construct we cannot follow (a heredoc, a
 * substitution, a variable in the path) names no file rather than a wrong one.
 */

/** The lines of a file a read put on screen. `end` is null when the read ran to
 *  the end of the file without saying where that is (`cat`, `tail -n +K`). */
export type ReadSpan = { start: number; end: number | null };

export type ContextRead = {
  /** Index into `processed` of the turn whose tool call read the file. */
  idx: number;
  group: ToolGroup;
  via: 'Read' | 'shell';
  span: ReadSpan | null;
  /** The result is this file's lines and nothing else: always for a `Read`; for
   *  a shell read only when the command was that one read — one statement, one
   *  file, no pipe. A compound command's output holds everything it printed,
   *  and numbering it as this file's lines would put another file's text, or a
   *  grep's, at line 840 of this one. */
  exact: boolean;
};

export type ContextFile = {
  path: string;
  ext: string;
  /** Every read of the path, in transcript order. */
  reads: ContextRead[];
};

/** Every file the session read, in the order it was first read. */
export function contextFiles(processed: ProcessedMessage[], cwd: string | null): ContextFile[] {
  const byPath = new Map<string, ContextFile>();
  processed.forEach((p, idx) => {
    for (const group of p.toolGroups) {
      for (const r of readsOf(group, cwd)) {
        const read: ContextRead = { idx, group, via: r.via, span: r.span, exact: r.exact };
        const cur = byPath.get(r.path);
        if (cur) cur.reads.push(read);
        else byPath.set(r.path, { path: r.path, ext: fileExt(r.path), reads: [read] });
      }
    }
  });
  return [...byPath.values()];
}

type FoundRead = ShellRead & { via: ContextRead['via'] };

function readsOf(group: ToolGroup, cwd: string | null): FoundRead[] {
  const result = group.result;
  // No result yet, or a failed call: nothing reached the model.
  if (!result || result.isError) return [];
  const input = group.use.input as Record<string, unknown>;
  if (group.use.name === 'Read') {
    const path = input.file_path;
    if (typeof path !== 'string' || !path) return [];
    return [{ path, via: 'Read', span: numberedSpan(result.content), exact: true }];
  }
  if (group.use.name === 'Bash' && !result.bashEditDiff && typeof input.command === 'string') {
    return shellReads(input.command, cwd).map(r => ({ ...r, via: 'shell' }));
  }
  return [];
}

/** First and last line number a `Read` printed; null for an image or a marker. */
export function numberedSpan(content: string): ReadSpan | null {
  const lines = (numberedRows(content) ?? []).flatMap(r => (r.line === undefined ? [] : [r.line]));
  return lines.length > 0 ? { start: lines[0], end: lines[lines.length - 1] } : null;
}

/** The rows the peek draws for one read: numbered where the numbers are known —
 *  a `Read` prints them, a `sed -n a,bp` or `head` says where it started. */
export function readRows(read: ContextRead): FileRow[] {
  const content = read.group.result?.content ?? '';
  if (read.via === 'Read') return numberedRows(content) ?? contentRows(content).map(unnumbered);
  const start = read.exact ? read.span?.start : undefined;
  const rows = contentRows(content);
  return start === undefined
    ? rows.map(unnumbered)
    : rows.map((r, i) => ({ ...r, line: start + i }));
}

const unnumbered = (r: FileRow): FileRow => ({ kind: r.kind, text: r.text });

/** Every line the reads of a file put on screen, merged: `lines 1–60, 385–460`,
 *  `whole file`, or null when no read said which lines it printed. */
export function coverageLabel(reads: ContextRead[]): string | null {
  const spans = reads.flatMap(r => (r.span ? [r.span] : [])).sort((a, b) => a.start - b.start);
  if (spans.length === 0) return null;
  const merged: ReadSpan[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && (last.end === null || s.start <= last.end + 1)) {
      if (last.end !== null) last.end = s.end === null ? null : Math.max(last.end, s.end);
    } else merged.push({ ...s });
  }
  if (merged[0].start === 1 && merged[0].end === null) return 'whole file';
  const part = (s: ReadSpan) =>
    s.end === null ? `${s.start}–end` : s.start === s.end ? `${s.start}` : `${s.start}–${s.end}`;
  return `${merged.length === 1 && merged[0].start === merged[0].end ? 'line' : 'lines'} ${merged.map(part).join(', ')}`;
}

/** `lines 12–40`, `line 7`, `whole file`, `from line 30`; null when unknown. */
export function spanLabel(span: ReadSpan | null): string | null {
  if (!span) return null;
  if (span.end === null) return span.start === 1 ? 'whole file' : `from line ${span.start}`;
  return span.start === span.end ? `line ${span.start}` : `lines ${span.start}–${span.end}`;
}

export type ContextGroup = {
  /** The folder's absolute path. */
  key: string;
  /** Its last two segments inside the project, the project's name at its root. */
  label: string;
  /** The folder as the project sees it, for the tooltip. */
  title: string;
  files: ContextFile[];
};

/** Files by folder, in the order each folder was first read from. */
export function groupContextFiles(files: ContextFile[], cwd: string | null): ContextGroup[] {
  const root = cwd?.replace(/\/+$/, '') || null;
  const groups = new Map<string, ContextGroup>();
  for (const f of files) {
    const cut = f.path.lastIndexOf('/');
    const dir = cut > 0 ? f.path.slice(0, cut) : '/';
    let g = groups.get(dir);
    if (!g) {
      g = { key: dir, ...folderLabel(dir, root), files: [] };
      groups.set(dir, g);
    }
    g.files.push(f);
  }
  return [...groups.values()];
}

function folderLabel(dir: string, root: string | null): { label: string; title: string } {
  if (root && dir === root) {
    const name = root.split('/').pop() || root;
    return { label: name, title: root };
  }
  const inside = root !== null && dir.startsWith(`${root}/`);
  const rel = inside ? dir.slice(root.length + 1) : dir;
  const segments = rel.split('/').filter(Boolean);
  const tail = segments.slice(-2).join('/');
  const label = segments.length > 2 || !inside ? `…/${tail}` : tail;
  return { label: segments.length === 0 ? '/' : label, title: rel || '/' };
}

/** The greatest rendered turn at or before `n` — a read in a tool-only turn
 *  that MIN density folds away belongs to the turn it is folded into. */
export function nearestTurn(sortedTurns: number[], n: number): number | null {
  let lo = 0;
  let hi = sortedTurns.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTurns[mid] <= n) {
      found = sortedTurns[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// ── shell ────────────────────────────────────────────────────────────────

type Word = { text: string; safe: boolean };
type Parsed = { files: Word[]; span: ReadSpan | null };
type ShellRead = { path: string; span: ReadSpan | null; exact: boolean };

/** The files a shell command read, with the lines it printed when the command
 *  says (`sed -n 10,40p`, `head -n 20`). Relative paths resolve against `cwd`,
 *  moved by any `cd` along the way. */
export function shellReads(command: string, cwd: string | null): ShellRead[] {
  if (hasHeredoc(command)) return [];
  const out = new Map<string, ReadSpan | null>();
  let dir = cwd;
  const statements = splitStatements(command);
  // `cd x && sed -n 1,9p f` is still one read; any other statement adds output.
  const doing = statements.filter(st => shellWords(st)?.[0]?.text !== 'cd').length;
  let exact = false;
  for (const statement of statements) {
    const words = shellWords(statement);
    if (words?.[0]?.text === 'cd') {
      dir = words.length === 2 && words[1].safe ? resolvePath(dir, words[1].text) : null;
      continue;
    }
    // Only the first stage of a pipeline reads files; the rest read its output.
    const stages = splitPipeline(statement);
    const stage = shellWords(stages[0]);
    const parsed = stage ? parseReader(stage) : null;
    if (!parsed) continue;
    // Piped on, what reached the model is what the rest of the pipe let
    // through (`sed -n 1,400p f | grep x`), not the lines the reader printed.
    const span = stages.length > 1 ? null : parsed.span;
    exact = doing === 1 && stages.length === 1 && parsed.files.length === 1;
    for (const f of parsed.files) {
      const path = f.safe ? resolvePath(dir, f.text) : null;
      if (path && !out.has(path)) out.set(path, span);
    }
  }
  return [...out].map(([path, span]) => ({ path, span, exact: exact && out.size === 1 }));
}

function parseReader(words: Word[]): Parsed | null {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].text)) i++;
  const cmd = words[i]?.text.split('/').pop();
  const args = words.slice(i + 1);
  if (cmd === 'cat' || cmd === 'nl') return catArgs(args);
  if (cmd === 'head') return headArgs(args);
  if (cmd === 'tail') return tailArgs(args);
  if (cmd === 'sed') return sedArgs(args);
  if (cmd === 'grep') return grepArgs(args);
  return null;
}

function catArgs(args: Word[]): Parsed {
  return { files: walk(args, []).pos, span: { start: 1, end: null } };
}

function headArgs(args: Word[]): Parsed {
  const { opts, pos } = walk(args, ['-n', '-c', '--lines', '--bytes']);
  if (opts.has('-c') || opts.has('--bytes')) return { files: pos, span: null };
  const shorthand = [...opts.keys()].find(k => /^-\d+$/.test(k));
  const n = Number(
    shorthand ? shorthand.slice(1) : (opts.get('-n') ?? opts.get('--lines') ?? '10')
  );
  return { files: pos, span: Number.isInteger(n) && n > 0 ? { start: 1, end: n } : null };
}

function tailArgs(args: Word[]): Parsed {
  const { opts, pos } = walk(args, ['-n', '-c', '--lines', '--bytes']);
  const n = opts.get('-n') ?? opts.get('--lines') ?? '';
  const from = /^\+(\d+)$/.exec(n);
  return { files: pos, span: from ? { start: Number(from[1]), end: null } : null };
}

function sedArgs(args: Word[]): Parsed | null {
  const { opts, pos } = walk(args, ['-e', '-f', '--expression', '--file']);
  const keys = [...opts.keys()];
  // In place is a write; without -n sed prints a rewrite of the file, not the file.
  if (keys.some(k => k === '--in-place' || /^-[a-zA-Z]*i/.test(k))) return null;
  if (!keys.some(k => k === '--quiet' || k === '--silent' || /^-[a-zA-Z]*n/.test(k))) return null;
  if (opts.has('-f') || opts.has('--file')) return null;
  const script = opts.get('-e') ?? opts.get('--expression') ?? pos.shift()?.text ?? '';
  const m = /^\s*(\d+)(?:,(\d+|\$))?p\s*$/.exec(script);
  const span = m ? { start: Number(m[1]), end: m[2] === '$' ? null : Number(m[2] ?? m[1]) } : null;
  return { files: pos, span: pos.length === 1 ? span : null };
}

const GREP_VALUED = ['-e', '-f', '-A', '-B', '-C', '-m', '--regexp', '--file', '--max-count'];

function grepArgs(args: Word[]): Parsed | null {
  const { opts, pos } = walk(args, GREP_VALUED);
  const keys = [...opts.keys()].filter(k => !GREP_VALUED.includes(k));
  // Recursive greps name directories; -l/-L/-c print names or counts, not lines.
  const listing = ['--recursive', '--files-with-matches', '--files-without-match', '--count'];
  if (keys.some(k => listing.includes(k) || /^-[a-zA-Z]*[rRlLc]/.test(k))) return null;
  if (!opts.has('-e') && !opts.has('--regexp') && !opts.has('-f')) pos.shift();
  return pos.length > 0 ? { files: pos, span: null } : null;
}

/** Options and positional arguments. `valued` options take the next word (or
 *  the rest of their own, `-n20`); a long `--opt=value` carries its value. */
function walk(args: Word[], valued: string[]): { opts: Map<string, string>; pos: Word[] } {
  const opts = new Map<string, string>();
  const pos: Word[] = [];
  for (let i = 0; i < args.length; i++) {
    const text = args[i].text;
    if (text === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (!text.startsWith('-') || text === '-') {
      if (text !== '-') pos.push(args[i]);
      continue;
    }
    const eq = text.indexOf('=');
    if (text.startsWith('--') && eq > 0) {
      opts.set(text.slice(0, eq), text.slice(eq + 1));
      continue;
    }
    const flag = valued.find(v => text === v || (!v.startsWith('--') && text.startsWith(v)));
    if (flag) opts.set(flag, text === flag ? (args[++i]?.text ?? '') : text.slice(flag.length));
    else opts.set(text, '');
  }
  return { opts, pos };
}

/** Words of one simple command, quotes removed. A word is `safe` as a path only
 *  when nothing in it expands (`$`, globs, `~`). Redirections are dropped with
 *  their target; a substitution or a subshell makes the command unreadable. */
function shellWords(src: string): Word[] | null {
  const words: Word[] = [];
  let buf = '';
  let safe = true;
  let started = false;
  let quote: string | null = null;
  let dropNext = false;
  const push = () => {
    if (started && !dropNext) words.push({ text: buf, safe });
    else if (started) dropNext = false;
    buf = '';
    safe = true;
    started = false;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < src.length) buf += src[++i];
      else {
        if (quote === '"' && (c === '$' || c === '`')) safe = false;
        buf += c;
      }
      continue;
    }
    if (/\s/.test(c)) push();
    else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === '\\' && i + 1 < src.length) {
      buf += src[++i];
      started = true;
    } else if (c === '`' || c === '(' || c === ')') return null;
    else if (c === '>' || c === '<') {
      if (src[i + 1] === '(') return null;
      // `2>`, `&>` — the fd number is part of the redirection, not a word.
      if (/^\d*&?$/.test(buf)) started = false;
      push();
      while (src[i + 1] === '>' || src[i + 1] === '&') i++;
      // `2>&1` names a descriptor, not a file: nothing to drop after it.
      if (src[i] === '&' && /\d/.test(src[i + 1] ?? '')) i++;
      else dropNext = true;
    } else {
      if ('$*?[]{}~'.includes(c)) safe = false;
      buf += c;
      started = true;
    }
  }
  if (quote) return null;
  push();
  return words;
}

/** Absolute POSIX path of `p` seen from `dir`; null when it cannot be known. */
function resolvePath(dir: string | null, p: string): string | null {
  if (!p) return null;
  if (p.startsWith('/')) return normalizePath(p);
  if (!dir || !dir.startsWith('/')) return null;
  return normalizePath(`${dir}/${p}`);
}

function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `/${out.join('/')}`;
}
