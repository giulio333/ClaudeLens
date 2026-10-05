// Obsidian's callouts: a blockquote whose first line is `[!type]`, optionally
// folded (`[!type]-` closed, `[!type]+` open) and optionally titled.
//
//   > [!tip] How to use this folder
//   > `Guide/` holds the concepts, read once.
//
// Without this pass the marker printed as text inside a quote — `[!tip] How to
// use…` — in exactly the notes a vault is made of. The rest of the first line
// is the title; everything after it is the body. A blockquote that does not
// open with a marker is left a blockquote.

import type { Element, ElementContent, Root, RootContent } from 'hast';

const MARKER = /^\s*\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*/;

/** Obsidian's types and aliases, folded into the few tones the page can
 *  draw with the brand's existing tokens — no new hue per type. */
const TONE: Record<string, string> = {
  note: 'info',
  info: 'info',
  abstract: 'info',
  summary: 'info',
  tldr: 'info',
  todo: 'info',
  tip: 'ok',
  hint: 'ok',
  important: 'ok',
  success: 'ok',
  check: 'ok',
  done: 'ok',
  question: 'warn',
  help: 'warn',
  faq: 'warn',
  warning: 'warn',
  caution: 'warn',
  attention: 'warn',
  failure: 'danger',
  fail: 'danger',
  missing: 'danger',
  danger: 'danger',
  error: 'danger',
  bug: 'danger',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

const isElement = (n: RootContent | ElementContent): n is Element => n.type === 'element';

/** The blockquote's first paragraph, if it opens with a marker. */
function markedParagraph(quote: Element): { p: Element; match: RegExpExecArray } | null {
  const p = quote.children.find(isElement);
  if (!p || p.tagName !== 'p') return null;
  const first = p.children[0];
  if (!first || first.type !== 'text') return null;
  const match = MARKER.exec(first.value);
  return match ? { p, match } : null;
}

/**
 * The first paragraph cut at its first line break: what comes before it is
 * the title (inline code and links in it kept), what comes after is the first
 * paragraph of the body. With no line break the whole paragraph is the title.
 */
function splitTitle(nodes: ElementContent[]): { title: ElementContent[]; rest: ElementContent[] } {
  const title: ElementContent[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'element' && n.tagName === 'br') {
      return { title, rest: nodes.slice(i + 1) };
    }
    if (n.type === 'text' && n.value.includes('\n')) {
      const at = n.value.indexOf('\n');
      const before = n.value.slice(0, at);
      const after = n.value.slice(at + 1);
      if (before) title.push({ type: 'text', value: before });
      const rest = nodes.slice(i + 1);
      return { title, rest: after.trim() ? [{ type: 'text', value: after }, ...rest] : rest };
    }
    title.push(n);
  }
  return { title, rest: [] };
}

function callout(quote: Element): Element | null {
  const marked = markedParagraph(quote);
  if (!marked) return null;
  const { p, match } = marked;
  const type = match[1].toLowerCase();
  const fold = match[2];
  const [first, ...more] = p.children as ElementContent[];
  const head = (first as { value: string }).value.slice(match[0].length);
  const { title, rest } = splitTitle([
    ...(head ? [{ type: 'text', value: head } as ElementContent] : []),
    ...more,
  ]);
  const hasTitle = title.some(n => n.type !== 'text' || n.value.trim());

  const label: Element = {
    type: 'element',
    tagName: 'span',
    properties: { className: ['cl-callout-type'] },
    children: [{ type: 'text', value: type }],
  };
  const titleEl: Element = {
    type: 'element',
    tagName: fold ? 'summary' : 'div',
    properties: { className: hasTitle ? ['cl-callout-title', 'has-title'] : ['cl-callout-title'] },
    children: [
      label,
      ...(hasTitle ? [{ type: 'text', value: ' ' } as ElementContent] : []),
      ...(hasTitle ? title : []),
    ],
  };
  const afterFirst = quote.children.slice(quote.children.indexOf(p) + 1);
  const body: ElementContent[] = [
    ...(rest.length ? [{ ...p, children: rest } as Element] : []),
    ...(afterFirst as ElementContent[]),
  ];
  const hasBody = body.some(n => n.type !== 'text' || n.value.trim());

  return {
    type: 'element',
    tagName: fold ? 'details' : 'div',
    properties: {
      className: ['cl-callout'],
      dataCallout: type,
      dataTone: TONE[type] ?? 'neutral',
      ...(fold === '+' ? { open: true } : {}),
    },
    children: [
      titleEl,
      ...(hasBody
        ? [
            {
              type: 'element',
              tagName: 'div',
              properties: { className: ['cl-callout-body'] },
              children: body,
            } as Element,
          ]
        : []),
    ],
  };
}

function walk(parent: Root | Element): void {
  parent.children.forEach((child, i) => {
    if (child.type !== 'element') return;
    if (child.tagName === 'blockquote') {
      const replaced = callout(child);
      if (replaced) {
        parent.children[i] = replaced;
        // A callout may hold another one.
        for (const c of replaced.children) if (c.type === 'element') walk(c);
        return;
      }
    }
    if (child.tagName !== 'pre' && child.tagName !== 'code') walk(child);
  });
}

export function rehypeCallouts() {
  return (tree: Root) => walk(tree);
}
