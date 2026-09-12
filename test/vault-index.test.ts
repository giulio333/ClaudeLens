// What a `[[wikilink]]` in a transcript is allowed to resolve to.
//
// The feature's whole claim is that a chip tells a real citation from an
// invented one, so the interesting assertions here are the NEGATIVE ones: two
// files answering to one name resolve to nothing rather than to a guess, and a
// `rel` that climbs out of the project is refused before anything opens it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import {
  resetVaultIndexCache,
  resolveVaultFile,
  resolveVaultLinks,
  vaultIndexStats,
  wikiLinkTarget,
} from '../electron/modules/vault-index';

let root: string;
let outside: string;

function write(rel: string, content = 'x'): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

/** The one answer the caller acts on: where a target landed, or null. */
function relOf(target: string): string | null {
  return resolveVaultLinks(root, [target])[0].rel;
}

beforeEach(() => {
  // Fixtures belong here, not in whichever test happens to run first: the suite
  // shuffles its order, and the index is module-level state keyed by root.
  resetVaultIndexCache();
  root = mkdtempSync(join(tmpdir(), 'vault-root-'));
  outside = mkdtempSync(join(tmpdir(), 'vault-outside-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  resetVaultIndexCache();
});

describe('wikiLinkTarget', () => {
  it('strips the heading and the alias, which name the same file', () => {
    expect(wikiLinkTarget('Nota')).toBe('Nota');
    expect(wikiLinkTarget('Nota#Sezione')).toBe('Nota');
    expect(wikiLinkTarget('Nota|come la chiamo')).toBe('Nota');
    expect(wikiLinkTarget('Nota#Sezione|alias')).toBe('Nota');
  });
});

describe('resolveVaultLinks', () => {
  it('resolves a note cited without its extension', () => {
    write('Progetti/Domanda di Laurea Delphi.md');
    expect(relOf('Domanda di Laurea Delphi')).toBe('Progetti/Domanda di Laurea Delphi.md');
  });

  it('resolves an attachment cited with its extension', () => {
    write('Progetti/Laurea/Procedura Upload Tesi.pdf');
    const [answer] = resolveVaultLinks(root, ['Procedura Upload Tesi.pdf']);
    expect(answer.rel).toBe('Progetti/Laurea/Procedura Upload Tesi.pdf');
    expect(answer.match).toBe('exact');
  });

  it('folds case, underscores and spaces the way the memory graph does', () => {
    write('notes/Sync Service.md');
    expect(relOf('sync-service')).toBe('notes/Sync Service.md');
    expect(relOf('sync_service')).toBe('notes/Sync Service.md');
    expect(relOf('SYNC SERVICE')).toBe('notes/Sync Service.md');
  });

  it('answers a missing citation with null — the source is not there', () => {
    write('notes/Nota.md');
    const [answer] = resolveVaultLinks(root, ['Procedura Upload Tesi.pdf']);
    expect(answer).toEqual({ target: 'Procedura Upload Tesi.pdf', rel: null, match: null });
  });

  it('prefers a miss to a guess when two files answer to one name', () => {
    write('a/Nota.txt');
    write('b/Nota.rtf');
    expect(relOf('Nota')).toBeNull();
  });

  it('but reads an extension-less citation as the markdown note, as a vault does', () => {
    write('a/Nota.md');
    write('b/Nota.png');
    expect(relOf('Nota')).toBe('a/Nota.md');
    // The explicit forms still name their own file.
    expect(relOf('Nota.png')).toBe('b/Nota.png');
  });

  it('accepts a partial path only when exactly one file ends there', () => {
    write('Progetti/Laurea/Procedura.md');
    const [answer] = resolveVaultLinks(root, ['Laurea/Procedura']);
    expect(answer.rel).toBe('Progetti/Laurea/Procedura.md');
    expect(answer.match).toBe('fuzzy');

    write('Archivio/Laurea/Procedura.md');
    resetVaultIndexCache();
    expect(relOf('Laurea/Procedura')).toBeNull();
  });

  it('does not fall back to a substring match', () => {
    write('notes/Procedura Upload Tesi.md');
    // One candidate contains it, so a "contains" rule would have resolved this.
    expect(relOf('Upload')).toBeNull();
  });

  it('answers every target of a batch, in order', () => {
    write('notes/Uno.md');
    const answers = resolveVaultLinks(root, ['Uno', 'Due', 'Uno']);
    expect(answers.map(a => a.target)).toEqual(['Uno', 'Due', 'Uno']);
    expect(answers.map(a => a.rel)).toEqual(['notes/Uno.md', null, 'notes/Uno.md']);
  });

  it('skips dot-directories and dependency dirs', () => {
    write('.obsidian/Nota.md');
    write('node_modules/pkg/Altra.md');
    write('Vera.md');
    expect(relOf('Nota')).toBeNull();
    expect(relOf('Altra')).toBeNull();
    expect(relOf('Vera')).toBe('Vera.md');
    expect(vaultIndexStats(root)).toEqual({ fileCount: 1, truncated: false });
  });

  it('answers misses for a root that is not a directory instead of throwing', () => {
    const gone = join(root, 'moved-away');
    expect(resolveVaultLinks(gone, ['Nota'])).toEqual([{ target: 'Nota', rel: null, match: null }]);
    expect(resolveVaultLinks('', ['Nota'])[0].rel).toBeNull();
  });

  it('serves a second call from the cached index', () => {
    write('Nota.md');
    expect(relOf('Nota')).toBe('Nota.md');
    write('Seconda.md');
    // Within the TTL the walk is not repeated, so the new file is not seen yet.
    expect(relOf('Seconda')).toBeNull();
    resetVaultIndexCache();
    expect(relOf('Seconda')).toBe('Seconda.md');
  });
});

describe('resolveVaultFile', () => {
  it('returns the absolute path of a file inside the project', () => {
    write('notes/Nota.md');
    expect(resolveVaultFile(root, 'notes/Nota.md')).toContain('notes/Nota.md');
  });

  it('refuses a path that climbs out of the project', () => {
    writeFileSync(join(outside, 'secret.md'), 'x', 'utf-8');
    // Built from the real sibling directory, so the file at the end of it
    // exists: what refuses this is the containment check, not a missing file.
    const climb = join('..', basename(outside), 'secret.md');
    expect(() => resolveVaultFile(root, climb)).toThrow(/under the project/);
    expect(() => resolveVaultFile(root, join(outside, 'secret.md'))).toThrow(/relative/);
  });

  it('refuses a symlink planted inside the project that points outside it', () => {
    writeFileSync(join(outside, 'secret.md'), 'x', 'utf-8');
    symlinkSync(join(outside, 'secret.md'), join(root, 'link.md'));
    expect(() => resolveVaultFile(root, 'link.md')).toThrow(/under the project/);
  });

  it('refuses a directory and a file that is not there', () => {
    mkdirSync(join(root, 'notes'), { recursive: true });
    expect(() => resolveVaultFile(root, 'notes')).toThrow(/not found/);
    expect(() => resolveVaultFile(root, 'nope.md')).toThrow(/not found/);
  });
});
