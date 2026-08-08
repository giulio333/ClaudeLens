import { describe, it, expect } from 'vitest';
import { fmtDate, fmtModel, modelColor } from '../src/components/project/utils';
import { formatDate } from '../src/components/project/memory/utils';
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
