/** The session scratchpad's model: one line per block, stored as Markdown —
 *  `- [ ] ` / `- [x] ` is a to-do, `- ` a list item, any other line is text.
 *  Pure, so the editor's rules are pinned by tests rather than by hand. */

export type NoteKind = 'text' | 'check' | 'bullet';

export interface NoteBlock {
  id: string;
  type: NoteKind;
  text: string;
  done: boolean;
}

let seq = 0;
export function newBlock(type: NoteKind = 'text', text = '', done = false): NoteBlock {
  seq += 1;
  return { id: `n${seq}`, type, text, done };
}

const CHECK_LINE = /^\s*[-*] \[( |x|X)\] ?(.*)$/;
const BULLET_LINE = /^\s*[-*] (.*)$/;

export function parseNotes(md: string): NoteBlock[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map(line => {
    const m = CHECK_LINE.exec(line);
    if (m) return newBlock('check', m[2], m[1] !== ' ');
    const bullet = BULLET_LINE.exec(line);
    return bullet ? newBlock('bullet', bullet[1]) : newBlock('text', line);
  });
}

/** Blank notes serialize to '' — which the store reads as "remove the file". */
export function serializeNotes(blocks: readonly NoteBlock[]): string {
  if (blocks.every(b => !b.text.trim())) return '';
  const lines = blocks.map(b => {
    const text = b.text.replace(/\n/g, ' ');
    if (b.type === 'check') return `- [${b.done ? 'x' : ' '}] ${text}`;
    return b.type === 'bullet' ? `- ${text}` : text;
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

/** What a typed line start turns into: `[] `, `[ ] `, `[x] ` (with or without
 *  a leading `- `) make a to-do, `- ` or `* ` a list item. Null otherwise. */
export function lineShortcut(
  text: string
): { type: 'check' | 'bullet'; done: boolean; rest: string } | null {
  const check = /^(?:[-*] )?\[( |x|X)?\] /.exec(text);
  if (check) {
    const done = check[1] === 'x' || check[1] === 'X';
    return { type: 'check', done, rest: text.slice(check[0].length) };
  }
  const bullet = /^[-*] /.exec(text);
  return bullet ? { type: 'bullet', done: false, rest: text.slice(bullet[0].length) } : null;
}

export interface NotesTally {
  /** To-dos with text in them; an empty to-do line is not a task yet. */
  total: number;
  done: number;
  hasText: boolean;
}

export function notesTally(md: string | null | undefined): NotesTally {
  const tally = { total: 0, done: 0, hasText: false };
  if (!md) return tally;
  for (const b of parseNotes(md)) {
    if (!b.text.trim()) continue;
    if (b.type === 'check') {
      tally.total += 1;
      if (b.done) tally.done += 1;
    } else tally.hasText = true;
  }
  return tally;
}

/** The rail trigger's badge: progress while to-dos are open, a check once all
 *  are done, a plain dot for text alone, nothing for an empty sheet. */
export type NotesBadge =
  | { kind: 'progress'; label: string; title: string }
  | { kind: 'done'; title: string }
  | { kind: 'text'; title: string }
  | null;

export function notesBadge(t: NotesTally): NotesBadge {
  if (t.total > 0) {
    return t.done === t.total
      ? { kind: 'done', title: `All ${t.total} to-dos done` }
      : {
          kind: 'progress',
          label: `${t.done}/${t.total}`,
          title: `${t.done} of ${t.total} to-dos done`,
        };
  }
  return t.hasText ? { kind: 'text', title: 'This session has notes' } : null;
}

/* ── editing ─────────────────────────────────────────────────────────── */

export interface Edit {
  blocks: NoteBlock[];
  focus: { id: string; pos: number };
}

/** Enter: an empty to-do or list item drops back to text (how a list is
 *  left); otherwise the line splits at the caret into a new line of the same
 *  kind. */
export function enterAt(blocks: readonly NoteBlock[], i: number, caret: number): Edit {
  const b = blocks[i];
  const next = blocks.slice();
  if (b.type !== 'text' && b.text === '') {
    next[i] = { ...b, type: 'text', done: false };
    return { blocks: next, focus: { id: b.id, pos: 0 } };
  }
  const added = newBlock(b.type, b.text.slice(caret));
  next[i] = { ...b, text: b.text.slice(0, caret) };
  next.splice(i + 1, 0, added);
  return { blocks: next, focus: { id: added.id, pos: 0 } };
}

/** Backspace at a line's start: a to-do or list item turns back into text; a
 *  text line joins the one above. Null when there is nothing above to join. */
export function backspaceAtStart(blocks: readonly NoteBlock[], i: number): Edit | null {
  const b = blocks[i];
  const next = blocks.slice();
  if (b.type !== 'text') {
    next[i] = { ...b, type: 'text', done: false };
    return { blocks: next, focus: { id: b.id, pos: 0 } };
  }
  if (i === 0) return null;
  const prev = blocks[i - 1];
  next[i - 1] = { ...prev, text: prev.text + b.text };
  next.splice(i, 1);
  return { blocks: next, focus: { id: prev.id, pos: prev.text.length } };
}

/** A multi-line paste becomes lines of its own, each parsed for `- [ ]` and
 *  `- `; the first joins the line under the caret, which keeps its kind —
 *  unless that line is empty, and then it takes the pasted line's. */
export function pasteAt(
  blocks: readonly NoteBlock[],
  i: number,
  start: number,
  end: number,
  pasted: string | NoteBlock[]
): Edit {
  const b = blocks[i];
  const parts = typeof pasted === 'string' ? parseNotes(pasted) : pasted;
  const before = b.text.slice(0, start);
  const after = b.text.slice(end);
  const first =
    before === '' && after === ''
      ? { ...parts[0], id: b.id }
      : { ...b, text: before + parts[0].text };
  const lines = [first, ...parts.slice(1)];
  const last = lines[lines.length - 1];
  const pos = last.text.length;
  lines[lines.length - 1] = { ...last, text: last.text + after };
  const next = blocks.slice();
  next.splice(i, 1, ...lines);
  return { blocks: next, focus: { id: last.id, pos } };
}
