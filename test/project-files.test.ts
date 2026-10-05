// What the file explorer may list and read. The interesting assertions are the
// fences: nothing outside the project root comes back, whether asked for with
// `..`, an absolute path or a symlink planted in the tree; and a file that is
// not text, or too large to draw, is an answer rather than a payload.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createProjectRootGuard,
  listProjectDir,
  MAX_DIR_ENTRIES,
  MAX_TEXT_BYTES,
  readProjectFile,
} from '../electron/modules/project-files';

let root: string;
let outside: string;

function write(rel: string, content: string | Buffer = 'x'): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

async function names(rel = ''): Promise<string[]> {
  return (await listProjectDir(root, rel)).entries.map(e => e.name);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'files-root-'));
  outside = mkdtempSync(join(tmpdir(), 'files-outside-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('listProjectDir', () => {
  it('lists one level, folders first, then by name in natural order', async () => {
    write('b.ts');
    write('file10.md');
    write('file2.md');
    write('src/deep/a.ts');
    write('docs/x.md');
    expect(await names()).toEqual(['docs', 'src', 'b.ts', 'file2.md', 'file10.md']);
  });

  it('describes each entry with the rel the next call sends back', async () => {
    write('src/App.TSX', 'hello');
    const { entries } = await listProjectDir(root, 'src');
    expect(entries).toEqual([
      { name: 'App.TSX', rel: 'src/App.TSX', kind: 'file', ext: 'tsx', size: 5 },
    ]);
  });

  it('hides .git, the build and dependency dirs and the OS litter, but keeps .claude and dot-files', async () => {
    write('.git/HEAD');
    write('node_modules/x/index.js');
    write('dist/main.js');
    write('.claude/settings.json');
    write('.gitignore');
    write('.DS_Store');
    write('README.md');
    expect(await names()).toEqual(['.claude', '.gitignore', 'README.md']);
  });

  it('refuses a path that climbs out of the root, relative or absolute', async () => {
    await expect(listProjectDir(root, '..')).rejects.toThrow(/under the project/);
    await expect(listProjectDir(root, outside)).rejects.toThrow(/relative/);
  });

  it('drops a symlink whose target is outside the root and keeps one inside', async () => {
    writeFileSync(join(outside, 'secret.txt'), 'no');
    write('real/a.ts');
    symlinkSync(outside, join(root, 'escape'));
    symlinkSync(join(root, 'real'), join(root, 'alias'));
    expect(await names()).toEqual(['alias', 'real']);
  });

  it('refuses to list through a symlinked directory that leaves the root', async () => {
    symlinkSync(outside, join(root, 'escape'));
    await expect(listProjectDir(root, 'escape')).rejects.toThrow(/under the project/);
  });

  it('caps a listing and says it was cut', async () => {
    for (let i = 0; i <= MAX_DIR_ENTRIES; i++) write(`gen/f${i}.txt`);
    const listing = await listProjectDir(root, 'gen');
    expect(listing.entries).toHaveLength(MAX_DIR_ENTRIES);
    expect(listing.truncated).toBe(true);
  });
});

describe('readProjectFile', () => {
  it('reads a text file', async () => {
    write('src/a.ts', 'const a = 1;\n');
    expect(await readProjectFile(root, 'src/a.ts')).toEqual({
      status: 'ok',
      text: 'const a = 1;\n',
      bytes: 13,
    });
  });

  it('answers binary for a file with a NUL byte in its head', async () => {
    write('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    expect(await readProjectFile(root, 'logo.png')).toEqual({ status: 'binary', bytes: 6 });
  });

  it('answers too-large past the cap without reading it', async () => {
    write('big.log', Buffer.alloc(MAX_TEXT_BYTES + 1, 'a'));
    expect(await readProjectFile(root, 'big.log')).toEqual({
      status: 'too-large',
      bytes: MAX_TEXT_BYTES + 1,
    });
  });

  it('answers missing for a file deleted since the listing', async () => {
    expect(await readProjectFile(root, 'gone.md')).toEqual({ status: 'missing' });
  });

  it('refuses a directory, a climb out of the root and a symlink out of it', async () => {
    write('src/a.ts');
    writeFileSync(join(outside, 'secret.txt'), 'no');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    expect((await readProjectFile(root, 'src')).status).toBe('refused');
    expect((await readProjectFile(root, '../x')).status).toBe('refused');
    expect((await readProjectFile(root, join(outside, 'secret.txt'))).status).toBe('refused');
    expect((await readProjectFile(root, 'link.txt')).status).toBe('refused');
  });
});

describe('createProjectRootGuard', () => {
  it('refuses a root the registry does not know, such as the home directory', () => {
    const guard = createProjectRootGuard(() => ['/w/acme']);
    expect(() => guard('/w/acme')).not.toThrow();
    expect(() => guard('/Users/someone')).toThrow(/Unknown project path/);
    expect(() => guard('/w/acme/..')).toThrow(/Unknown project path/);
  });

  it('keeps the registry walk for its ttl, and looks again on a miss at most once per retry', () => {
    let t = 0;
    const discover = vi.fn(() => (t >= 5_000 ? ['/w/acme', '/w/new'] : ['/w/acme']));
    const guard = createProjectRootGuard(discover, { ttlMs: 30_000, retryMs: 2_000, now: () => t });
    guard('/w/acme');
    guard('/w/acme');
    expect(discover).toHaveBeenCalledTimes(1);
    t = 1_000;
    expect(() => guard('/w/new')).toThrow();
    expect(discover).toHaveBeenCalledTimes(1);
    t = 5_000;
    expect(() => guard('/w/new')).not.toThrow();
    expect(discover).toHaveBeenCalledTimes(2);
    t = 40_000;
    guard('/w/acme');
    expect(discover).toHaveBeenCalledTimes(3);
  });
});
