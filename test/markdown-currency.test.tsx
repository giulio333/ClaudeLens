// @vitest-environment jsdom
//
// Dollar signs in prose. The claims: amounts that carry `$` stay text instead of
// being read as TeX, and real inline and display math still renders.

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

it('keeps amounts with a leading dollar as text', () => {
  const root = md('Jefferies (da $295 a $265) e Bernstein (da $298 a $278) tagliano.');
  expect(root.querySelector('.katex')).toBeNull();
  expect(root.textContent).toBe(
    'Jefferies (da $295 a $265) e Bernstein (da $298 a $278) tagliano.'
  );
});

it('keeps a trailing dollar sign as text', () => {
  const root = md('Il consenso è -0,23 $ per azione, debito 45,9 miliardi $.');
  expect(root.querySelector('.katex')).toBeNull();
  expect(root.textContent).toContain('-0,23 $ per azione');
});

it('still renders inline and display math', () => {
  const inline = md('la formula $E = mc^2$ qui');
  expect(inline.querySelector('.katex')).not.toBeNull();
  cleanup();
  const display = md('ecco:\n\n$$x^2 + y^2$$');
  expect(display.querySelector('.katex')).not.toBeNull();
});
