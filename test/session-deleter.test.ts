import { getSessionArtifacts, deleteSessionArtifacts } from '../electron/modules/session-deleter';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let root: string; // simula ~/.claude
let projectsDir: string;
let tasksDir: string;
let plansDir: string;
let projectPath: string;

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cl-del-'));
  projectsDir = join(root, 'projects');
  tasksDir = join(root, 'tasks');
  plansDir = join(root, 'plans');
  projectPath = join(projectsDir, '-tmp-proj');

  mkdirSync(projectPath, { recursive: true });
  mkdirSync(plansDir, { recursive: true });

  // Piano globale condiviso da due sessioni.
  const planPath = join(plansDir, 'p1.md');
  writeFileSync(planPath, '# Plan one\n', 'utf-8');

  // Sessione 1: referenzia il piano + ha sidecar subagents + task.
  writeFileSync(
    join(projectPath, 'sess1.jsonl'),
    [
      line({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-01-01T00:00:00Z',
        message: { role: 'user', content: 'hi' },
      }),
      line({
        type: 'attachment',
        timestamp: '2026-01-01T00:01:00Z',
        attachment: { type: 'plan_mode_exit', planFilePath: planPath },
      }),
    ].join('\n'),
    'utf-8'
  );
  mkdirSync(join(projectPath, 'sess1', 'subagents'), { recursive: true });
  writeFileSync(
    join(projectPath, 'sess1', 'subagents', 'agent-aaa.jsonl'),
    line({ type: 'user', message: { role: 'user', content: 'x' } }),
    'utf-8'
  );
  mkdirSync(join(tasksDir, 'sess1'), { recursive: true });
  writeFileSync(
    join(tasksDir, 'sess1', '1.json'),
    JSON.stringify({ id: '1', subject: 't', status: 'pending' }),
    'utf-8'
  );

  // Sessione 2: referenzia lo stesso piano (refCount = 2).
  writeFileSync(
    join(projectPath, 'sess2.jsonl'),
    line({
      type: 'attachment',
      timestamp: '2026-01-02T00:00:00Z',
      attachment: { type: 'plan_mode', planFilePath: planPath },
    }),
    'utf-8'
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('getSessionArtifacts', () => {
  it('enumera transcript, subagents, tasks e piani con i conteggi corretti', async () => {
    const res = await getSessionArtifacts(projectPath, tasksDir, 'sess1.jsonl');
    expect(res.sessionId).toBe('sess1');

    const byKind = Object.fromEntries(res.artifacts.map(a => [a.kind, a]));

    expect(byKind.session.path).toBe(join(projectPath, 'sess1.jsonl'));
    expect(byKind.session.locked).toBe(true);
    expect(byKind.session.defaultSelected).toBe(true);

    expect(byKind.subagents.path).toBe(join(projectPath, 'sess1'));
    expect(byKind.subagents.isDir).toBe(true);
    expect(byKind.subagents.count).toBe(1);

    expect(byKind.tasks.path).toBe(join(tasksDir, 'sess1'));
    expect(byKind.tasks.count).toBe(1);

    expect(byKind.plan.path).toBe(join(plansDir, 'p1.md'));
    expect(byKind.plan.shared).toBe(true);
    expect(byKind.plan.referencedBy).toBe(2); // sess1 + sess2
    expect(byKind.plan.defaultSelected).toBe(false);
  });

  it('per una sessione senza artefatti restituisce solo il transcript', async () => {
    writeFileSync(
      join(projectPath, 'lonely.jsonl'),
      line({ type: 'user', message: { role: 'user', content: 'hi' } }),
      'utf-8'
    );
    const res = await getSessionArtifacts(projectPath, tasksDir, 'lonely.jsonl');
    expect(res.artifacts).toHaveLength(1);
    expect(res.artifacts[0].kind).toBe('session');
  });
});

describe('deleteSessionArtifacts', () => {
  it('cancella file e cartelle indicati, sotto la root', () => {
    const sessionFile = join(projectPath, 'sess1.jsonl');
    const sidecar = join(projectPath, 'sess1');
    const taskFolder = join(tasksDir, 'sess1');

    const res = deleteSessionArtifacts([sessionFile, sidecar, taskFolder], root);

    expect(res.warnings).toHaveLength(0);
    expect(res.deleted).toHaveLength(3);
    expect(existsSync(sessionFile)).toBe(false);
    expect(existsSync(sidecar)).toBe(false);
    expect(existsSync(taskFolder)).toBe(false);
    // Il piano NON è stato toccato (non incluso nei path).
    expect(existsSync(join(plansDir, 'p1.md'))).toBe(true);
  });

  it('rifiuta path fuori dalla root con un warning', () => {
    const outside = mkdtempSync(join(tmpdir(), 'cl-outside-'));
    const victim = join(outside, 'keepme.txt');
    writeFileSync(victim, 'data', 'utf-8');

    const res = deleteSessionArtifacts([victim], root);

    expect(res.deleted).toHaveLength(0);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/outside/);
    expect(existsSync(victim)).toBe(true);

    rmSync(outside, { recursive: true, force: true });
  });

  it('ignora silenziosamente path già inesistenti sotto la root', () => {
    const res = deleteSessionArtifacts([join(projectPath, 'ghost.jsonl')], root);
    expect(res.deleted).toHaveLength(0);
    expect(res.warnings).toHaveLength(0);
  });
});
