import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// PLANS_DIR è una costante di modulo derivata da CLAUDE_DIR: va puntata sulla
// root finta PRIMA di importare i moduli (stesso schema di
// test/plans-unlinked.test.ts), altrimenti il confinamento a ~/.claude/plans
// rifiuterebbe il piano di questo stesso fixture.
const root = mkdtempSync(join(tmpdir(), 'cl-del-')); // simula ~/.claude
process.env.CLAUDE_CONFIG_DIR = root;

const deleter = await import('../electron/modules/session-deleter');
const { getSessionArtifacts, deleteSessionArtifacts } = deleter;
const { getPlanRefStats, resetPlanRefCache } = await import('../electron/modules/plans-reader');

const projectsDir = join(root, 'projects');
const tasksDir = join(root, 'tasks');
const plansDir = join(root, 'plans');
const projectPath = join(projectsDir, '-tmp-proj');

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(root, { recursive: true, force: true });
});

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

/** Una riga attachment che referenzia `planPath`. */
function planAttachment(
  type: 'plan_mode' | 'plan_mode_exit',
  planPath: string,
  at: string
): string {
  return line({ type: 'attachment', timestamp: at, attachment: { type, planFilePath: planPath } });
}

beforeEach(() => {
  // La root è condivisa (la costante di modulo la legge una volta sola), quindi
  // sono i suoi contenuti a essere ricostruiti a ogni test: ogni `it` resta
  // un'affermazione indipendente anche con l'ordine randomizzato.
  for (const dir of [projectsDir, tasksDir, plansDir])
    rmSync(dir, { recursive: true, force: true });
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(plansDir, { recursive: true });
  resetPlanRefCache();

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
      planAttachment('plan_mode_exit', planPath, '2026-01-01T00:01:00Z'),
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
    planAttachment('plan_mode', planPath, '2026-01-02T00:00:00Z'),
    'utf-8'
  );
});

afterEach(() => {
  for (const dir of [projectsDir, tasksDir, plansDir])
    rmSync(dir, { recursive: true, force: true });
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

  // `planFilePath` arriva verbatim dal transcript: `plans-reader` si rifiuta già
  // di leggerlo fuori da ~/.claude/plans, e offrirlo per la CANCELLAZIONE è
  // peggio che leggerlo — la sola guardia a valle è la root ~/.claude, che
  // lascia passare tutto ciò che ci vive dentro.
  it('non offre come piano un path fuori da ~/.claude/plans', async () => {
    const settings = join(root, 'settings.json');
    writeFileSync(settings, '{}', 'utf-8');
    const outside = join(tmpdir(), 'cl-not-a-plan.md');
    writeFileSync(outside, '# nope\n', 'utf-8');

    writeFileSync(
      join(projectPath, 'poisoned.jsonl'),
      [
        planAttachment('plan_mode', settings, '2026-01-03T00:00:00Z'),
        planAttachment('plan_mode', outside, '2026-01-03T00:01:00Z'),
      ].join('\n'),
      'utf-8'
    );

    try {
      const res = await getSessionArtifacts(projectPath, tasksDir, 'poisoned.jsonl');

      expect(res.artifacts.filter(a => a.kind === 'plan')).toHaveLength(0);
      expect(res.artifacts.map(a => a.path)).not.toContain(settings);
      expect(res.artifacts.map(a => a.path)).not.toContain(outside);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  // `isDir: false` era un'assunzione: `deleteSessionArtifacts` ri-statta il path
  // e su una directory usa `rmSync` ricorsivo. Una casella sola avrebbe
  // cancellato un albero.
  it('non offre come piano una directory, nemmeno dentro la plans dir', async () => {
    const dirPlan = join(plansDir, 'not-a-file.md');
    mkdirSync(dirPlan, { recursive: true });
    writeFileSync(join(dirPlan, 'inside.txt'), 'data', 'utf-8');

    writeFileSync(
      join(projectPath, 'dirplan.jsonl'),
      planAttachment('plan_mode', dirPlan, '2026-01-04T00:00:00Z'),
      'utf-8'
    );

    const res = await getSessionArtifacts(projectPath, tasksDir, 'dirplan.jsonl');

    expect(res.artifacts.filter(a => a.kind === 'plan')).toHaveLength(0);
    expect(res.artifacts.some(a => a.path === dirPlan)).toBe(false);
    expect(existsSync(join(dirPlan, 'inside.txt'))).toBe(true);
  });

  // Il dialog stampa "referenced by N sessions": l'unità è la sessione, non il
  // file. Una glob ricorsiva pescava anche le sidecar dei sub-agenti, che sono
  // dentro la sessione che le ha generate — contarle è contarla due volte.
  it('conta le sessioni, non le sidecar dei sub-agenti', async () => {
    const planPath = join(plansDir, 'p1.md');
    // La sidecar porta lo stesso attachment del padre.
    writeFileSync(
      join(projectPath, 'sess1', 'subagents', 'agent-aaa.jsonl'),
      [
        line({ type: 'user', message: { role: 'user', content: 'x' } }),
        planAttachment('plan_mode', planPath, '2026-01-01T00:02:00Z'),
      ].join('\n'),
      'utf-8'
    );

    const res = await getSessionArtifacts(projectPath, tasksDir, 'sess1.jsonl');
    const plan = res.artifacts.find(a => a.kind === 'plan');

    expect(plan?.referencedBy).toBe(2); // sess1 + sess2, non la sidecar
  });

  // La potatura della cache di `readPlanRefs` è agganciata all'enumerazione
  // condivisa: una entry piantata sotto `subagents/` non verrebbe ripassata da
  // nessuna scansione e sopravvivrebbe per tutta la vita del processo.
  it('non lascia in cache le sidecar dei sub-agenti', async () => {
    await getSessionArtifacts(projectPath, tasksDir, 'sess1.jsonl');

    // I due transcript di sessione del progetto, e nient'altro.
    expect(getPlanRefStats().cachedFiles).toBe(2);
  });
});

describe('deleteSessionArtifacts', () => {
  // Il transcript è la voce `required`: la sua sopravvivenza rende falsa l'intera
  // operazione, ed è ciò che `succeeded` esiste per dire.
  const req = (path: string) => ({ path, required: true });
  const opt = (path: string) => ({ path });

  it('cancella file e cartelle indicati, sotto la root', () => {
    const sessionFile = join(projectPath, 'sess1.jsonl');
    const sidecar = join(projectPath, 'sess1');
    const taskFolder = join(tasksDir, 'sess1');

    const res = deleteSessionArtifacts([req(sessionFile), opt(sidecar), opt(taskFolder)], root);

    expect(res.succeeded).toBe(true);
    expect(res.warnings).toHaveLength(0);
    expect(res.deleted).toHaveLength(3);
    expect(res.outcomes.map(o => o.status)).toEqual(['deleted', 'deleted', 'deleted']);
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

    const res = deleteSessionArtifacts([opt(victim)], root);

    expect(res.deleted).toHaveLength(0);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/outside/);
    expect(res.outcomes[0].status).toBe('refused');
    expect(existsSync(victim)).toBe(true);

    rmSync(outside, { recursive: true, force: true });
  });

  it('ignora silenziosamente path già inesistenti sotto la root', () => {
    const res = deleteSessionArtifacts([opt(join(projectPath, 'ghost.jsonl'))], root);
    expect(res.deleted).toHaveLength(0);
    expect(res.warnings).toHaveLength(0);
    expect(res.outcomes[0].status).toBe('absent');
  });

  // Un transcript già assente soddisfa la richiesta: lo stato finale voluto è
  // "non esiste", e ci siamo. Ma resta `absent`, non `deleted` — non l'abbiamo
  // cancellato noi, e il report lo dice con parole diverse.
  it('considera riuscita una sessione il cui transcript era già sparito', () => {
    const res = deleteSessionArtifacts([req(join(projectPath, 'ghost.jsonl'))], root);

    expect(res.succeeded).toBe(true);
    expect(res.outcomes[0]).toMatchObject({ status: 'absent', required: true });
    expect(res.deleted).toHaveLength(0);
  });

  // Il caso della issue: il transcript non si cancella. Prima tornava un
  // risultato indistinguibile dal successo e la UI navigava via.
  it('non si dichiara riuscita se il transcript required resta su disco', () => {
    const sessionFile = join(projectPath, 'sess1.jsonl');
    const taskFolder = join(tasksDir, 'sess1');
    // Directory in sola lettura: l'unlink del figlio fallisce, la cartella no.
    chmodSync(projectPath, 0o500);
    try {
      const res = deleteSessionArtifacts([req(sessionFile), opt(taskFolder)], root);

      expect(res.succeeded).toBe(false);
      const session = res.outcomes.find(o => o.path === sessionFile);
      expect(session?.status).toBe('failed');
      expect(session?.reason).toBeTruthy();
      expect(res.warnings.some(w => w.includes(sessionFile))).toBe(true);
      expect(existsSync(sessionFile)).toBe(true);
      // Best-effort per voce: il fallimento del transcript non blocca il resto.
      expect(existsSync(taskFolder)).toBe(false);
      expect(res.deleted).toEqual([taskFolder]);
    } finally {
      chmodSync(projectPath, 0o700);
    }
  });

  // L'altra metà: la sessione è andata, un artefatto opzionale no. Successo —
  // ma con qualcosa da dire, che è il motivo per cui `warnings` sopravvive.
  it('resta riuscita se fallisce solo un artefatto opzionale, ma lo segnala', () => {
    const sessionFile = join(projectPath, 'sess1.jsonl');
    const plan = join(plansDir, 'p1.md');
    chmodSync(plansDir, 0o500);
    try {
      const res = deleteSessionArtifacts([req(sessionFile), opt(plan)], root);

      expect(res.succeeded).toBe(true);
      expect(res.warnings).toHaveLength(1);
      expect(res.warnings[0]).toContain(plan);
      expect(res.outcomes.find(o => o.path === plan)?.status).toBe('failed');
      expect(existsSync(sessionFile)).toBe(false);
      expect(existsSync(plan)).toBe(true);
    } finally {
      chmodSync(plansDir, 0o700);
    }
  });

  it('un required rifiutato perché fuori root non passa per riuscito', () => {
    const outside = mkdtempSync(join(tmpdir(), 'cl-outside-'));
    try {
      const res = deleteSessionArtifacts([req(join(outside, 'x.jsonl'))], root);
      expect(res.succeeded).toBe(false);
      expect(res.outcomes[0].status).toBe('refused');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rifiuta una voce senza path valido invece di ignorarla', () => {
    const res = deleteSessionArtifacts(
      [{ path: '', required: true } as { path: string; required: boolean }],
      root
    );
    expect(res.succeeded).toBe(false);
    expect(res.outcomes[0].status).toBe('refused');
  });
});
