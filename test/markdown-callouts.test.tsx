// @vitest-environment jsdom
//
// Obsidian callouts in rendered markdown. The claims: a blockquote that opens
// with `[!type]` is a callout, never a quote with the marker printed in it; the
// rest of the first line is its title — inline code kept — and the lines after
// it are the body; the type picks one of the app's existing tones, unknown
// ones included; `-` folds it closed and `+` open; and a plain blockquote, or a
// marker quoted inside a code fence, stays what it was.

import { StrictMode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import Markdown from '../src/components/Markdown';

afterEach(cleanup);

function md(source: string) {
  return render(
    <StrictMode>
      <Markdown>{source}</Markdown>
    </StrictMode>
  ).container;
}

it('turns a marked blockquote into a callout with its title and body', () => {
  const root = md('> [!tip] How to use `Guide/`\n> The concepts, read once.\n');
  const callout = root.querySelector('.cl-callout')!;
  expect(root.querySelector('blockquote')).toBeNull();
  expect(callout.getAttribute('data-callout')).toBe('tip');
  expect(callout.getAttribute('data-tone')).toBe('ok');
  const title = callout.querySelector('.cl-callout-title')!;
  expect(title.querySelector('.cl-callout-type')?.textContent).toBe('tip');
  // With a title, the glyph says the type and the label stays out of sight.
  expect(title.classList.contains('has-title')).toBe(true);
  expect(title.textContent).toBe('tip How to use Guide/');
  expect(title.querySelector('code')?.textContent).toBe('Guide/');
  expect(callout.querySelector('.cl-callout-body')?.textContent?.trim()).toBe(
    'The concepts, read once.'
  );
  expect(root.textContent).not.toContain('[!tip]');
});

it('keeps a callout with no title to its type, and later paragraphs in the body', () => {
  const root = md('> [!WARNING]\n> First.\n>\n> Second.\n');
  const callout = root.querySelector('.cl-callout')!;
  expect(callout.getAttribute('data-callout')).toBe('warning');
  expect(callout.getAttribute('data-tone')).toBe('warn');
  const title = callout.querySelector('.cl-callout-title')!;
  expect(title.textContent).toBe('warning');
  expect(title.classList.contains('has-title')).toBe(false);
  const body = [...callout.querySelectorAll('.cl-callout-body p')].map(p => p.textContent);
  expect(body).toEqual(['First.', 'Second.']);
});

it('draws an unknown type in the neutral tone rather than dropping it', () => {
  const callout = md('> [!recipe] Pasta\n').querySelector('.cl-callout')!;
  expect(callout.getAttribute('data-tone')).toBe('neutral');
  expect(callout.querySelector('.cl-callout-body')).toBeNull();
});

it('folds a callout closed with `-` and open with `+`', () => {
  const closed = md('> [!faq]- Why?\n> Because.\n').querySelector('details.cl-callout')!;
  expect(closed.hasAttribute('open')).toBe(false);
  expect(closed.querySelector('summary')?.textContent).toBe('faq Why?');
  const open = md('> [!faq]+ Why?\n> Because.\n').querySelector('details.cl-callout')!;
  expect(open.hasAttribute('open')).toBe(true);
});

it('leaves a plain quote a quote and a marker inside a fence as text', () => {
  const root = md('> Just a quote.\n\n```\n> [!tip] not a callout\n```\n');
  expect(root.querySelector('blockquote')?.textContent?.trim()).toBe('Just a quote.');
  expect(root.querySelector('.cl-callout')).toBeNull();
  expect(root.querySelector('pre')?.textContent).toContain('[!tip] not a callout');
});
