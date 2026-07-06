import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeMergePlan } from '../electron/modules/duplicate-merger';

let projectsDir: string;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), 'cl-merge-'));
});

describe('computeMergePlan — session rename collisions', () => {
  it('never assigns the same targetName to two different source sessions', () => {
    // La dest ha già "X.jsonl". La source ha sia "X.jsonl" (che quindi va
    // rinominato) sia "X_2.jsonl" (che di per sé non collide con la dest, ma
    // colliderebbe con il nome generato per l'altro file se non si tiene
    // traccia dei target già assegnati in questa stessa esecuzione).
    const sourceHash = '-tmp-source';
    const destHash = '-tmp-dest';
    const sourceDir = join(projectsDir, sourceHash);
    const destDir = join(projectsDir, destHash);
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });

    const cwdLine = (cwd: string) =>
      JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: 'hi' } });

    writeFileSync(join(destDir, 'X.jsonl'), cwdLine('/tmp/dest-project'), 'utf-8');
    writeFileSync(join(sourceDir, 'X.jsonl'), cwdLine('/tmp/source-project'), 'utf-8');
    writeFileSync(join(sourceDir, 'X_2.jsonl'), cwdLine('/tmp/source-project'), 'utf-8');

    const plan = computeMergePlan(projectsDir, sourceHash, destHash);

    const targetNames = plan.sessions.map(s => s.targetName);
    expect(new Set(targetNames).size).toBe(targetNames.length);
  });
});
