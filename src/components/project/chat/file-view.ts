/** Presentation model for the file tools (Read / Write / Edit).
 *
 *  Pure on purpose, like `shell.ts` for the terminal: what the editor window
 *  draws is derived here — the rows of a file with their real line numbers, the
 *  rows of an edit as a diff — and the derivations are rules worth unit tests
 *  (`test/file-view.test.ts`), not code buried in JSX.
 */

import { writeAction } from './utils';
import type { FileChangeSource } from './utils';
import type { BashEditHunk } from '../../../types';
import { highlightLines } from './code-lang';

export type FileRowKind = 'ctx' | 'add' | 'del';

export interface FileRow {
  kind: FileRowKind;
  text: string;
  /** Line number in the file, when known: a `Read` prints it, a `Write` starts
   *  at 1. An `Edit` carries none — `old_string` says what changed, not where —
   *  unless its result row does (`hunkRows`). */
  line?: number;
  /** First row of a hunk after the first: the file skips between the row above
   *  and this one, and the diff draws the break — `skipped` lines of it, when
   *  the hunk headers say how many. */
  gap?: boolean;
  skipped?: number;
  /** The span of the row that differs from its counterpart — `[start, end)`
   *  in `text` — when a removed row is paired with the added row that replaced
   *  it (`markPairs`). What the eye should land on in a one-token change. */
  mark?: [number, number];
}

/** Tools the editor window draws. `MultiEdit` is not one of them: it went away
 *  with Claude Code 2.x and its input is a list of edits, not one. */
export const FILE_TOOLS = new Set(['Read', 'Write', 'Edit']);

export function isFileTool(name: string): boolean {
  return FILE_TOOLS.has(name);
}

/** `'a\nb\n'` is two lines, not three: the trailing newline closes the last
 *  line, it does not open an empty one. `''` is no lines at all. */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Past this many cells the LCS table is not worth building: the rows are
 *  shown as "everything removed, everything added", which is still a diff. */
const LCS_CELL_CAP = 400_000;

/**
 * `old` → `new` as diff rows: removed lines, then the lines that replaced them,
 * context between. A line-level LCS — the `old_string`/`new_string` of an
 * `Edit` are a few lines each, so the quadratic table is nothing, and the
 * output is what a reader expects from a diff: unchanged lines kept, a change
 * shown as `-` rows followed by `+` rows.
 */
export function lineDiff(oldText: string, newText: string): FileRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  if (n * m > LCS_CELL_CAP) {
    return [
      ...a.map(text => ({ kind: 'del' as const, text })),
      ...b.map(text => ({ kind: 'add' as const, text })),
    ];
  }

  // lcs[i][j] = length of the LCS of a[i..] and b[j..], flattened.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const rows: FileRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      // Dropping a[i] keeps as much in common as dropping b[j]: emit the
      // removal first, so a replaced block reads `-` then `+`.
      rows.push({ kind: 'del', text: a[i] });
      i++;
    } else {
      rows.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  for (; i < n; i++) rows.push({ kind: 'del', text: a[i] });
  for (; j < m; j++) rows.push({ kind: 'add', text: b[j] });
  return rows;
}

// `cat -n` numbering: an arrow after the number in older transcripts, a tab in
// current ones (every Read on hand from 2.1.241 to 2.1.280 uses the tab).
const NUMBERED_LINE = /^\s*(\d+)(?:→|\t)(.*)$/;

/**
 * The rows of a `Read` result, each with the line number Claude Code printed
 * in front of it (`cat -n` style: `   436→const x`). The numbers are real —
 * a read with `offset` starts where the file does — so the gutter can show
 * them instead of counting from 1.
 *
 * `null` when nothing in the output is numbered: an image, a notebook, a
 * `(no content)` marker, an error — those are printed as they are. A line
 * that is not numbered among ones that are (a truncation notice, say) is kept
 * as a row without a number.
 */
export function numberedRows(output: string): FileRow[] | null {
  const lines = splitLines(output);
  let numbered = 0;
  const rows = lines.map<FileRow>(line => {
    const m = line.match(NUMBERED_LINE);
    if (!m) return { kind: 'ctx', text: line };
    numbered++;
    return { kind: 'ctx', text: m[2], line: Number(m[1]) };
  });
  return numbered > 0 ? rows : null;
}

/** The whole content as rows starting at line 1 — a `Write`. The rows are
 *  plain, not `add`: a write is the file, not a diff of it, which is what the
 *  gutter already says by printing the line number instead of a `+`. Marking
 *  them `add` painted the every-line-is-new wash of a diff over the whole
 *  window — 12% green under the syntax colours of every row, on a surface the
 *  highlight palette is tuned for. */
export function contentRows(content: string, kind: FileRowKind = 'ctx'): FileRow[] {
  return splitLines(content).map((text, i) => ({ kind, text, line: i + 1 }));
}

/** `436–497` for a read that printed those lines, `null` when no row carries a
 *  number. A single line is just its number. */
export function lineRange(rows: FileRow[]): string | null {
  const numbers = rows.flatMap(r => (r.line === undefined ? [] : [r.line]));
  if (numbers.length === 0) return null;
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return first === last ? String(first) : `${first}–${last}`;
}

/** Added and removed line counts of a diff, for the status strip. */
export function diffStat(rows: FileRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === 'add') added++;
    else if (r.kind === 'del') removed++;
  }
  return { added, removed };
}

/** The directory of a path, shortened to its last `keep` segments so a title
 *  bar can show where a file sits without the home prefix eating the width:
 *  `/Users/me/Projects/app/src/components/chat` → `…/src/components/chat`.
 *
 *  Then whole segments are dropped from the head until what is left fits `max`
 *  characters — roughly what the bar can hold beside a file name. The end of a
 *  path is the part that says something, and the CSS ellipsis cuts the other
 *  end: a scratchpad under `~/.claude/projects/{hash}/{sessionId}/` has three
 *  last segments of 90-odd characters, so the bar was dropping `scratchpad` —
 *  the only one that meant anything — and keeping the project hash. The last
 *  segment is always kept, however long it is. `max` is the knob the title bar
 *  actually rides on — `keep` only decides how much `max` gets to choose from. */
export function shortDir(path: string, keep = 3, max = 40): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  const segments = parts.filter(Boolean);
  if (segments.length === 0) return '/';
  let kept = segments.slice(-keep);
  while (kept.length > 1 && kept.join('/').length > max) kept = kept.slice(1);
  const dir = kept.join('/');
  return kept.length === segments.length ? `/${dir}` : `…/${dir}`;
}

/** Markdown by extension. A written `.md` is prose by construction, printed as
 *  if it were source — the same call the app already made for a fetched page,
 *  which renders as the markdown it is rather than as a mono block. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** What a `Write` did, read off its result. The rule — "File created
 *  successfully at: …" is a new file, anything else an overwrite — is
 *  `writeAction`'s, the one Mission Control's MEMORY rows already apply to the
 *  same sentence; one parser for text Claude Code writes, not two. */
export function writeOutcome(resultText: string | undefined): 'created' | 'written' {
  return writeAction(resultText) === 'new' ? 'created' : 'written';
}

/**
 * The rows' HTML, one fragment per row — `null` per row when there is no
 * language to colour them in. The rows are highlighted as the texts they came
 * from, not one at a time: a `"""` docstring keeps its colour across the rows
 * it spans, where highlighting each row alone tokenises its second row as
 * code. An edit's rows interleave two texts, so each side is highlighted whole
 * — the new one (`ctx` + `add`), then the old (`ctx` + `del`) — and a row takes
 * the fragment of its side; a `ctx` row, on both, keeps the new side's.
 */
export function highlightRows(rows: FileRow[], language: string | null): (string | null)[] {
  const html: (string | null)[] = rows.map(() => null);
  if (!language) return html;
  const paint = (own: 'add' | 'del') => {
    const idx = rows.flatMap((r, i) => (r.kind === own || r.kind === 'ctx' ? [i] : []));
    if (idx.length === 0) return;
    const lines = highlightLines(idx.map(i => rows[i].text).join('\n'), language);
    if (!lines || lines.length !== idx.length) return;
    idx.forEach((i, k) => {
      if (rows[i].kind === own || html[i] === null) html[i] = lines[k];
    });
  };
  paint('add');
  if (rows.some(r => r.kind === 'del')) paint('del');
  return html;
}

/**
 * The rows of hunks as Claude Code records them — `structuredPatch` on an
 * `Edit`/`Write` result, `bashEditDiff` on a Bash one — numbered: a context or
 * added row by its line in the file after the change, a removed row by its
 * line before. Same lines a `diff -u` prints, with the `@@` header turned into
 * the numbers it carries.
 */
export function hunkRows(hunks: BashEditHunk[]): FileRow[] {
  const rows: FileRow[] = [];
  hunks.forEach((h, i) => {
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    const prev = hunks[i - 1];
    const skipped = prev ? h.newStart - (prev.newStart + prev.newLines) : 0;
    h.lines.forEach((line, j) => {
      const gap = i > 0 && j === 0 ? { gap: true, ...(skipped > 0 ? { skipped } : {}) } : {};
      const text = line.slice(1);
      if (line.startsWith('+')) rows.push({ kind: 'add', text, line: newNo++, ...gap });
      else if (line.startsWith('-')) rows.push({ kind: 'del', text, line: oldNo++, ...gap });
      else {
        rows.push({ kind: 'ctx', text, line: newNo++, ...gap });
        oldNo++;
      }
    });
  });
  return rows;
}

/** A change as diff rows. The result row's hunks when Claude Code recorded
 *  them — the one source with line numbers — else what the call's input says:
 *  the two strings of an `Edit` diffed, the content of a `Write` as added
 *  lines, each edit of a `MultiEdit` in turn. `null` for a call with nothing
 *  to draw (a read; a Bash change past Claude Code's cap). */
export function changeRows(source: FileChangeSource): FileRow[] | null {
  if (source.kind === 'bash') return source.file ? hunkRows(source.file.hunks) : null;
  const { use, result } = source.group;
  const input = use.input as Record<string, unknown>;
  if (result?.patch?.length) return hunkRows(result.patch);
  switch (use.name) {
    case 'Edit':
      return lineDiff(str(input.old_string), str(input.new_string));
    case 'Write':
      return contentRows(str(input.content), 'add');
    case 'MultiEdit':
      return Array.isArray(input.edits)
        ? (input.edits as Record<string, unknown>[]).flatMap(e =>
            lineDiff(str(e.old_string), str(e.new_string))
          )
        : [];
    case 'NotebookEdit':
      return lineDiff('', str(input.new_source));
    default:
      return null;
  }
}

/** Lines added and removed across every call that touched the file. */
export function changeStat(sources: FileChangeSource[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const s of sources) {
    const rows = changeRows(s);
    if (!rows) continue;
    const stat = diffStat(rows);
    added += stat.added;
    removed += stat.removed;
  }
  return { added, removed };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Marks, on each removed row and the added row that replaced it, the span the
 * two rows do not share — a rename, a changed argument, a flipped flag — so a
 * one-token change is read as one token and not as two whole lines. Pairs are
 * made inside a run of `del` rows followed by the same number of `add` rows;
 * a run of two removed and five added rows is a rewrite and gets no marks. A
 * pair whose rows share nothing (or everything) is left unmarked too: a mark
 * across the whole row says less than the row's own colour.
 */
export function markPairs(rows: FileRow[]): FileRow[] {
  const out = rows.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i].kind !== 'del') {
      i++;
      continue;
    }
    let d = i;
    while (d < out.length && out[d].kind === 'del') d++;
    let a = d;
    while (a < out.length && out[a].kind === 'add') a++;
    const dels = d - i;
    const adds = a - d;
    if (dels === adds) {
      for (let k = 0; k < dels; k++) {
        const marks = spanDiff(out[i + k].text, out[d + k].text);
        if (marks) {
          out[i + k] = { ...out[i + k], mark: marks[0] };
          out[d + k] = { ...out[d + k], mark: marks[1] };
        }
      }
    }
    i = a;
  }
  return out;
}

/** The differing span of two strings, by common prefix and suffix, as
 *  `[start, end)` in each. Null when the strings are equal or share nothing on
 *  either side (then the whole row is the change, and the row's colour already
 *  says so). */
export function spanDiff(a: string, b: string): [[number, number], [number, number]] | null {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  // Leading indentation alone is not "sharing": a row that shares only its
  // spaces with the other is a different row.
  const shared = a.slice(0, start).trim().length + a.slice(endA).trim().length;
  if (shared === 0) return null;
  return [
    [start, endA],
    [start, endB],
  ];
}
