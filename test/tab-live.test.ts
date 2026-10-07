// What a tab says about its session when the pointer is on it — the line that
// slides in beside the title — and how full its context window is, the fill the
// tab wears at rest. Only what the registry and the transcript tail say: no
// reading, no fill.
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_HIGH,
  contextShare,
  liveLine,
  newestWrite,
  shortArg,
} from '../src/components/project/terminal/tab-live';
import type { ActiveSession, SessionActivity } from '../src/types';

const NOW = 10_000_000;

const entry = (patch: Partial<ActiveSession>): ActiveSession => ({
  pid: 2,
  sessionId: 's-1',
  cwd: '/synthetic/acme',
  status: 'idle',
  source: 'registry',
  ...patch,
});

const activity = (patch: Partial<SessionActivity>): SessionActivity =>
  ({ sessionId: 's-1', lastTool: null, delegates: [], context: null, ...patch }) as SessionActivity;

describe('liveLine', () => {
  it('names the tool at work and its subject in a word', () => {
    const bash = activity({ lastTool: { name: 'Bash', arg: 'cd web && CI=1 npm run test' } });
    expect(liveLine('busy', undefined, bash, NOW)).toBe('Bash · npm');
    const edit = activity({ lastTool: { name: 'Edit', arg: '/synthetic/acme/src/App.tsx' } });
    expect(liveLine('busy', undefined, edit, NOW)).toBe('Edit · App.tsx');
    expect(
      liveLine('busy', undefined, activity({ lastTool: { name: 'Task', arg: '' } }), NOW)
    ).toBe('Task');
  });

  it('names the agent a working session waits on, else says only that it works', () => {
    const delegating = activity({ delegates: [{ id: 'a', name: 'code-reviewer', at: NOW }] });
    expect(liveLine('busy', undefined, delegating, NOW)).toBe('Agent · code-reviewer');
    expect(liveLine('busy', undefined, undefined, NOW)).toBe('Working');
  });

  it('says what a wait is for, a question in words', () => {
    expect(
      liveLine('waiting', entry({ status: 'waiting', waitingFor: 'input needed' }), undefined, NOW)
    ).toBe('Asks you a question');
    expect(
      liveLine(
        'waiting',
        entry({ status: 'waiting', waitingFor: 'permission prompt' }),
        undefined,
        NOW
      )
    ).toBe('permission prompt');
    expect(liveLine('waiting', undefined, undefined, NOW)).toBe('Waiting for you');
  });

  it('says how long a session has been idle when the registry dates it, and no more', () => {
    expect(liveLine('idle', entry({ statusUpdatedAt: NOW - 4 * 60_000 }), undefined, NOW)).toBe(
      'Idle · 4 min'
    );
    expect(liveLine('idle', entry({}), undefined, NOW)).toBe('Your turn');
    expect(liveLine('ended', undefined, undefined, NOW)).toBe('Ended');
    expect(liveLine('lens', undefined, undefined, NOW)).toBe('Lens only');
    expect(liveLine('starting', undefined, undefined, NOW)).toBe('Starting');
  });
});

describe('contextShare', () => {
  it('is the share of the window in use, capped at full', () => {
    expect(contextShare(activity({ context: { used: 50_000, max: 200_000 } }))).toBe(0.25);
    expect(contextShare(activity({ context: { used: 250_000, max: 200_000 } }))).toBe(1);
  });

  it('is unknown, not empty, while no turn has been read', () => {
    expect(contextShare(activity({}))).toBeNull();
    expect(contextShare(undefined)).toBeNull();
    expect(contextShare(activity({ context: { used: 10, max: 0 } }))).toBeNull();
  });

  it('calls a window high from the point where compaction is near', () => {
    expect(CONTEXT_HIGH).toBe(0.8);
  });
});

describe('shortArg', () => {
  it('keeps the program a command runs and the name of a path', () => {
    expect(shortArg({ name: 'Bash', arg: 'FOO=1 BAR=2 make build' })).toBe('make');
    expect(shortArg({ name: 'Read', arg: 'C:\\synthetic\\notes.md' })).toBe('notes.md');
    expect(shortArg({ name: 'Grep', arg: 'needle in a haystack' })).toBe('needle in a haystack');
  });
});

describe('newestWrite', () => {
  it('is the last file a call wrote, by the call that wrote it', () => {
    const a = activity({
      recent: [
        { at: 1, kind: 'tool', tool: 'Edit', arg: '/synthetic/acme/a.ts', id: 'tu-1', done: true },
        { at: 2, kind: 'tool', tool: 'Write', arg: '/synthetic/acme/b.md', id: 'tu-2', done: true },
        { at: 3, kind: 'tool', tool: 'Read', arg: '/synthetic/acme/c.ts', id: 'tu-3', done: true },
        { at: 4, kind: 'text' },
      ],
    });
    expect(newestWrite(a)).toEqual({ key: 'tu-2', name: 'b.md' });
  });

  it('counts no write before its result, and none that came back an error', () => {
    const edit = (patch: object) => ({
      at: 2,
      kind: 'tool' as const,
      tool: 'Edit',
      arg: '/synthetic/acme/b.ts',
      id: 'tu-2',
      ...patch,
    });
    const before = {
      at: 1,
      kind: 'tool' as const,
      tool: 'Edit',
      arg: '/s/a.ts',
      id: 'tu-1',
      done: true,
    };
    // Waiting on the user's approval: the last write is still the one before.
    expect(newestWrite(activity({ recent: [before, edit({})] }))?.key).toBe('tu-1');
    expect(newestWrite(activity({ recent: [before, edit({ done: true })] }))?.key).toBe('tu-2');
    // Denied, or failed: never written.
    expect(
      newestWrite(activity({ recent: [before, edit({ done: true, failed: true })] }))?.key
    ).toBe('tu-1');
  });

  it('is nothing when no call wrote, and keys a call with no id by its time', () => {
    expect(
      newestWrite(
        activity({ recent: [{ at: 1, kind: 'tool', tool: 'Read', arg: 'x', done: true }] })
      )
    ).toBeNull();
    expect(newestWrite(activity({}))).toBeNull();
    expect(newestWrite(undefined)).toBeNull();
    const noId = activity({
      recent: [{ at: 7, kind: 'tool', tool: 'MultiEdit', arg: '/s/z.ts', done: true }],
    });
    expect(newestWrite(noId)).toEqual({ key: '7', name: 'z.ts' });
  });
});
