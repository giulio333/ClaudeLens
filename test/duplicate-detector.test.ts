import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectDuplicateProjects } from '../electron/modules/duplicate-detector';
import { invalidateCwdCache } from '../electron/utils';

// Il detector legge le cartelle history di ~/.claude/projects e propone quelle
// che sembrano lo stesso progetto aperto da due path. Ogni caso costruisce una
// finta projects/ su disco: quanto conta è il numero di sessioni che riesce a
// vedere, perché è quello a decidere se il path del progetto viene presentato
// come letto dal disco o come stimato dal nome cartella.

let projectsDir: string;

/** Scrive un transcript che dichiara `cwd`, nel layout richiesto. */
function session(hash: string, name: string, cwd: string, layout: 'root' | 'sessions'): void {
  const dir = layout === 'sessions' ? join(projectsDir, hash, 'sessions') : join(projectsDir, hash);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify({ type: 'user', cwd, message: { content: 'hi' } }), 'utf-8');
  utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
}

beforeEach(() => {
  invalidateCwdCache(); // la cache dei cwd è module-level e i temp dir cambiano
  projectsDir = mkdtempSync(join(tmpdir(), 'cl-dup-'));
});

afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

describe('detectDuplicateProjects', () => {
  it('conta le sessioni di un progetto che le tiene in sessions/', () => {
    // Leggere la sola radice riportava zero sessioni per questo layout — e con
    // zero sessioni il path del progetto viene marcato come stimato anche quando
    // sta scritto per esteso in un transcript.
    session('-Users-me-repo', 'a.jsonl', '/Users/me/repo', 'sessions');
    session('-Users-me-Projects-repo', 'b.jsonl', '/Users/me/Projects/repo', 'root');

    const [group] = detectDuplicateProjects(projectsDir);

    expect(group.name).toBe('repo');
    const nested = group.folders.find(f => f.hash === '-Users-me-repo')!;
    expect(nested.sessionCount).toBe(1);
    expect(nested.realPathAuthoritative).toBe(true);
    expect(nested.lastActivity).not.toBeNull();
  });

  it('raggruppa due cartelle sullo stesso basename anche in layout diversi', () => {
    session('-Users-me-a-SARA2-0', 'a.jsonl', '/Users/me/a/SARA2.0', 'sessions');
    session('-Users-me-b-SARA2-0', 'b.jsonl', '/Users/me/b/SARA2.0', 'root');

    const groups = detectDuplicateProjects(projectsDir);

    expect(groups).toHaveLength(1);
    expect(groups[0].folders.map(f => f.hash).sort()).toEqual([
      '-Users-me-a-SARA2-0',
      '-Users-me-b-SARA2-0',
    ]);
  });

  it('non propone un gruppo per una cartella sola', () => {
    session('-Users-me-solo', 'a.jsonl', '/Users/me/solo', 'sessions');
    expect(detectDuplicateProjects(projectsDir)).toEqual([]);
  });
});
