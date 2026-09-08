import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * The reader against real files. The fields added here are the ones the status
 * rule needs (`fan`, `inFlight.kinds`, `routine`, `selfWake`) plus the ones the
 * row can now print (`tokens`, `respawnFlags`, `linkScanPath`) — every one of
 * them read defensively, because `~/.claude/jobs/<id>/state.json` is an
 * undocumented format that has already changed shape under us.
 */

let dir: string;
let getBgSessions: typeof import('../electron/modules/bg-sessions-reader').getBgSessions;

function writeJob(id: string, state: Record<string, unknown>): void {
  const jobDir = join(dir, 'jobs', id);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, 'state.json'), JSON.stringify(state));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cl-bg-'));
  mkdirSync(join(dir, 'jobs'), { recursive: true });
  vi.resetModules();
  vi.doMock('../electron/utils', () => ({ CLAUDE_DIR: dir }));
  vi.doMock('../electron/modules/sessions-registry-reader', () => ({ isPidAlive: () => false }));
  ({ getBgSessions } = await import('../electron/modules/bg-sessions-reader'));
});

afterEach(() => {
  vi.doUnmock('../electron/utils');
  vi.doUnmock('../electron/modules/sessions-registry-reader');
  rmSync(dir, { recursive: true, force: true });
});

describe('getBgSessions', () => {
  it('reads the fields the status rule is taken on', () => {
    writeJob('job-a', {
      state: 'blocked',
      tempo: 'active',
      detail: 'ok do it in a dedicated PR',
      intent: 'why is this skill missing a description?',
      initialPrompt: 'start here',
      sessionId: 'sess-a',
      cwd: '/Users/alice/Projects/acme',
      inFlight: { tasks: 0, kinds: ['session_cron'] },
      fan: [{ id: 'f1', kind: 'shell', label: 'sleep 90; gh pr checks 248', startedAt: 1_700_000 }],
      tokens: 2928,
      respawnFlags: ['--model', 'opus[1m]'],
      routine: { cron: '0 9 * * *' },
      selfWake: true,
      linkScanPath: '/Users/alice/.claude/projects/-Users-alice-Projects-acme/sess-a.jsonl',
    });

    const [s] = getBgSessions();
    expect(s).toMatchObject({
      state: 'blocked',
      tempo: 'active',
      initialPrompt: 'start here',
      inFlightTasks: 0,
      inFlightKinds: ['session_cron'],
      tokens: 2928,
      respawnFlags: ['--model', 'opus[1m]'],
      hasRoutine: true,
      selfWake: true,
      transcriptPath: '/Users/alice/.claude/projects/-Users-alice-Projects-acme/sess-a.jsonl',
    });
    expect(s.fan).toEqual([
      { kind: 'shell', label: 'sleep 90; gh pr checks 248', startedAt: 1_700_000 },
    ]);
  });

  it('defaults every added field when the state file omits them', () => {
    // A job written by an older CLI must cost a zero/empty, never undefined.
    writeJob('job-b', { state: 'done', tempo: 'idle', sessionId: 'sess-b' });

    const [s] = getBgSessions();
    expect(s).toMatchObject({
      initialPrompt: '',
      inFlightKinds: [],
      fan: [],
      tokens: null,
      respawnFlags: [],
      hasRoutine: false,
      selfWake: false,
      transcriptPath: null,
    });
  });

  it('never lets a malformed value through as NaN or a junk entry', () => {
    writeJob('job-c', {
      state: 'working',
      tempo: 'active',
      sessionId: 'sess-c',
      tokens: 'lots',
      inFlight: { tasks: 'many', kinds: ['shell', 7, null] },
      respawnFlags: ['--model', 3, 'opus'],
      fan: [
        'not an object',
        null,
        { kind: '', label: '' },
        { kind: 'shell', label: 'real', startedAt: 'soon' },
      ],
      routine: null,
      selfWake: 'yes',
      linkScanPath: 42,
    });

    const [s] = getBgSessions();
    expect(s.tokens).toBeNull();
    expect(s.inFlightTasks).toBe(0);
    expect(s.inFlightKinds).toEqual(['shell']);
    expect(s.respawnFlags).toEqual(['--model', 'opus']);
    // Only the entry that can be shown survives, and its stamp is 0, not NaN.
    expect(s.fan).toEqual([{ kind: 'shell', label: 'real', startedAt: 0 }]);
    expect(s.hasRoutine).toBe(false); // an explicit null routine is no routine
    expect(s.selfWake).toBe(false); // only `true` means self-waking
    expect(s.transcriptPath).toBeNull();
  });

  it('skips a job directory with no state file and one that does not parse', () => {
    mkdirSync(join(dir, 'jobs', 'empty'), { recursive: true });
    mkdirSync(join(dir, 'jobs', 'broken'), { recursive: true });
    writeFileSync(join(dir, 'jobs', 'broken', 'state.json'), '{ not json');
    writeJob('good', { state: 'done', tempo: 'idle', sessionId: 'sess-good' });

    expect(getBgSessions().map(s => s.id)).toEqual(['good']);
  });
});
