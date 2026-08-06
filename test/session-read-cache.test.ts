import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  StampCache,
  fileStamp,
  firstFileStamp,
  treeStamp,
} from '../electron/modules/session-read-cache';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cl-stamp-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('fileStamp', () => {
  it('changes when the file grows', async () => {
    const p = join(dir, 'a.jsonl');
    writeFileSync(p, 'one\n');
    const before = await fileStamp(p);
    writeFileSync(p, 'one\ntwo\n');
    const after = await fileStamp(p);

    expect(before).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('is stable across reads of an untouched file', async () => {
    const p = join(dir, 'a.jsonl');
    writeFileSync(p, 'one\n');
    expect(await fileStamp(p)).toBe(await fileStamp(p));
  });

  it('returns null for a missing file and for a directory', async () => {
    expect(await fileStamp(join(dir, 'nope.jsonl'))).toBeNull();
    expect(await fileStamp(dir)).toBeNull();
  });
});

describe('firstFileStamp', () => {
  it('falls through to the first candidate that exists', async () => {
    mkdirSync(join(dir, 'sessions'));
    const real = join(dir, 'sessions', 's.jsonl');
    writeFileSync(real, 'x\n');

    const stamp = await firstFileStamp([join(dir, 's.jsonl'), real]);
    expect(stamp).toBe(await fileStamp(real));
  });

  it('returns null when no candidate exists', async () => {
    expect(await firstFileStamp([join(dir, 'a'), join(dir, 'b')])).toBeNull();
  });
});

describe('treeStamp', () => {
  it('returns "" for an absent directory (a cacheable "no sub-agents")', async () => {
    expect(await treeStamp(join(dir, 'nope'))).toBe('');
  });

  it('covers nested transcripts (workflow sub-agents)', async () => {
    const nested = join(dir, 'workflows', 'wf_1');
    mkdirSync(nested, { recursive: true });
    const p = join(nested, 'agent-x.jsonl');
    writeFileSync(p, 'one\n');
    const before = await treeStamp(dir);

    writeFileSync(p, 'one\ntwo\n');
    expect(await treeStamp(dir)).not.toBe(before);
    expect(before).not.toBe('');
  });

  it('ignores files that feed no read', async () => {
    writeFileSync(join(dir, 'agent-x.jsonl'), 'one\n');
    const before = await treeStamp(dir);
    writeFileSync(join(dir, 'notes.txt'), 'irrelevant');
    expect(await treeStamp(dir)).toBe(before);
  });

  it('covers the .meta.json sidecars (they carry the dispatch toolUseId)', async () => {
    writeFileSync(join(dir, 'agent-x.jsonl'), 'one\n');
    const before = await treeStamp(dir);
    writeFileSync(join(dir, 'agent-x.meta.json'), '{"toolUseId":"toolu_1"}');
    expect(await treeStamp(dir)).not.toBe(before);
  });

  it('changes when a new transcript appears', async () => {
    writeFileSync(join(dir, 'agent-x.jsonl'), 'one\n');
    const before = await treeStamp(dir);
    writeFileSync(join(dir, 'agent-y.jsonl'), 'one\n');
    expect(await treeStamp(dir)).not.toBe(before);
  });
});

describe('StampCache', () => {
  it('serves an unchanged stamp without calling the loader', async () => {
    const cache = new StampCache<number>(4);
    let calls = 0;
    const load = async () => ++calls;

    expect(await cache.read('k', 'v1', load)).toBe(1);
    expect(await cache.read('k', 'v1', load)).toBe(1);
    expect(calls).toBe(1);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, coalesced: 0, uncacheable: 0 });
  });

  it('reloads when the stamp changes', async () => {
    const cache = new StampCache<number>(4);
    let calls = 0;
    const load = async () => ++calls;

    expect(await cache.read('k', 'v1', load)).toBe(1);
    expect(await cache.read('k', 'v2', load)).toBe(2);
    expect(calls).toBe(2);
  });

  it('never caches a null stamp (unknown source)', async () => {
    const cache = new StampCache<number>(4);
    let calls = 0;
    const load = async () => ++calls;

    await cache.read('k', null, load);
    await cache.read('k', null, load);
    expect(calls).toBe(2);
    expect(cache.stats().size).toBe(0);
    // Counted apart from a miss: a miss can become a hit, this never can.
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 0, uncacheable: 2 });
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const cache = new StampCache<number>(4);
    let calls = 0;
    const load = async () => {
      calls++;
      await new Promise(r => setTimeout(r, 10));
      return calls;
    };

    const [a, b] = await Promise.all([cache.read('k', 'v1', load), cache.read('k', 'v1', load)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    // The joined caller is not a cache hit: nothing was stored when it arrived.
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 1, coalesced: 1 });
  });

  it('drops the in-flight entry when the load rejects, so the next call retries', async () => {
    const cache = new StampCache<number>(4);
    let calls = 0;
    const load = async () => {
      calls++;
      throw new Error('boom');
    };

    await expect(cache.read('k', 'v1', load)).rejects.toThrow('boom');
    await expect(cache.read('k', 'v1', load)).rejects.toThrow('boom');
    expect(calls).toBe(2);
  });

  it('evicts least-recently-used beyond the bound', async () => {
    const cache = new StampCache<string>(2);
    const load = (v: string) => async () => v;

    await cache.read('a', 's', load('a'));
    await cache.read('b', 's', load('b'));
    await cache.read('a', 's', load('a')); // 'a' becomes most recent
    await cache.read('c', 's', load('c')); // evicts 'b'

    expect(cache.stats().size).toBe(2);

    // 'a' was refreshed before 'c' arrived, so it survived: still no reload.
    let aReloads = 0;
    await cache.read('a', 's', async () => {
      aReloads++;
      return 'a';
    });
    expect(aReloads).toBe(0);

    // 'b' was the least recently used and got dropped: it has to reload.
    let bReloads = 0;
    await cache.read('b', 's', async () => {
      bReloads++;
      return 'b';
    });
    expect(bReloads).toBe(1);
  });
});
