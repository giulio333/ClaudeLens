import { describe, it, expect } from 'vitest';
import { fmtDate, fmtModel, modelColor, buildModelMix } from '../src/components/project/utils';
import { formatDate } from '../src/components/project/memory/utils';
import { sharedPathPrefix } from '../src/components/project/shared/projectName';
import { fmtClockTime, createTimeScale } from '../src/components/project/chat/graph/useForceLayout';

// Robustness fixes from the #99 audit: pure date/scale formatters must not
// leak "Invalid Date" into the UI, and the timeline scale must not divide by
// zero. Assertions avoid locale/timezone-specific exact strings — they check
// the guard behaviour (empty vs. non-"Invalid" output) and numeric validity.

describe('fmtDate — invalid-date guard (#99)', () => {
  it('formats a valid ISO timestamp', () => {
    const out = fmtDate('2026-01-15T10:30:00Z');
    expect(out).not.toBe('');
    expect(out).not.toMatch(/Invalid/i);
  });

  it('returns an empty string for an unparseable value instead of "Invalid Date"', () => {
    expect(fmtDate('not a date')).toBe('');
    expect(fmtDate('')).toBe('');
  });
});

describe('formatDate — invalid-date guard (#99)', () => {
  it('formats a valid ISO timestamp', () => {
    expect(formatDate('2026-01-15T10:30:00Z')).not.toMatch(/Invalid/i);
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatDate('nope')).toBe('');
  });
});

describe('fmtClockTime — invalid-date guard (#99)', () => {
  it('formats a valid epoch timestamp', () => {
    expect(fmtClockTime(Date.UTC(2026, 0, 15, 10, 30, 0))).not.toMatch(/Invalid/i);
  });

  it('returns an empty string for NaN instead of "Invalid Date"', () => {
    expect(fmtClockTime(NaN)).toBe('');
  });
});

describe('createTimeScale — zero-width range guard (#99)', () => {
  it('does not return NaN from invert when the pixel range is zero-width', () => {
    const { invert } = createTimeScale({ start: 0, end: 1000 }, { from: 40, to: 40 });
    expect(Number.isNaN(invert(40))).toBe(false);
  });

  it('round-trips scale/invert for a normal range', () => {
    const { scale, invert } = createTimeScale({ start: 0, end: 1000 }, { from: 0, to: 100 });
    expect(scale(500)).toBeCloseTo(50);
    expect(invert(50)).toBeCloseTo(500);
  });
});

// `fmtModel` used to pull the version out with /(\d+[.-]\d+)/, which needs two
// digit groups: every single-digit release lost its number, so `claude-opus-5`
// printed as a bare "Opus" and Fable fell through to its raw id.
describe('fmtModel — model id to display name', () => {
  const cases: Array<[string, string]> = [
    ['claude-opus-5', 'Opus 5'],
    ['claude-sonnet-5', 'Sonnet 5'],
    ['claude-fable-5', 'Fable 5'],
    ['claude-mythos-5', 'Mythos 5'],
    ['claude-opus-4-8', 'Opus 4.8'],
    ['claude-sonnet-4-6', 'Sonnet 4.6'],
    ['claude-haiku-4-5', 'Haiku 4.5'],
    // an 8-digit release stamp is not part of the version
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['claude-3-5-haiku', 'Haiku 3.5'],
  ];

  it.each(cases)('renders %s as %s', (id, expected) => {
    expect(fmtModel(id)).toBe(expected);
  });

  it('passes an unrecognised id through unchanged', () => {
    expect(fmtModel('<synthetic>')).toBe('<synthetic>');
  });
});

describe('modelColor — one colour per family', () => {
  it('gives each family a distinct colour, Fable included', () => {
    const colors = ['claude-haiku-4-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5'].map(
      modelColor
    );
    expect(new Set(colors).size).toBe(4);
  });

  it('falls back to the Sonnet colour for an unknown family', () => {
    expect(modelColor('gpt-mystery')).toBe(modelColor('claude-sonnet-5'));
  });
});

// ── Model distribution (project hero band, design 5b) ─────────────────────────
// The tri-colour bar is a part-of-whole over TOKENS, so the invariants that
// matter are: percentages sum to 100, empty families never reach the bar, and a
// window with no usage degrades to an empty state instead of a NaN-wide bar.
describe('buildModelMix — project hero band', () => {
  const s = (model: string | undefined, totalTokens: number) => ({ model, totalTokens });

  it('splits by tokens, not by session count', () => {
    const mix = buildModelMix([
      s('claude-opus-5', 750),
      s('claude-sonnet-4-6', 125),
      s('claude-sonnet-4-6', 125),
    ]);
    expect(mix.map(m => m.key)).toEqual(['opus', 'sonnet']);
    expect(mix.find(m => m.key === 'opus')?.pct).toBe(75);
    // sonnet carries two sessions but only a quarter of the work
    expect(mix.find(m => m.key === 'sonnet')).toMatchObject({ pct: 25, sessions: 2 });
  });

  it('keeps the families in a stable order and sums to 100%', () => {
    const mix = buildModelMix([
      s('claude-haiku-4-5-20251001', 100),
      s('claude-sonnet-4-6', 100),
      s('claude-opus-5', 100),
      s(undefined, 100),
    ]);
    expect(mix.map(m => m.key)).toEqual(['opus', 'sonnet', 'haiku', 'other']);
    expect(mix.reduce((n, m) => n + m.pct, 0)).toBeCloseTo(100, 10);
  });

  it('drops families with no tokens so the bar never carries a zero-width segment', () => {
    const mix = buildModelMix([s('claude-opus-5', 500), s('claude-sonnet-4-6', 0)]);
    expect(mix.map(m => m.key)).toEqual(['opus']);
    expect(mix[0].pct).toBe(100);
  });

  it('returns nothing when the window recorded no tokens at all', () => {
    expect(buildModelMix([])).toEqual([]);
    expect(buildModelMix([s('claude-opus-5', 0), s(undefined, 0)])).toEqual([]);
  });

  it('files an unrecognised model id under "other" rather than guessing a family', () => {
    const mix = buildModelMix([s('some-future-model', 10)]);
    expect(mix).toEqual([{ key: 'other', label: 'Other', tokens: 10, sessions: 1, pct: 100 }]);
  });
});

// The duplicates view mutes the part of the candidate paths that does not tell
// them apart, so the eye lands on the segment that does. The caller slices the
// returned prefix off each path, so it must be a literal prefix of every one.
describe('sharedPathPrefix — the part of a duplicate group that carries no signal', () => {
  it('mutes the shared head and keeps the segment that differs', () => {
    const prefix = sharedPathPrefix([
      '/Users/x/Projects/SARA2.0/sara-broker-cms/openshift',
      '/Users/x/Projects/SARA2.0/sara-bridge-simulator/openshift',
    ]);
    expect(prefix).toBe('/Users/x/Projects/SARA2.0/');
  });

  it('is a literal prefix of every path it was given', () => {
    const paths = ['/a/b/c/proj', '/a/b/d/proj', '/a/b/e/proj'];
    const prefix = sharedPathPrefix(paths);
    expect(prefix).toBe('/a/b/');
    for (const p of paths) expect(p.startsWith(prefix)).toBe(true);
  });

  it('never consumes the last segment, so a path always keeps something to show', () => {
    // identical parents: the only difference is the basename itself
    expect(sharedPathPrefix(['/a/b/one', '/a/b/two'])).toBe('/a/b/');
    // one path is the parent of the other — 'b' stays on both sides
    expect(sharedPathPrefix(['/a/b', '/a/b/c'])).toBe('/a/');
  });

  it('returns nothing when the only shared segment is the root separator', () => {
    expect(sharedPathPrefix(['/one/proj', '/two/proj'])).toBe('');
  });

  it('needs at least two paths to have anything shared', () => {
    expect(sharedPathPrefix([])).toBe('');
    expect(sharedPathPrefix(['/a/b/proj'])).toBe('');
  });

  it('handles Windows separators like projectDisplayName does', () => {
    const prefix = sharedPathPrefix(['C:\\Users\\x\\one\\proj', 'C:\\Users\\x\\two\\proj']);
    expect(prefix).toBe('C:\\Users\\x\\');
  });
});
