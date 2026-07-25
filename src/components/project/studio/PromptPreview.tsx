// Faithful rendered view of an agent prompt. A prompt is a JavaScript template
// literal, so it cannot be handed to a markdown parser as-is: the `${…}` bodies
// carry dollars, braces and nested backticks that markdown re-reads as math
// delimiters and code spans, producing a prompt the agent will never receive
// (a ternary's two branches got glued into one sentence, `$` sigils vanished
// into a KaTeX parse error). So every interpolation is masked to an opaque
// sentinel BEFORE parsing and restored afterwards as a chip: markdown only ever
// sees the literal prose, and the expression is displayed verbatim, marked as
// computed at runtime — the same treatment dynamic labels already get.

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { maskInterpolations, maskSegments } from './studioLang';

const CHIP_CLASS = 'cl-studio-interp';

/**
 * Put the masked interpolations back into the parsed tree. Runs BEFORE
 * rehype-highlight so a sentinel that landed inside a fenced block is plain
 * text again by the time the highlighter tokenizes it (it would otherwise be
 * free to split the sentinel apart and leak the raw marker on screen).
 */
function rehypeInterpolations(exprs: string[]) {
  const restore = (index: number) => `\${${exprs[index] ?? ''}}`;

  const transform = (children: RootContent[], inCode: boolean): RootContent[] => {
    const out: RootContent[] = [];
    for (const child of children) {
      if (child.type === 'element') {
        const nested = inCode || child.tagName === 'code' || child.tagName === 'pre';
        child.children = transform(child.children, nested) as ElementContent[];
        out.push(child);
        continue;
      }
      if (child.type !== 'text') {
        out.push(child);
        continue;
      }
      const segments = maskSegments(child.value);
      if (segments.length === 1 && segments[0].kind === 'text') {
        out.push(child);
        continue;
      }
      for (const segment of segments) {
        if (segment.kind === 'text') {
          if (segment.text) out.push({ type: 'text', value: segment.text });
          continue;
        }
        const value = restore(segment.index);
        // Inside code, the expression is already displayed verbatim — a chip
        // there would nest a <code> inside a code block.
        if (inCode) {
          out.push({ type: 'text', value });
          continue;
        }
        const chip: Element = {
          type: 'element',
          tagName: 'code',
          properties: { className: [CHIP_CLASS], title: 'Interpolated when the workflow runs' },
          children: [{ type: 'text', value }],
        };
        out.push(chip);
      }
    }
    return out;
  };

  // An attacher (unified calls the plugin to get the transformer), not the
  // transformer itself.
  return () => (tree: Root) => {
    tree.children = transform(tree.children, false);
  };
}

const components: Components = {
  // `node` is react-markdown's hast handle, not a DOM attribute — dropping it
  // keeps it from being stringified onto the element.
  code({ className, children, node: _node, ...props }) {
    if (!String(className ?? '').includes(CHIP_CLASS)) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        {...props}
        className={`${CHIP_CLASS} font-mono text-[11.5px] px-1 py-[1px] mx-[1px] rounded-[3px] border break-words`}
        style={{
          borderColor: 'var(--cl-line)',
          background: 'color-mix(in oklch, var(--cl-accent-soft) 45%, transparent)',
          color: 'var(--cl-accent-ink)',
        }}
      >
        {children}
      </code>
    );
  },
};

// remark-math / rehype-katex are deliberately absent (a prompt is not a math
// document: a bare `$` must stay a `$`), as is remark-frontmatter (a prompt
// opening with `---` is a rule, not metadata).
const REMARK = [remarkGfm];

function PromptPreview({ prompt, className = '' }: { prompt: string; className?: string }) {
  const { text, exprs } = maskInterpolations(prompt);
  return (
    <div className={`prose prose-sm prose-lens max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={[rehypeInterpolations(exprs), rehypeHighlight]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(PromptPreview);
