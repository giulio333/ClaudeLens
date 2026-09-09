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
  hasResolvedCwd,
  encodeProjectHash,
} from '../electron/utils';

describe('encodeProjectHash', () => {
  // È la regola con cui Claude Code nomina la cartella di un progetto, e serve
  // a una cosa sola: verificare se un cwd letto da un transcript appartiene
  // davvero alla cartella che lo contiene. Misurata su 50 cartelle reali.
  it('folds every non-alphanumeric character, not just the separators', () => {
    expect(encodeProjectHash('/Users/foo/repo/.claude/worktrees/my-branch')).toBe(
      '-Users-foo-repo--claude-worktrees-my-branch'
    );
    expect(encodeProjectHash('/Users/foo/Projects/SARA2.0')).toBe('-Users-foo-Projects-SARA2-0');
    expect(encodeProjectHash('/Users/foo/Application Support/x')).toBe(
      '-Users-foo-Application-Support-x'
    );
  });

  // pathToHash converte i soli '/', quindi non produrrebbe mai il '--claude' di
  // un path che contiene '/.claude' — cioè fallirebbe proprio sui worktree.
  it('is not pathToHash', () => {
    const p = '/Users/foo/repo/.claude/worktrees/b';
    expect(encodeProjectHash(p)).not.toBe(p.replace(/\//g, '-'));
  });
});

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

  /**
   * Scrive un progetto con i file dati (in ordine di mtime crescente) e ne torna
   * l'hash. `layout` sceglie quale delle due posizioni native di Claude Code
   * ospita i transcript: la radice del progetto o la sua `sessions/`.
   */
  function project(files: string[], layout: 'root' | 'sessions' = 'root'): string {
    return projectAt(`-tmp-fake-project-${n++}`, files, layout);
  }

  /** Come `project`, ma il nome cartella è dato: serve ai casi in cui l'hash è la domanda. */
  function projectAt(hash: string, files: string[], layout: 'root' | 'sessions' = 'root'): string {
    const dir = layout === 'sessions' ? join(root, hash, 'sessions') : join(root, hash);
    mkdirSync(dir, { recursive: true });
    files.forEach((content, i) => {
      const full = join(dir, `s${i}.jsonl`);
      writeFileSync(full, content);
      // mtime crescente: l'ultimo file è il più recente, quello che il reader prova per primo.
      utimesSync(
        full,
        new Date(1_700_000_000_000 + i * 1000),
        new Date(1_700_000_000_000 + i * 1000)
      );
    });
    return hash;
  }

  beforeEach(() => invalidateCwdCache());
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reads the cwd from the head of the file', () => {
    const hash = project([
      `${PREAMBLE}\n${JSON.stringify({ type: 'user', cwd: '/Users/foo/bar' })}\n`,
    ]);
    expect(resolveRealPath(root, hash)).toBe('/Users/foo/bar');
  });

  it('still finds a cwd that sits past the 64KB head (huge first record)', () => {
    // Il primo record utente porta un incolla enorme e il `cwd` cade dopo di
    // esso: la testa non basta, deve intervenire il fallback a file intero.
    const huge = JSON.stringify({
      type: 'user',
      text: 'x'.repeat(200_000),
      cwd: '/Users/foo/huge',
    });
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

  it('reads the cwd of a project whose transcripts live under sessions/', () => {
    // Claude Code writes a project's transcripts in one of two layouts. Reading
    // the project root alone left every `sessions/`-layout project on the lossy
    // `hashToPath` inversion — an ESTIMATED path, presented everywhere the real
    // one is (the SDK's `dir` hint, the purge dialog, Studio's project
    // discovery) with nothing marking it as a guess.
    const hash = project(
      [`${PREAMBLE}\n${JSON.stringify({ type: 'user', cwd: '/Users/foo/SARA2.0' })}\n`],
      'sessions'
    );
    expect(resolveRealPath(root, hash)).toBe('/Users/foo/SARA2.0');
    expect(hasResolvedCwd(hash)).toBe(true);
  });

  // Una sessione aperta nel repo e poi spostata in un git worktree scrive DUE
  // cwd nello stesso transcript: prima il repo padre, poi il worktree. Prendere
  // il primo dava a ogni cartella-worktree il path del repo padre — tre
  // cartelle con lo stesso realPath, che la vista Duplicates mostrava come tre
  // duplicati con path identico, e che il `dir` hint dell'SDK, il dialog di
  // purge e la scoperta dei workflow di Studio puntavano al progetto sbagliato.
  const WORKTREE = '/Users/foo/repo/.claude/worktrees/my-branch';
  const WORKTREE_HASH = '-Users-foo-repo--claude-worktrees-my-branch';

  it('prefers the cwd that encodes back to the folder name over the first one seen', () => {
    const hash = projectAt(WORKTREE_HASH, [
      [
        PREAMBLE,
        JSON.stringify({ type: 'user', cwd: '/Users/foo/repo' }),
        JSON.stringify({ type: 'user', cwd: WORKTREE }),
        '',
      ].join('\n'),
    ]);
    expect(resolveRealPath(root, hash)).toBe(WORKTREE);
  });

  it('escalates past the 64KB head to find the matching cwd, not just any cwd', () => {
    // L'escalation era gated su "nessun cwd trovato". Nella testa di un
    // transcript da worktree il cwd c'è già — è quello del padre — quindi
    // fermarsi lì è esattamente il bug: il gate è sul MATCH.
    const filler = JSON.stringify({ type: 'assistant', text: 'x'.repeat(200_000) });
    const hash = projectAt(WORKTREE_HASH, [
      [
        PREAMBLE,
        JSON.stringify({ type: 'user', cwd: '/Users/foo/repo' }),
        filler,
        JSON.stringify({ type: 'user', cwd: WORKTREE }),
        '',
      ].join('\n'),
    ]);
    expect(resolveRealPath(root, hash)).toBe(WORKTREE);
  });

  it('keeps the first cwd when none encodes back to the folder name', () => {
    // La preferenza non è un requisito: un cwd che non combacia resta una
    // lettura da disco, e quindi meglio della stima di hashToPath. Senza questo
    // ripiego ogni cartella rinominata a mano scenderebbe al path lossy.
    const hash = projectAt('-some-renamed-folder', [
      `${PREAMBLE}\n${JSON.stringify({ type: 'user', cwd: '/Users/foo/elsewhere' })}\n`,
    ]);
    expect(resolveRealPath(root, hash)).toBe('/Users/foo/elsewhere');
  });

  it('still reads the root when sessions/ exists but holds no transcript', () => {
    // A project mid-migration between the two layouts: an empty `sessions/` is
    // not an answer, so the root still decides.
    const hash = project([`${JSON.stringify({ type: 'user', cwd: '/Users/foo/mid' })}\n`]);
    mkdirSync(join(root, hash, 'sessions'), { recursive: true });
    expect(resolveRealPath(root, hash)).toBe('/Users/foo/mid');
  });

  describe('hasResolvedCwd', () => {
    it('turns true only once a cwd has been read off disk', () => {
      const hash = project([`${JSON.stringify({ type: 'user', cwd: '/Users/foo/known' })}\n`]);
      expect(hasResolvedCwd(hash)).toBe(false);
      resolveRealPath(root, hash);
      expect(hasResolvedCwd(hash)).toBe(true);
    });

    it('stays false when the resolve fell back to the lossy hash inversion', () => {
      // Load-bearing for the registry watch-sync: an estimated path is not an
      // answer, so the coordinator must keep listening for the real record.
      const hash = project([`${PREAMBLE}\n`]);
      resolveRealPath(root, hash);
      expect(hasResolvedCwd(hash)).toBe(false);
    });

    it('goes back to false when the entry is invalidated (e.g. after a merge)', () => {
      const hash = project([`${JSON.stringify({ type: 'user', cwd: '/Users/foo/merged' })}\n`]);
      resolveRealPath(root, hash);
      invalidateCwdCache(hash);
      expect(hasResolvedCwd(hash)).toBe(false);
    });
  });
});
