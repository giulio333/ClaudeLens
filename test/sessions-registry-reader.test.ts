import {
  parseRegistryEntry,
  readActiveSessions,
} from '../electron/modules/sessions-registry-reader';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let dir: string;

const ENTRY = {
  pid: 12345,
  sessionId: '2bcf43d9-7d4b-4a89-b776-848b91103a67',
  cwd: '/Users/foo/proj',
  startedAt: 1781201550683,
  version: '2.1.173',
  kind: 'interactive',
  entrypoint: 'cli',
  status: 'waiting',
  updatedAt: 1781201817044,
  waitingFor: 'permission prompt',
};

function writeEntry(name: string, obj: unknown): void {
  writeFileSync(join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf-8');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cl-reg-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseRegistryEntry', () => {
  it('maps a full registry entry', () => {
    expect(parseRegistryEntry(ENTRY)).toEqual({
      pid: 12345,
      sessionId: '2bcf43d9-7d4b-4a89-b776-848b91103a67',
      cwd: '/Users/foo/proj',
      kind: 'interactive',
      startedAt: 1781201550683,
      status: 'waiting',
      waitingFor: 'permission prompt',
      version: '2.1.173',
      updatedAt: 1781201817044,
      source: 'registry',
    });
  });

  // Real 2.1.233 entries carry a derived session name and a separate stamp for
  // the last status transition; both were dropped on the floor before the
  // Monitor needed them (a row titled `claudelens-b4` beats one titled `2bcf43d9`).
  it('reads the derived name and statusUpdatedAt when present', () => {
    const parsed = parseRegistryEntry({
      ...ENTRY,
      name: 'claudelens-b4',
      nameSource: 'derived',
      statusUpdatedAt: 1781201817044,
    });
    expect(parsed?.name).toBe('claudelens-b4');
    expect(parsed?.statusUpdatedAt).toBe(1781201817044);
  });

  it('leaves name/kind/statusUpdatedAt undefined rather than inventing them', () => {
    const parsed = parseRegistryEntry({
      pid: 1,
      sessionId: 'abc',
      cwd: '/Users/foo/proj',
      status: 'busy',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBeUndefined();
    expect(parsed?.kind).toBeUndefined();
    expect(parsed?.statusUpdatedAt).toBeUndefined();
    // An empty string is not a name.
    expect(parseRegistryEntry({ ...ENTRY, name: '' })?.name).toBeUndefined();
    expect(
      parseRegistryEntry({ ...ENTRY, statusUpdatedAt: 'soon' })?.statusUpdatedAt
    ).toBeUndefined();
  });

  it('rejects entries missing pid, sessionId or cwd', () => {
    expect(parseRegistryEntry({ ...ENTRY, pid: undefined })).toBeNull();
    expect(parseRegistryEntry({ ...ENTRY, pid: -1 })).toBeNull();
    expect(parseRegistryEntry({ ...ENTRY, sessionId: '' })).toBeNull();
    expect(parseRegistryEntry({ ...ENTRY, cwd: '/' })).toBeNull();
    expect(parseRegistryEntry(null)).toBeNull();
    expect(parseRegistryEntry('not an object')).toBeNull();
  });

  it('rejects non-cli entrypoints but accepts a missing one', () => {
    expect(parseRegistryEntry({ ...ENTRY, entrypoint: 'sdk-ts' })).toBeNull();
    expect(parseRegistryEntry({ ...ENTRY, entrypoint: undefined })).not.toBeNull();
  });

  it('defaults status to unknown and tolerates missing optionals', () => {
    const minimal = parseRegistryEntry({ pid: 1, sessionId: 'x', cwd: '/a' });
    expect(minimal).toMatchObject({ status: 'unknown', source: 'registry' });
    expect(minimal?.startedAt).toBeUndefined();
    expect(minimal?.waitingFor).toBeUndefined();
  });
});

describe('readActiveSessions', () => {
  // Identity check that accepts every candidate pid as a claude CLI; the
  // pid-reuse guard is exercised in its own tests below.
  const allClaude = (pids: number[]) => Promise.resolve(new Map(pids.map(p => [p, 'claude'])));

  it('returns live entries sorted by startedAt desc', async () => {
    writeEntry('1.json', { ...ENTRY, pid: 1, startedAt: 100 });
    writeEntry('2.json', { ...ENTRY, pid: 2, startedAt: 200 });
    const out = await readActiveSessions({ dir, pidAlive: () => true, pidCommands: allClaude });
    expect(out.map(s => s.pid)).toEqual([2, 1]);
  });

  it('drops stale entries whose pid is dead', async () => {
    writeEntry('1.json', { ...ENTRY, pid: 1 });
    writeEntry('2.json', { ...ENTRY, pid: 2 });
    const out = await readActiveSessions({
      dir,
      pidAlive: pid => pid === 2,
      pidCommands: allClaude,
    });
    expect(out.map(s => s.pid)).toEqual([2]);
  });

  it('keeps entries with an old updatedAt (long busy turn writes no heartbeat)', async () => {
    // Verified live on 2.1.198: the CLI rewrites the file only on status
    // transitions, so a session mid-turn can be minutes past its updatedAt.
    writeEntry('1.json', { ...ENTRY, pid: 1, updatedAt: 100 });
    const out = await readActiveSessions({ dir, pidAlive: () => true, pidCommands: allClaude });
    expect(out.map(s => s.pid)).toEqual([1]);
  });

  it('drops entries whose live pid no longer runs a claude CLI (pid reuse)', async () => {
    writeEntry('claude.json', { ...ENTRY, pid: 1 });
    writeEntry('reused.json', { ...ENTRY, pid: 2 });
    writeEntry('gone-from-ps.json', { ...ENTRY, pid: 3 });
    const out = await readActiveSessions({
      dir,
      pidAlive: () => true,
      pidCommands: () =>
        Promise.resolve(
          new Map([
            [1, 'claude --resume abc'],
            [2, '/usr/bin/vim notes.txt'],
          ])
        ),
    });
    expect(out.map(s => s.pid)).toEqual([1]);
  });

  it('excludes the Claude desktop app from the CLI identity match', async () => {
    writeEntry('1.json', { ...ENTRY, pid: 1 });
    const out = await readActiveSessions({
      dir,
      pidAlive: () => true,
      pidCommands: () =>
        Promise.resolve(new Map([[1, '/Applications/Claude.app/Contents/MacOS/Claude']])),
    });
    expect(out).toEqual([]);
  });

  it('falls back to the pid probe alone when the identity check cannot run', async () => {
    writeEntry('1.json', { ...ENTRY, pid: 1 });
    const out = await readActiveSessions({
      dir,
      pidAlive: () => true,
      pidCommands: () => Promise.resolve(null),
    });
    expect(out.map(s => s.pid)).toEqual([1]);
  });

  it('does not fall back to the scanner when a populated registry filters to empty', async () => {
    // A dead session's leftover file means a 2.x CLI owns liveness: report
    // nothing live instead of guessing sessionId-less entries from ps.
    writeEntry('1.json', { ...ENTRY, pid: 1 });
    const out = await readActiveSessions({ dir, pidAlive: () => false, pidCommands: allClaude });
    expect(out).toEqual([]);
  });

  it('skips malformed files without failing the read', async () => {
    writeEntry('bad.json', '{ not json');
    writeEntry('ok.json', ENTRY);
    const out = await readActiveSessions({ dir, pidAlive: () => true, pidCommands: allClaude });
    expect(out).toHaveLength(1);
    expect(out[0].sessionId).toBe(ENTRY.sessionId);
  });
});
