import { describe, expect, it } from 'vitest';
import { PALETTES } from '../src/components/project/terminal/terminal-theme';

const ANSI = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

// WCAG 2 relative luminance of a `#rrggbb` color.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('terminal ANSI palettes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const term = PALETTES[mode].term;
    // Dark `black` is a fill color, not ink — see the note in terminal-theme.ts.
    const inks = ANSI.filter(name => !(mode === 'dark' && name === 'black'));

    it(`sets all 16 colors in ${mode}`, () => {
      for (const name of ANSI) expect(term[name]).toMatch(/^#[0-9a-f]{6}$/);
    });

    it.each(inks)(`${mode} %s reads at 4.5:1 on the ground`, name => {
      expect(contrast(term[name], term.background)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
