import {
  extractPlanRefs,
  readPlanRefs,
  getProjectPlans,
  getPlanRefStats,
  resetPlanRefCache,
} from '../electron/modules/plans-reader';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, utimesSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let dir: string;
let transcript: string;

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

function planLine(path: string, type: 'plan_mode' | 'plan_mode_exit', timestamp: string): string {
  return line({ type: 'attachment', timestamp, attachment: { type, planFilePath: path } });
}

/** Push a file's mtime forward: two writes inside the same millisecond would
 *  otherwise look unchanged to the cache (mtime+size key). */
function touch(path: string, secondsAhead: number): void {
  const st = statSync(path);
  const t = st.mtimeMs / 1000 + secondsAhead;
  utimesSync(path, t, t);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cl-plans-'));
  transcript = join(dir, 'sess.jsonl');
  resetPlanRefCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('extractPlanRefs (pure)', () => {
  it('maps plan_mode to proposed and plan_mode_exit to approved', () => {
    const raw = [
      planLine('/p/a.md', 'plan_mode', '2026-01-01T00:00:00Z'),
      planLine('/p/b.md', 'plan_mode_exit', '2026-01-01T00:01:00Z'),
    ].join('\n');

    expect(extractPlanRefs(raw)).toEqual([
      {
        filePath: '/p/a.md',
        status: 'proposed',
        timestamp: '2026-01-01T00:00:00Z',
        slug: undefined,
        gitBranch: undefined,
      },
      {
        filePath: '/p/b.md',
        status: 'approved',
        timestamp: '2026-01-01T00:01:00Z',
        slug: undefined,
        gitBranch: undefined,
      },
    ]);
  });

  it('carries slug and gitBranch when present', () => {
    const raw = line({
      type: 'attachment',
      timestamp: '2026-01-01T00:00:00Z',
      slug: 'curious-horizon',
      gitBranch: 'fix/148',
      attachment: { type: 'plan_mode', planFilePath: '/p/a.md' },
    });
    expect(extractPlanRefs(raw)[0]).toMatchObject({
      slug: 'curious-horizon',
      gitBranch: 'fix/148',
    });
  });

  it('skips malformed lines, non-attachment lines and attachments without a path', () => {
    const raw = [
      '{ this is not json but mentions plan_mode',
      line({ type: 'user', message: { role: 'user', content: 'talking about plan_mode' } }),
      line({ type: 'attachment', attachment: { type: 'plan_mode' } }), // no planFilePath
      line({ type: 'attachment', attachment: { type: 'other', planFilePath: '/p/x.md' } }),
      planLine('/p/ok.md', 'plan_mode', '2026-01-01T00:00:00Z'),
    ].join('\n');

    expect(extractPlanRefs(raw).map(r => r.filePath)).toEqual(['/p/ok.md']);
  });

  it('returns [] for empty content', () => {
    expect(extractPlanRefs('')).toEqual([]);
  });
});

describe('readPlanRefs (cached, incremental)', () => {
  it('serves an unchanged file from cache with zero file reads', async () => {
    writeFileSync(
      transcript,
      planLine('/p/a.md', 'plan_mode', '2026-01-01T00:00:00Z') + '\n',
      'utf-8'
    );

    const first = await readPlanRefs(transcript);
    expect(first.map(r => r.filePath)).toEqual(['/p/a.md']);
    expect(getPlanRefStats()).toMatchObject({ fullParses: 1, fileReads: 1, cacheHits: 0 });

    const second = await readPlanRefs(transcript);
    expect(second).toEqual(first);
    // The whole point of #148: the second pass touches no bytes on disk.
    expect(getPlanRefStats()).toMatchObject({ cacheHits: 1, fileReads: 1 });
  });

  it('reads only the tail when the transcript grows', async () => {
    writeFileSync(
      transcript,
      planLine('/p/a.md', 'plan_mode', '2026-01-01T00:00:00Z') + '\n',
      'utf-8'
    );
    await readPlanRefs(transcript);

    appendFileSync(
      transcript,
      planLine('/p/b.md', 'plan_mode_exit', '2026-01-01T00:02:00Z') + '\n',
      'utf-8'
    );
    touch(transcript, 1);

    const refs = await readPlanRefs(transcript);
    expect(refs.map(r => r.filePath)).toEqual(['/p/a.md', '/p/b.md']);
    expect(refs.map(r => r.status)).toEqual(['proposed', 'approved']);
    expect(getPlanRefStats()).toMatchObject({ fullParses: 1, incrementalParses: 1 });
  });

  it('does not fold an appended line twice across increments', async () => {
    writeFileSync(
      transcript,
      planLine('/p/a.md', 'plan_mode', '2026-01-01T00:00:00Z') + '\n',
      'utf-8'
    );
    await readPlanRefs(transcript);

    appendFileSync(
      transcript,
      planLine('/p/b.md', 'plan_mode', '2026-01-01T00:02:00Z') + '\n',
      'utf-8'
    );
    touch(transcript, 1);
    await readPlanRefs(transcript);

    appendFileSync(
      transcript,
      planLine('/p/c.md', 'plan_mode', '2026-01-01T00:03:00Z') + '\n',
      'utf-8'
    );
    touch(transcript, 2);

    expect((await readPlanRefs(transcript)).map(r => r.filePath)).toEqual([
      '/p/a.md',
      '/p/b.md',
      '/p/c.md',
    ]);
  });

  it('folds a trailing line with no newline exactly once, before and after completion', async () => {
    // A transcript caught mid-write: the last line has no terminating newline.
    writeFileSync(transcript, planLine('/p/a.md', 'plan_mode', '2026-01-01T00:00:00Z'), 'utf-8');
    expect((await readPlanRefs(transcript)).map(r => r.filePath)).toEqual(['/p/a.md']);
    // Re-reading the same half-written file must not duplicate that ref.
    expect((await readPlanRefs(transcript)).map(r => r.filePath)).toEqual(['/p/a.md']);

    // The writer finishes the line and appends the next one.
    appendFileSync(
      transcript,
      '\n' + planLine('/p/b.md', 'plan_mode', '2026-01-01T00:01:00Z') + '\n',
      'utf-8'
    );
    touch(transcript, 1);
    expect((await readPlanRefs(transcript)).map(r => r.filePath)).toEqual(['/p/a.md', '/p/b.md']);
  });

  it('re-parses from scratch when the file is rewritten shorter', async () => {
    writeFileSync(
      transcript,
      [
        planLine('/p/a.md', 'plan_mode', '2026-01-01T00:00:00Z'),
        planLine('/p/b.md', 'plan_mode', '2026-01-01T00:01:00Z'),
      ].join('\n') + '\n',
      'utf-8'
    );
    await readPlanRefs(transcript);

    writeFileSync(
      transcript,
      planLine('/p/c.md', 'plan_mode', '2026-01-01T00:05:00Z') + '\n',
      'utf-8'
    );
    touch(transcript, 1);

    // No stale refs from the previous content.
    expect((await readPlanRefs(transcript)).map(r => r.filePath)).toEqual(['/p/c.md']);
    expect(getPlanRefStats()).toMatchObject({ fullParses: 2, incrementalParses: 0 });
  });

  it('never splits a multi-byte char across a read boundary', async () => {
    const buf = Buffer.from(
      line({
        type: 'attachment',
        timestamp: '2026-01-01T00:00:00Z',
        slug: 'però-caffè-🚀',
        attachment: { type: 'plan_mode', planFilePath: '/p/à.md' },
      }),
      'utf-8'
    );
    // Cut INSIDE the 4-byte sequence of the rocket emoji: decoding either half
    // on its own yields U+FFFD, so the ref only survives if the incremental
    // reader keeps the remainder as raw bytes between the two passes.
    const rocket = buf.indexOf(Buffer.from('🚀', 'utf-8'));
    expect(rocket).toBeGreaterThan(0);
    const cut = rocket + 2;

    writeFileSync(transcript, buf.subarray(0, cut));
    await readPlanRefs(transcript);

    appendFileSync(transcript, Buffer.concat([buf.subarray(cut), Buffer.from('\n')]));
    touch(transcript, 1);

    const refs = await readPlanRefs(transcript);
    expect(refs).toHaveLength(1);
    expect(refs[0].slug).toBe('però-caffè-🚀');
  });

  it('returns [] for a missing path or a directory, without throwing', async () => {
    expect(await readPlanRefs(join(dir, 'nope.jsonl'))).toEqual([]);
    expect(await readPlanRefs(dir)).toEqual([]);
  });
});

// La cache sfrattava solo un path che qualcuno richiedeva DI NUOVO e il cui stat
// falliva: un transcript cancellato non viene più richiesto, quindi la sua entry
// sopravviveva per tutta la vita del processo. La glob di ogni scansione è
// l'insieme vivo della directory, ed è ciò che rende esatta la potatura.
describe('cache dei plan ref — potatura dei transcript spariti', () => {
  it('sfratta un transcript cancellato alla scansione successiva, tenendo il superstite', async () => {
    const other = join(dir, 'sess2.jsonl');
    writeFileSync(transcript, planLine('/p/a.md', 'plan_mode', '2026-01-01T00:00:00Z') + '\n');
    writeFileSync(other, planLine('/p/b.md', 'plan_mode_exit', '2026-01-01T00:01:00Z') + '\n');

    await getProjectPlans(dir);
    expect(getPlanRefStats()).toMatchObject({ cachedFiles: 2, evictions: 0 });

    rmSync(other);
    const groups = await getProjectPlans(dir);

    expect(groups.map(g => g.filename)).toEqual(['sess.jsonl']);
    expect(getPlanRefStats()).toMatchObject({ cachedFiles: 1, evictions: 1, cacheHits: 1 });
  });
});
