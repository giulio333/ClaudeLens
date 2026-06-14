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
      startedAt: 1781201550683,
      status: 'waiting',
      waitingFor: 'permission prompt',
      version: '2.1.173',
      updatedAt: 1781201817044,
      source: 'registry',
    });
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
  it('returns live entries sorted by startedAt desc', async () => {
    writeEntry('1.json', { ...ENTRY, pid: 1, startedAt: 100 });
    writeEntry('2.json', { ...ENTRY, pid: 2, startedAt: 200 });
    const out = await readActiveSessions({ dir, pidAlive: () => true });
    expect(out.map(s => s.pid)).toEqual([2, 1]);
  });

  it('drops stale entries whose pid is dead', async () => {
    writeEntry('1.json', { ...ENTRY, pid: 1 });
    writeEntry('2.json', { ...ENTRY, pid: 2 });
    const out = await readActiveSessions({ dir, pidAlive: pid => pid === 2 });
    expect(out.map(s => s.pid)).toEqual([2]);
  });

  it('skips malformed files without failing the read', async () => {
    writeEntry('bad.json', '{ not json');
    writeEntry('ok.json', ENTRY);
    const out = await readActiveSessions({ dir, pidAlive: () => true });
    expect(out).toHaveLength(1);
    expect(out[0].sessionId).toBe(ENTRY.sessionId);
  });
});
