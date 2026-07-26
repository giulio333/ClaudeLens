import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import {
  isAbsolutePath,
  validateEntityName,
  assertWithin,
  isValidSessionId,
  resolveRealPath,
  invalidateCwdCache,
} from '../electron/utils';

describe('isAbsolutePath', () => {
  it('accepts POSIX absolute paths', () => {
    expect(isAbsolutePath('/Users/foo/bar')).toBe(true);
    expect(isAbsolutePath('/')).toBe(true);
  });

  it('accepts Windows drive-letter paths (backslash and forward slash)', () => {
    expect(isAbsolutePath('C:\\Users\\foo\\bar')).toBe(true);
    expect(isAbsolutePath('C:/Users/foo/bar')).toBe(true);
    expect(isAbsolutePath('d:\\projects')).toBe(true);
  });

  it('accepts Windows UNC paths', () => {
    expect(isAbsolutePath('\\\\server\\share\\dir')).toBe(true);
  });

  it('rejects relative and non-path strings', () => {
    expect(isAbsolutePath('foo/bar')).toBe(false);
    expect(isAbsolutePath('./foo')).toBe(false);
    expect(isAbsolutePath('C:')).toBe(false);
    expect(isAbsolutePath('')).toBe(false);
  });
});

describe('validateEntityName (issue #58)', () => {
  it('accepts safe names and returns them trimmed', () => {
    expect(validateEntityName('my-skill')).toBe('my-skill');
    expect(validateEntityName('  Code Reviewer  ')).toBe('Code Reviewer');
    expect(validateEntityName('agent_v1.2')).toBe('agent_v1.2');
  });

  it('rejects path-traversal and separator-bearing names', () => {
    expect(() => validateEntityName('../../../tmp/x')).toThrow(/Invalid name/);
    expect(() => validateEntityName('a/b')).toThrow(/Invalid name/);
    expect(() => validateEntityName('a\\b')).toThrow(/Invalid name/);
    expect(() => validateEntityName('.')).toThrow(/Invalid name/);
    expect(() => validateEntityName('..')).toThrow(/Invalid name/);
  });

  it('rejects empty and over-long names', () => {
    expect(() => validateEntityName('')).toThrow(/Invalid name/);
    expect(() => validateEntityName('   ')).toThrow(/Invalid name/);
    expect(() => validateEntityName('x'.repeat(81))).toThrow(/Invalid name/);
  });
});

describe('assertWithin (issue #58)', () => {
  const base = '/Users/foo/.claude/skills';

  it('allows the base dir and paths inside it', () => {
    expect(() => assertWithin(base, base)).not.toThrow();
    expect(() => assertWithin(base, join(base, 'my-skill', 'SKILL.md'))).not.toThrow();
  });

  it('throws for resolved paths that escape the base dir', () => {
    expect(() => assertWithin(base, join(base, '..', '..', 'evil'))).toThrow(/outside/);
    expect(() => assertWithin(base, '/etc/passwd')).toThrow(/outside/);
  });
});

describe('isValidSessionId (issue #57)', () => {
  it('accepts canonical UUIDs', () => {
    expect(isValidSessionId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('rejects ids carrying shell metacharacters or wrong shape', () => {
    expect(isValidSessionId('x"; rm -rf ~; echo "')).toBe(false);
    expect(isValidSessionId('x & calc')).toBe(false);
    expect(isValidSessionId('not-a-uuid')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
  });
});

describe('resolveRealPath (cwd extraction)', () => {
  const root = mkdtempSync(join(tmpdir(), 'cl-resolve-'));
  let n = 0;

  // Preambolo realistico: le prime righe del transcript non portano il cwd.
  const PREAMBLE = [
    JSON.stringify({ type: 'mode', mode: 'default' }),
    JSON.stringify({ type: 'permission-mode', permissionMode: 'default' }),
    JSON.stringify({ type: 'file-history-snapshot', snapshot: {} }),
  ].join('\n');

  /** Scrive un progetto con i file dati (in ordine di mtime crescente) e ne torna l'hash. */
  function project(files: string[]): string {
    const hash = `-tmp-fake-project-${n++}`;
    const dir = join(root, hash);
    mkdirSync(dir, { recursive: true });
    files.forEach((content, i) => {
      const full = join(dir, `s${i}.jsonl`);
      writeFileSync(full, content);
      // mtime crescente: l'ultimo file è il più recente, quello che il reader prova per primo.
      utimesSync(full, new Date(1_700_000_000_000 + i * 1000), new Date(1_700_000_000_000 + i * 1000));
    });
    return hash;
  }

  beforeEach(() => invalidateCwdCache());
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reads the cwd from the head of the file', () => {
    const hash = project([`${PREAMBLE}\n${JSON.stringify({ type: 'user', cwd: '/Users/foo/bar' })}\n`]);
    expect(resolveRealPath(root, hash)).toBe('/Users/foo/bar');
  });

  it('still finds a cwd that sits past the 64KB head (huge first record)', () => {
    // Il primo record utente porta un incolla enorme e il `cwd` cade dopo di
    // esso: la testa non basta, deve intervenire il fallback a file intero.
    const huge = JSON.stringify({ type: 'user', text: 'x'.repeat(200_000), cwd: '/Users/foo/huge' });
    const hash = project([`${PREAMBLE}\n${huge}\n`]);
    expect(resolveRealPath(root, hash)).toBe('/Users/foo/huge');
  });

  it('does not mis-parse a record truncated by the head boundary', () => {
    // Riga senza cwd tagliata a metà dal chunk; il cwd valido la segue. La 'x'
    // iniziale sfasa di un byte i caratteri a 2 byte che seguono, così il
    // confine dei 64 KB cade *dentro* una sequenza UTF-8 (verificato: il byte
    // 65536 è 0xa0, un byte di continuazione) e copre anche quel caso.
    const straddling = JSON.stringify({ type: 'assistant', text: `x${'à'.repeat(40_000)}` });
    const hash = project([
      `${PREAMBLE}\n${straddling}\n${JSON.stringify({ type: 'user', cwd: '/Users/foo/late' })}\n`,
    ]);
    expect(resolveRealPath(root, hash)).toBe('/Users/foo/late');
  });

  it('skips malformed lines and non-absolute cwd values', () => {
    const hash = project([
      [
        PREAMBLE,
        '{ not json at all "cwd"',
        JSON.stringify({ type: 'user', cwd: 'relative/path' }),
        JSON.stringify({ type: 'user', cwd: '/Users/foo/good' }),
        '',
      ].join('\n'),
    ]);
    expect(resolveRealPath(root, hash)).toBe('/Users/foo/good');
  });

  it('prefers the most recently modified transcript', () => {
    const hash = project([
      `${JSON.stringify({ type: 'user', cwd: '/Users/foo/older' })}\n`,
      `${JSON.stringify({ type: 'user', cwd: '/Users/foo/newer' })}\n`,
    ]);
    expect(resolveRealPath(root, hash)).toBe('/Users/foo/newer');
  });

  it('falls back to the lossy hash inversion when no transcript carries a cwd', () => {
    const hash = project([`${PREAMBLE}\n`]);
    expect(resolveRealPath(root, hash)).toBe(`/${hash.replace(/^-/, '').replace(/-/g, '/')}`);
  });
});
