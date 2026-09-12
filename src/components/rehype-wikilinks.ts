// The rehype pass that turns `[[Nota]]` into something clickable.
//
// Two forms occur in real transcripts and both have to be caught: Claude writes
// the link as plain prose ("Dettagli in [[project_api_db]].") and, just as
// often, inside backticks — which is why this cannot be a remark plugin over
// text nodes alone. The inline-code form arrives as an `<code>` element, and
// only the ones whose ENTIRE content is a single link are rewritten: a code
// span that happens to mention a link among other text is code, and stays code.
//
// Fenced blocks are left alone wholesale (`<pre>` is not descended into): a
// transcript quoting markdown source must keep showing the brackets.
//
// Order matters in `rehypePlugins`: this has to run BEFORE `rehypeHighlight`,
// which rewrites the inside of code elements into nested spans — after it, an
// inline `` `[[x]]` `` no longer has the single text child this looks for.

import type { Element, ElementContent, Root, RootContent } from 'hast';
import { parseWikiLink, wikiLinkRegex, type WikiLinkRef } from '../lib/wikilinks';

/** Elements whose subtree is never rewritten. */
const OPAQUE = new Set(['pre', 'code', 'a']);

function chip(ref: WikiLinkRef): Element {
  return {
    type: 'element',
    tagName: 'span',
    // Read back by the `span` component in `Markdown.tsx`. Single-word data
    // names on purpose: they survive the hast → DOM attribute conversion
    // unchanged, with no camelCase boundary to guess at.
    properties: { dataWikilink: ref.target, dataWikilabel: ref.label },
    children: [{ type: 'text', value: ref.label }],
  };
}

/** Splits one text node into text and chips. Returns null when it has no link. */
function splitText(value: string): ElementContent[] | null {
  const re = wikiLinkRegex();
  const out: ElementContent[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const ref = parseWikiLink(m[1]);
    if (!ref.target) continue;
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    out.push(chip(ref));
    last = m.index + m[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

/** An inline `` `[[x]]` `` — and only that — becomes a chip. */
function codeChip(node: Element): Element | null {
  if (node.tagName !== 'code') return null;
  if (node.children.length !== 1) return null;
  const only = node.children[0];
  if (only.type !== 'text') return null;
  const match = wikiLinkRegex().exec(only.value.trim());
  if (!match || match[0] !== only.value.trim()) return null;
  const ref = parseWikiLink(match[1]);
  return ref.target ? chip(ref) : null;
}

function transform(children: (RootContent | ElementContent)[]): (RootContent | ElementContent)[] {
  const out: (RootContent | ElementContent)[] = [];
  let changed = false;

  for (const child of children) {
    if (child.type === 'text') {
      const parts = splitText(child.value);
      if (parts) {
        out.push(...parts);
        changed = true;
      } else out.push(child);
      continue;
    }
    if (child.type === 'element') {
      const inlineChip = codeChip(child);
      if (inlineChip) {
        out.push(inlineChip);
        changed = true;
        continue;
      }
      if (!OPAQUE.has(child.tagName)) {
        const next = transform(child.children);
        if (next !== child.children) {
          child.children = next as ElementContent[];
          changed = true;
        }
      }
    }
    out.push(child);
  }

  return changed ? out : children;
}

export function rehypeWikiLinks() {
  return (tree: Root): void => {
    tree.children = transform(tree.children) as RootContent[];
  };
}
