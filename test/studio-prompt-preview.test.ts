import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PromptPreview from '../src/components/project/studio/PromptPreview';
import { maskInterpolations, maskSegments } from '../src/components/project/studio/studioLang';

const render = (prompt: string) =>
  renderToStaticMarkup(createElement(PromptPreview, { prompt }));

/** The fix-issue step prompt: a ternary whose branches are nested templates. */
const TERNARY_PROMPT = [
  'Nel repository corrente usa `gh issue list --state open --limit 30`.',
  "${forcedIssue ? `Lavora sull'issue #${forcedIssue}.` : `Scegli UNA issue da risolvere.`}",
  'Sola lettura: non modificare nulla.',
].join('\n');

describe('maskInterpolations', () => {
  it('replaces every live interpolation with an opaque sentinel', () => {
    const { text, exprs } = maskInterpolations('Fix ${a.b} using ${c}');
    expect(exprs).toEqual(['a.b', 'c']);
    expect(text).not.toContain('$');
    expect(text).not.toContain('{');
    expect(maskSegments(text)).toEqual([
      { kind: 'text', text: 'Fix ' },
      { kind: 'expr', index: 0 },
      { kind: 'text', text: ' using ' },
      { kind: 'expr', index: 1 },
    ]);
  });

  it('masks a whole ternary — including its nested backticks and dollars', () => {
    const { text, exprs } = maskInterpolations(TERNARY_PROMPT);
    expect(exprs).toHaveLength(1);
    expect(exprs[0]).toContain('forcedIssue ?');
    // The branch templates never reach the markdown parser: only the two
    // literal backticks of the `gh …` code span survive.
    expect([...text].filter(c => c === '`')).toHaveLength(2);
    expect(text).not.toContain('$');
  });

  it('leaves an escaped \\${ as literal text (never a live interpolation)', () => {
    const { text, exprs } = maskInterpolations('costs \\${x} per run');
    expect(exprs).toEqual([]);
    expect(text).toBe('costs \\${x} per run');
  });

  it('cannot be spoofed by sentinel characters typed into the prompt', () => {
    const { text, exprs } = maskInterpolations('a \uE0000\uE001 b ${real}');
    expect(exprs).toEqual(['real']);
    expect(maskSegments(text).filter(s => s.kind === 'expr')).toHaveLength(1);
  });
});

describe('PromptPreview', () => {
  it('renders a ternary interpolation verbatim, in one chip', () => {
    const html = render(TERNARY_PROMPT);
    // No math: the `$` sigils survive and KaTeX never runs.
    expect(html).not.toContain('katex');
    expect(html).toContain('${forcedIssue ? `Lavora sull&#x27;issue #${forcedIssue}.`');
    // The branch separator is NOT promoted to an inline code span (the bug:
    // markdown re-paired the nested backticks and made a `<code>:</code>`).
    expect(html).not.toContain('<code>:</code>');
    // Exactly one chip for the interpolation, plus the prompt's own code span.
    expect(html.match(/class="cl-studio-interp/g)).toHaveLength(1);
    expect(html).toContain('<code>gh issue list --state open --limit 30</code>');
    // Every branch of the ternary is still readable in full.
    expect(html).toContain('Scegli UNA issue da risolvere.');
    expect(html).toContain('Sola lettura: non modificare nulla.');
  });

  it('keeps a bare dollar a dollar', () => {
    const html = render('Budget: $5 per agent, $12 total.');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5 per agent, $12 total.');
  });

  it('still renders the markdown around the interpolations', () => {
    const html = render('## Task\n\n- read ${collect}\n- write a summary');
    expect(html).toContain('<h2>Task</h2>');
    expect(html).toContain('<li>');
    expect(html).toContain('${collect}');
    expect(html).toContain('cl-studio-interp');
  });

  it('shows an interpolation inside a fenced block as plain code, not a chip', () => {
    const html = render('```js\nconst x = ${collect}\n```');
    expect(html).toContain('${collect}');
    expect(html).not.toContain('cl-studio-interp');
    expect(html).toContain('<pre>');
  });
});
