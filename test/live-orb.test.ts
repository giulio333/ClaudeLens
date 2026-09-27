import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORB_INK, inFlightTool, liveOrbState } from '../src/components/live-orb';

describe('liveOrbState', () => {
  it('breathes while no tool runs', () => {
    expect(liveOrbState(null)).toBe('breathing');
    expect(liveOrbState(undefined)).toBe('breathing');
    expect(liveOrbState('')).toBe('breathing');
  });

  it('gives each tool family its own verb', () => {
    expect(liveOrbState('Grep')).toBe('searching');
    expect(liveOrbState('WebFetch')).toBe('searching');
    expect(liveOrbState('Edit')).toBe('composing');
    expect(liveOrbState('NotebookEdit')).toBe('composing');
    expect(liveOrbState('Agent')).toBe('listening');
    expect(liveOrbState('Task')).toBe('listening');
    expect(liveOrbState('SendMessage')).toBe('listening');
    expect(liveOrbState('AskUserQuestion')).toBe('listening');
  });

  it('claims only that something runs for a tool it does not know', () => {
    expect(liveOrbState('Bash')).toBe('working');
    expect(liveOrbState('mcp__acme__lookup')).toBe('working');
    expect(liveOrbState('SomeFutureTool')).toBe('working');
  });
});

describe('inFlightTool', () => {
  const delegate = { id: 'toolu_1', name: 'reviewer', at: 1 };

  it('is the session’s own call when one is in flight, even while an agent runs', () => {
    expect(inFlightTool({ lastTool: { name: 'Grep', arg: 'x' }, delegates: [delegate] })).toBe(
      'Grep'
    );
  });

  it('is the agent a session waits on when it has no call of its own', () => {
    expect(inFlightTool({ lastTool: null, delegates: [delegate] })).toBe('Agent');
  });

  it('is nothing between calls, and for a session not read yet', () => {
    expect(inFlightTool({ lastTool: null, delegates: [] })).toBeNull();
    expect(inFlightTool(undefined)).toBeNull();
  });
});

// The orb drops an `oklch()` colour without a word, so ORB_INK repeats each
// token in hex — a copy that goes stale the day a token moves. Pinned here
// against the tokens themselves, converted the way the browser does.
describe('ORB_INK', () => {
  const css = readFileSync(join(__dirname, '../src/index.css'), 'utf8');

  function block(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf('\n}', start));
  }

  function tokenHex(body: string, token: string): string {
    const m = body.match(new RegExp(`--cl-${token}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
    if (!m) throw new Error(`--cl-${token} not found`);
    const [L, C, h] = m.slice(1).map(Number);
    const a = C * Math.cos((h * Math.PI) / 180);
    const b = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
    ];
    const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
    return (
      '#' +
      linear
        .map(x => Math.round(255 * Math.min(1, Math.max(0, gamma(Math.max(0, x))))))
        .map(n => n.toString(16).padStart(2, '0').toUpperCase())
        .join('')
    );
  }

  const light = block(':root');
  const dark = block(":root[data-theme='dark']");

  it.each(['accent', 'violet', 'ok'] as const)('matches --cl-%s in both themes', tone => {
    expect(ORB_INK[tone].light).toBe(tokenHex(light, tone));
    expect(ORB_INK[tone].dark).toBe(tokenHex(dark, tone));
  });
});
