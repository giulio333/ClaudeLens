import { describe, it, expect } from 'vitest';
import {
  landingSessions,
  liveActivityLine,
  relativeWhen,
} from '../src/components/project/overview/session-rows';
import type { SessionSummary } from '../src/types';

// The landing lists pinned sessions above the rest, a live row says what the
// session is doing only when the registry says it is doing something, and the
// date column reads as an age. Each rule here is one the rows depend on.

function session(filename: string): SessionSummary {
  return {
    filename,
    date: '2026-10-01T10:00:00.000Z',
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    cacheSavings: 0,
    messageCount: 0,
    models: {},
  };
}

// Newest first, the order the project's session list arrives in.
const newestFirst = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(n => session(`${n}.jsonl`));
const names = (list: SessionSummary[]) => list.map(s => s.filename.replace('.jsonl', ''));
const pinnedOf =
  (...pins: string[]) =>
  (s: SessionSummary) =>
    pins.includes(s.filename.replace('.jsonl', ''));

describe('landingSessions', () => {
  it('lists the newest sessions when nothing is pinned', () => {
    expect(names(landingSessions(newestFirst, pinnedOf(), 5))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('puts pinned sessions first, newest first, then fills with the rest', () => {
    expect(names(landingSessions(newestFirst, pinnedOf('f', 'c'), 5))).toEqual([
      'c',
      'f',
      'a',
      'b',
      'd',
    ]);
  });

  it('shows a pinned session the cap would otherwise leave out', () => {
    expect(names(landingSessions(newestFirst, pinnedOf('g'), 3))).toEqual(['g', 'a', 'b']);
  });

  it('is pins only when the pins reach the cap', () => {
    expect(names(landingSessions(newestFirst, pinnedOf('b', 'd', 'g'), 3))).toEqual([
      'b',
      'd',
      'g',
    ]);
    expect(names(landingSessions(newestFirst, pinnedOf('a', 'b', 'd', 'g'), 3))).toEqual([
      'a',
      'b',
      'd',
    ]);
  });
});

describe('liveActivityLine', () => {
  const editing = { lastTool: { name: 'Edit', arg: 'session-reader.ts' }, delegates: [] };

  it('says nothing for a session that is not in the registry', () => {
    expect(liveActivityLine(undefined, editing)).toBeNull();
  });

  it('claims no activity for an idle or unknown session, even with a tool in the tail', () => {
    expect(liveActivityLine({ status: 'idle' }, editing)).toBeNull();
    expect(liveActivityLine({ status: 'unknown' }, editing)).toBeNull();
  });

  it('names the tool and its subject while busy', () => {
    expect(liveActivityLine({ status: 'busy' }, editing)).toEqual({
      text: 'Edit · session-reader.ts',
      waiting: false,
    });
    expect(
      liveActivityLine({ status: 'busy' }, { lastTool: { name: 'Bash', arg: '' }, delegates: [] })
    ).toEqual({ text: 'Bash', waiting: false });
  });

  it('names the sub-agent a busy session waits on when it has no call of its own', () => {
    const delegates = [
      { id: '1', name: 'Explore', at: 0 },
      { id: '2', name: 'Plan', at: 0 },
    ];
    expect(liveActivityLine({ status: 'busy' }, { lastTool: null, delegates })).toEqual({
      text: 'Explore +1 · sub-agent running',
      waiting: false,
    });
  });

  it('says only that a busy session works when the tail has nothing to name', () => {
    expect(liveActivityLine({ status: 'busy' }, undefined)).toEqual({
      text: 'Working',
      waiting: false,
    });
  });

  it('says what a waiting session needs, and falls back when the registry does not say', () => {
    expect(liveActivityLine({ status: 'waiting', waitingFor: 'approve Bash' }, editing)).toEqual({
      text: 'Needs you · approve Bash',
      waiting: true,
    });
    expect(liveActivityLine({ status: 'waiting' }, undefined)?.text).toBe(
      'Needs you · a prompt in the terminal'
    );
  });
});

describe('relativeWhen', () => {
  const now = Date.parse('2026-10-05T19:40:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('reads as an age within the retention window', () => {
    expect(relativeWhen(ago(20_000), now)).toBe('now');
    expect(relativeWhen(ago(12 * 60_000), now)).toBe('12m ago');
    expect(relativeWhen(ago(5 * 3_600_000), now)).toBe('5h ago');
    expect(relativeWhen(ago(25 * 86_400_000), now)).toBe('25d ago');
  });

  it('falls back to the date past a month, and says nothing for a bad date', () => {
    expect(relativeWhen('2026-07-01T12:00:00.000Z', now)).toBe('Jul 01');
    expect(relativeWhen('not a date', now)).toBe('');
  });

  it('never prints a negative age for a clock a little ahead', () => {
    expect(relativeWhen(new Date(now + 5_000).toISOString(), now)).toBe('now');
  });
});
