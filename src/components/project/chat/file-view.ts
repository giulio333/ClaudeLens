/** Presentation model for the file tools (Read / Write / Edit).
 *
 *  Pure on purpose, like `shell.ts` for the terminal: what the editor window
 *  draws is derived here — the rows of a file with their real line numbers, the
 *  rows of an edit as a diff — and the derivations are rules worth unit tests
 *  (`test/file-view.test.ts`), not code buried in JSX.
 */

import { writeAction } from './utils';
import { highlightLines } from './code-lang';

export type FileRowKind = 'ctx' | 'add' | 'del';

export interface FileRow {
  kind: FileRowKind;
  text: string;
  /** Line number in the file, when known: a `Read` prints it, a `Write` starts
   *  at 1. An `Edit` carries none — `old_string` says what changed, not where. */
  line?: number;
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

const NUMBERED_LINE = /^\s*(\d+)→(.*)$/;

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

/** The whole content as rows starting at line 1 — a `Write`, where every line
 *  is new. */
export function contentRows(content: string, kind: FileRowKind = 'add'): FileRow[] {
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
 *  `/Users/me/Projects/app/src/components/chat` → `…/src/components/chat`. */
export function shortDir(path: string, keep = 3): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  const segments = parts.filter(Boolean);
  if (segments.length === 0) return '/';
  if (segments.length <= keep) return `/${segments.join('/')}`;
  return `…/${segments.slice(-keep).join('/')}`;
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
