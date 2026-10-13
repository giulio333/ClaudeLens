/** A paste from the Lens (or any rendered page) as note lines. The plain-text
 *  copy of a rendered list has lost its markers, so the HTML flavour is read
 *  instead: a list item becomes a list line — a to-do when it carries a
 *  checkbox — and every other block a text line. */

import { newBlock, type NoteBlock } from './session-notes';

const BLOCKS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'BLOCKQUOTE',
  'TABLE',
  'TR',
  'SECTION',
  'ARTICLE',
]);

/** Null when the HTML holds no structure worth keeping — the caller then
 *  falls back to the plain text. */
export function htmlToNoteBlocks(html: string): NoteBlock[] | null {
  if (!html.trim() || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: NoteBlock[] = [];
  walk(doc.body, out);
  const lines = out.filter(b => b.text.trim() !== '');
  return lines.some(b => b.type !== 'text') ? lines : null;
}

function walk(node: Element, out: NoteBlock[]): void {
  let inline = '';
  const flushInline = () => {
    for (const line of inline.split('\n')) out.push(newBlock('text', tidy(line)));
    inline = '';
  };
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      inline += child.textContent ?? '';
    } else if (child instanceof Element) {
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        flushInline();
        listItems(child, out);
      } else if (BLOCKS.has(child.tagName)) {
        flushInline();
        walk(child, out);
      } else if (child.tagName === 'BR') {
        inline += '\n';
      } else if (child.tagName !== 'STYLE' && child.tagName !== 'SCRIPT') {
        inline += child.textContent ?? '';
      }
    }
  }
  flushInline();
}

/** Each item's own text, without its nested lists, which follow as items of
 *  their own: a note has no indentation. */
function listItems(list: Element, out: NoteBlock[]): void {
  for (const li of Array.from(list.children)) {
    if (li.tagName !== 'LI') continue;
    const box = li.querySelector(
      ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'
    );
    const nested: Element[] = [];
    let text = '';
    for (const child of Array.from(li.childNodes)) {
      if (child instanceof Element && (child.tagName === 'UL' || child.tagName === 'OL')) {
        nested.push(child);
      } else text += child.textContent ?? '';
    }
    out.push(
      box instanceof HTMLInputElement
        ? newBlock('check', tidy(text), box.checked)
        : newBlock('bullet', tidy(text))
    );
    for (const sub of nested) listItems(sub, out);
  }
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
