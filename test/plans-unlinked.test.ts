import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// PLANS_DIR è una costante di modulo derivata da CLAUDE_DIR: va puntata su una
// tmpdir PRIMA di importare il reader (stesso schema di test/studio-io.test.ts).
// Sta in un file separato da plans-reader.test.ts di proposito: quel file deve
// restare senza CLAUDE_CONFIG_DIR, o le sue asserzioni sulla cache cambierebbero.
const configDir = mkdtempSync(join(homedir(), '.cl-plans-test-'));
process.env.CLAUDE_CONFIG_DIR = configDir;

const reader = await import('../electron/modules/plans-reader');
const { getUnlinkedPlans, getPlanRefStats, resetPlanRefCache } = reader;

const plansDir = join(configDir, 'plans');
const projectsDir = join(configDir, 'projects');

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(configDir, { recursive: true, force: true });
});

beforeEach(() => {
  mkdirSync(plansDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });
  resetPlanRefCache();
});

afterEach(() => {
  rmSync(plansDir, { recursive: true, force: true });
  rmSync(projectsDir, { recursive: true, force: true });
});

/** Scrive un piano markdown e ne restituisce il path assoluto. */
function plan(name: string, body: string): string {
  const path = join(plansDir, name);
  writeFileSync(path, body, 'utf-8');
  return path;
}

/** Una sessione con le righe date, dentro `projects/<hash>/` (o una sottodir). */
function session(hash: string, id: string, lines: string[], sub?: string): string {
  const dir = sub ? join(projectsDir, hash, sub) : join(projectsDir, hash);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
  return path;
}

function planAttachment(planPath: string, timestamp = '2026-01-01T00:00:00Z'): string {
  return JSON.stringify({
    type: 'attachment',
    timestamp,
    attachment: { type: 'plan_mode', planFilePath: planPath },
  });
}

describe('getUnlinkedPlans', () => {
  it('restituisce un .md che nessun attachment referenzia, con titolo dall H1', async () => {
    const orphan = plan('canvas-view.md', '# Agent Studio canvas\n\nBody.\n');
    session('-Users-foo-bar', 'sess', [JSON.stringify({ type: 'user', message: 'hi' })]);

    const plans = await getUnlinkedPlans(projectsDir);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      filePath: orphan,
      slug: 'canvas-view',
      title: 'Agent Studio canvas',
      status: 'unlinked',
      exists: true,
    });
    expect(plans[0].content).toContain('Body.');
    // Nessun attachment da cui leggere l'ora: resta l'mtime del file.
    expect(plans[0].timestamp).toBe(statSync(orphan).mtime.toISOString());
    // Un orfano non ha branch: nessun attachment che lo porti.
    expect(plans[0].gitBranch).toBeUndefined();
  });

  it('esclude un piano referenziato da un progetto DIVERSO da quello aperto', async () => {
    // È il punto dell'intera scansione globale: la cartella dei piani è unica,
    // quindi "non collegato" va deciso sull'installazione, non su un progetto.
    const shared = plan('from-other-project.md', '# Elsewhere\n');
    plan('nobody.md', '# Nobody\n');
    session('-Users-foo-alpha', 'a', [JSON.stringify({ type: 'user', message: 'hi' })]);
    session('-Users-foo-beta', 'b', [planAttachment(shared)]);

    const plans = await getUnlinkedPlans(projectsDir);

    expect(plans.map(p => p.slug)).toEqual(['nobody']);
  });

  it('restituisce un piano citato solo in prosa o in una Bash, mai in un attachment', async () => {
    // Il repro dell'issue #154: il file compare nei transcript, ma zero volte
    // dentro un attachment plan_mode/plan_mode_exit.
    const mentioned = plan('agent-studio-canvas-view.md', '# Canvas\n');
    session('-Users-foo-bar', 'sess', [
      JSON.stringify({ type: 'user', message: `look at ${mentioned}` }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: `cat ${mentioned}` } }],
        },
      }),
    ]);

    const plans = await getUnlinkedPlans(projectsDir);

    expect(plans.map(p => p.slug)).toEqual(['agent-studio-canvas-view']);
  });

  it('onora i ref di un progetto in layout `sessions/`', async () => {
    // Claude Code usa due location per i transcript; leggerne una sola farebbe
    // passare per orfani TUTTI i piani di un progetto nell'altra.
    const referenced = plan('nested.md', '# Nested\n');
    session('-Users-foo-bar', 'sess', [planAttachment(referenced)], 'sessions');

    expect(await getUnlinkedPlans(projectsDir)).toEqual([]);
  });

  it('ripiega sullo slug umanizzato quando manca un H1, e ignora i non-.md', async () => {
    plan('my-nice-plan.md', 'Nessun heading qui.\n');
    plan('notes.txt', '# Non è un piano\n');

    const plans = await getUnlinkedPlans(projectsDir);

    expect(plans.map(p => ({ slug: p.slug, title: p.title }))).toEqual([
      { slug: 'my-nice-plan', title: 'my nice plan' },
    ]);
  });

  it('ordina dal più recente al più vecchio per mtime', async () => {
    plan('older.md', '# Older\n');
    // Scritture nello stesso millisecondo avrebbero lo stesso mtime.
    await new Promise(r => setTimeout(r, 12));
    plan('newer.md', '# Newer\n');

    const plans = await getUnlinkedPlans(projectsDir);

    expect(plans.map(p => p.slug)).toEqual(['newer', 'older']);
  });

  it('non tocca un solo transcript quando la cartella dei piani è vuota', async () => {
    session('-Users-foo-bar', 'sess', [planAttachment('/whatever.md')]);

    expect(await getUnlinkedPlans(projectsDir)).toEqual([]);
    // Nessun candidato = nessun motivo di leggere: è il caso di chi non ha mai
    // usato il plan mode, e paga zero.
    expect(getPlanRefStats()).toMatchObject({ fullParses: 0, fileReads: 0 });
  });

  it('non solleva quando la cartella dei piani non esiste', async () => {
    rmSync(plansDir, { recursive: true, force: true });

    expect(await getUnlinkedPlans(projectsDir)).toEqual([]);
  });
});
