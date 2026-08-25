import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { executeMerge } from '../electron/modules/duplicate-merge-executor';
import { computeMergePlan } from '../electron/modules/duplicate-merger';
import { listProjectSessionFilesSync } from '../electron/modules/session-files';
import { invalidateCwdCache } from '../electron/utils';

// Integration test su temp dir per il modulo più rischioso del backend (#98):
// sposta sessioni, fonde memory/ e cancella cartelle. Ogni caso costruisce una
// coppia source/dest realistica sotto una finta ~/.claude/projects e verifica
// lo stato su disco dopo il merge (o dopo il rollback).

let root: string; // simula ~/.claude
let projectsDir: string;
let sourceDir: string;
let destDir: string;

const SOURCE_HASH = '-tmp-old';
const DEST_HASH = '-tmp-new';
const SOURCE_CWD = '/tmp/old';
const DEST_CWD = '/tmp/new';

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

function writeSession(dir: string, name: string, cwd: string): void {
  writeFileSync(
    join(dir, name),
    [
      line({ type: 'user', cwd, timestamp: '2026-01-01T00:00:00Z', message: { content: 'hi' } }),
      'not json {{{', // riga malformata: deve restare invariata
      line({ type: 'assistant', cwd: '/somewhere/else', message: { content: 'ok' } }),
    ].join('\n'),
    'utf-8'
  );
}

function writeTopic(memDir: string, name: string, description: string, body: string): void {
  const slug = name.replace(/\.md$/, '');
  writeFileSync(
    join(memDir, name),
    `---\nname: ${slug}\ndescription: ${description}\ntype: user\n---\n\n${body}\n`,
    'utf-8'
  );
}

beforeEach(() => {
  invalidateCwdCache(); // la cache dei cwd è module-level e i temp dir cambiano
  root = mkdtempSync(join(tmpdir(), 'cl-merge-'));
  projectsDir = join(root, 'projects');
  sourceDir = join(projectsDir, SOURCE_HASH);
  destDir = join(projectsDir, DEST_HASH);
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(destDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('executeMerge — happy path', () => {
  it('sposta sessioni con cwd rewrite, fonde memory e cancella la source', () => {
    writeSession(sourceDir, 'sess-a.jsonl', SOURCE_CWD);
    writeSession(sourceDir, 'sess-b.jsonl', SOURCE_CWD);
    writeSession(destDir, 'sess-dest.jsonl', DEST_CWD);

    // Sidecar della sessione (subagents/) da spostare insieme al .jsonl.
    mkdirSync(join(sourceDir, 'sess-a', 'subagents'), { recursive: true });
    writeFileSync(join(sourceDir, 'sess-a', 'subagents', 'agent-x.jsonl'), '{}', 'utf-8');

    // Memory: a.md solo nella source (copy), b.md identico (skip),
    // c.md in conflitto (conflict-rename → c_2.md).
    const srcMem = join(sourceDir, 'memory');
    const dstMem = join(destDir, 'memory');
    mkdirSync(srcMem, { recursive: true });
    mkdirSync(dstMem, { recursive: true });
    writeTopic(srcMem, 'a.md', 'Topic A', 'only in source');
    writeTopic(srcMem, 'b.md', 'Topic B', 'same everywhere');
    writeTopic(dstMem, 'b.md', 'Topic B', 'same everywhere');
    writeTopic(srcMem, 'c.md', 'Topic C source', 'source version');
    writeTopic(dstMem, 'c.md', 'Topic C dest', 'dest version');
    writeFileSync(
      join(srcMem, 'MEMORY.md'),
      '# Memory Index\n\n- [a.md](a.md) — Topic A\n- [b.md](b.md) — Topic B\n- [c.md](c.md) — Topic C source\n',
      'utf-8'
    );
    writeFileSync(
      join(dstMem, 'MEMORY.md'),
      '# Memory Index\n\n- [b.md](b.md) — Topic B\n- [c.md](c.md) — Topic C dest\n',
      'utf-8'
    );

    const res = executeMerge(projectsDir, SOURCE_HASH, DEST_HASH);

    expect(res.movedSessions).toBe(2);
    expect(res.renamedSessions).toBe(0);
    expect(res.cwdRewrittenFiles).toBe(2);
    expect(res.movedSidecars).toBe(1);
    expect(res.memoryCopied).toBe(1);
    expect(res.memorySkipped).toBe(1);
    expect(res.memoryRenamed).toBe(1);
    expect(res.sourceDeleted).toBe(true);

    // Source cancellata, backup completo disponibile fuori da projects/.
    expect(existsSync(sourceDir)).toBe(false);
    expect(res.backupPath.startsWith(join(root, '.claudelens-backups'))).toBe(true);
    expect(existsSync(join(res.backupPath, 'sess-a.jsonl'))).toBe(true);
    expect(existsSync(join(res.backupPath, 'memory', 'c.md'))).toBe(true);

    // Sessioni nella dest, con il solo cwd della source riscritto: la riga
    // malformata e i cwd diversi restano invariati.
    const moved = readFileSync(join(destDir, 'sess-a.jsonl'), 'utf-8').split('\n');
    expect(JSON.parse(moved[0]).cwd).toBe(DEST_CWD);
    expect(moved[1]).toBe('not json {{{');
    expect(JSON.parse(moved[2]).cwd).toBe('/somewhere/else');
    expect(existsSync(join(destDir, 'sess-b.jsonl'))).toBe(true);
    expect(existsSync(join(destDir, 'sess-a', 'subagents', 'agent-x.jsonl'))).toBe(true);

    // Memory fusa: a.md copiato, c.md tenuto come c_2.md con name: riscritto,
    // la versione dest di c.md intatta, indice aggiornato con le nuove righe.
    expect(readFileSync(join(dstMem, 'a.md'), 'utf-8')).toContain('only in source');
    expect(readFileSync(join(dstMem, 'c.md'), 'utf-8')).toContain('dest version');
    const renamed = readFileSync(join(dstMem, 'c_2.md'), 'utf-8');
    expect(renamed).toContain('name: c_2');
    expect(renamed).toContain('source version');
    const index = readFileSync(join(dstMem, 'MEMORY.md'), 'utf-8');
    expect(index).toContain('- [a.md](a.md) — Topic A');
    expect(index).toContain('- [c_2.md](c_2.md) — Topic C source');
    expect(index).toContain('- [c.md](c.md) — Topic C dest');
  });
});

describe('executeMerge — collisioni', () => {
  it('rinomina le sessioni che collidono senza toccare il file della dest', () => {
    writeSession(sourceDir, 'same.jsonl', SOURCE_CWD);
    writeSession(destDir, 'same.jsonl', DEST_CWD);
    const destOriginal = readFileSync(join(destDir, 'same.jsonl'), 'utf-8');

    const res = executeMerge(projectsDir, SOURCE_HASH, DEST_HASH);

    expect(res.movedSessions).toBe(1);
    expect(res.renamedSessions).toBe(1);
    expect(readFileSync(join(destDir, 'same.jsonl'), 'utf-8')).toBe(destOriginal);
    const renamed = readFileSync(join(destDir, 'same_2.jsonl'), 'utf-8');
    expect(JSON.parse(renamed.split('\n')[0]).cwd).toBe(DEST_CWD);
  });

  it('salta i sidecar che collidono e allora conserva la source con warning', () => {
    writeSession(sourceDir, 'sess-a.jsonl', SOURCE_CWD);
    writeSession(destDir, 'sess-dest.jsonl', DEST_CWD);
    mkdirSync(join(sourceDir, 'shared', 'subagents'), { recursive: true });
    writeFileSync(join(sourceDir, 'shared', 'subagents', 'src.jsonl'), 'src', 'utf-8');
    mkdirSync(join(destDir, 'shared'), { recursive: true });
    writeFileSync(join(destDir, 'shared', 'keep.txt'), 'dest', 'utf-8');

    const res = executeMerge(projectsDir, SOURCE_HASH, DEST_HASH);

    expect(res.movedSidecars).toBe(0);
    expect(res.sourceDeleted).toBe(false);
    expect(res.warnings.some(w => w.includes('left in place'))).toBe(true);
    expect(res.warnings.some(w => w.includes('Source folder kept'))).toBe(true);
    // La dir della dest non è stata sovrascritta, la source conserva la sua.
    expect(readFileSync(join(destDir, 'shared', 'keep.txt'), 'utf-8')).toBe('dest');
    expect(existsSync(join(sourceDir, 'shared', 'subagents', 'src.jsonl'))).toBe(true);
  });

  it('conserva la source (sourceDeleted=false) se restano file estranei', () => {
    writeSession(sourceDir, 'sess-a.jsonl', SOURCE_CWD);
    writeSession(destDir, 'sess-dest.jsonl', DEST_CWD);
    writeFileSync(join(sourceDir, 'notes.txt'), 'leftover', 'utf-8');

    const res = executeMerge(projectsDir, SOURCE_HASH, DEST_HASH);

    expect(res.movedSessions).toBe(1);
    expect(res.sourceDeleted).toBe(false);
    expect(readFileSync(join(sourceDir, 'notes.txt'), 'utf-8')).toBe('leftover');
    expect(res.warnings.some(w => w.includes('notes.txt'))).toBe(true);
  });
});

describe('executeMerge — i due layout nativi', () => {
  // Claude Code tiene i transcript di un progetto nella radice della sua cartella
  // o in una `sessions/` annidata, e i due progetti di un merge possono usare
  // layout diversi. Il piano leggeva la sola radice, quindi per una source
  // annidata non vedeva NIENTE da spostare e prendeva la sua `sessions/` per la
  // cartella sidecar di una sessione: la spostava intera dentro la dest, che si
  // ritrovava con una `sessions/` non vuota accanto ai propri `.jsonl` — e
  // `listProjectSessionFiles`, che in quel caso legge solo la annidata, smetteva
  // di vedere le sessioni della dest. Merge riuscito, cronologia della
  // destinazione invisibile.

  it('porta i transcript di una source annidata nel layout della dest', () => {
    const srcSessions = join(sourceDir, 'sessions');
    mkdirSync(srcSessions, { recursive: true });
    writeSession(srcSessions, 'sess-a.jsonl', SOURCE_CWD);
    writeSession(destDir, 'sess-dest.jsonl', DEST_CWD);

    const res = executeMerge(projectsDir, SOURCE_HASH, DEST_HASH);

    expect(res.movedSessions).toBe(1);
    expect(res.cwdRewrittenFiles).toBe(1);
    expect(res.movedSidecars).toBe(0); // `sessions/` non è un sidecar
    expect(
      JSON.parse(readFileSync(join(destDir, 'sess-a.jsonl'), 'utf-8').split('\n')[0]).cwd
    ).toBe(DEST_CWD);
    // La dest resta su UN layout: senza questo le sue sessioni sparirebbero
    // dall'app pur restando su disco.
    expect(existsSync(join(destDir, 'sessions'))).toBe(false);
    expect(
      listProjectSessionFilesSync(destDir)
        .map(f => basename(f))
        .sort()
    ).toEqual(['sess-a.jsonl', 'sess-dest.jsonl']);
    expect(res.sourceDeleted).toBe(true);
  });

  it('porta il sidecar di una sessione accanto al suo transcript', () => {
    const srcSessions = join(sourceDir, 'sessions');
    mkdirSync(join(srcSessions, 'sess-a', 'subagents'), { recursive: true });
    writeSession(srcSessions, 'sess-a.jsonl', SOURCE_CWD);
    writeFileSync(join(srcSessions, 'sess-a', 'subagents', 'agent-x.jsonl'), '{}', 'utf-8');
    writeSession(destDir, 'sess-dest.jsonl', DEST_CWD);

    const res = executeMerge(projectsDir, SOURCE_HASH, DEST_HASH);

    expect(res.movedSidecars).toBe(1);
    // Accanto al `.jsonl`, cioè nel layout della dest — non dove stava nella source.
    expect(existsSync(join(destDir, 'sess-a', 'subagents', 'agent-x.jsonl'))).toBe(true);
  });

  it('consegna dentro sessions/ quando è la dest a usare quel layout', () => {
    writeSession(sourceDir, 'sess-a.jsonl', SOURCE_CWD);
    const dstSessions = join(destDir, 'sessions');
    mkdirSync(dstSessions, { recursive: true });
    writeSession(dstSessions, 'sess-dest.jsonl', DEST_CWD);

    const res = executeMerge(projectsDir, SOURCE_HASH, DEST_HASH);

    expect(res.movedSessions).toBe(1);
    expect(existsSync(join(dstSessions, 'sess-a.jsonl'))).toBe(true);
    expect(existsSync(join(destDir, 'sess-a.jsonl'))).toBe(false);
    expect(
      listProjectSessionFilesSync(destDir)
        .map(f => basename(f))
        .sort()
    ).toEqual(['sess-a.jsonl', 'sess-dest.jsonl']);
  });

  it('non cancella una source che ha transcript fuori dal layout in uso', () => {
    // Un progetto a metà migrazione: la `sessions/` decide il layout, quindi il
    // `.jsonl` rimasto nella radice NON viene spostato — e dichiararlo consumato
    // cancellerebbe la source con quel file dentro.
    const srcSessions = join(sourceDir, 'sessions');
    mkdirSync(srcSessions, { recursive: true });
    writeSession(srcSessions, 'sess-a.jsonl', SOURCE_CWD);
    writeSession(sourceDir, 'stray.jsonl', SOURCE_CWD);
    writeSession(destDir, 'sess-dest.jsonl', DEST_CWD);

    const res = executeMerge(projectsDir, SOURCE_HASH, DEST_HASH);

    expect(res.movedSessions).toBe(1);
    expect(res.sourceDeleted).toBe(false);
    expect(existsSync(join(sourceDir, 'stray.jsonl'))).toBe(true);
    expect(res.warnings.some(w => w.includes('stray.jsonl'))).toBe(true);
    // La `sessions/` svuotata invece se ne va: è layout, non contenuto.
    expect(existsSync(srcSessions)).toBe(false);
  });

  it('non blocca il merge verso una dest che tiene le sessioni in sessions/', () => {
    // Il blocker diceva che il cwd della dest non è ricavabile perché non ha
    // sessioni, con le sue sessioni in `sessions/`.
    writeSession(sourceDir, 'sess-a.jsonl', SOURCE_CWD);
    const dstSessions = join(destDir, 'sessions');
    mkdirSync(dstSessions, { recursive: true });
    writeSession(dstSessions, 'sess-dest.jsonl', DEST_CWD);

    expect(computeMergePlan(projectsDir, SOURCE_HASH, DEST_HASH).blockers).toEqual([]);
  });

  it('non elenca sessions/ tra i sidecar da spostare', () => {
    const srcSessions = join(sourceDir, 'sessions');
    mkdirSync(srcSessions, { recursive: true });
    writeSession(srcSessions, 'sess-a.jsonl', SOURCE_CWD);
    writeSession(destDir, 'sess-dest.jsonl', DEST_CWD);

    const plan = computeMergePlan(projectsDir, SOURCE_HASH, DEST_HASH);

    expect(plan.layout).toEqual({ from: 'sessions', to: '' });
    expect(plan.sidecars.map(sc => sc.name)).not.toContain('sessions');
    expect(plan.sessions.map(sm => sm.filename)).toEqual(['sess-a.jsonl']);
    expect(plan.cwdRewrite).toEqual({ from: SOURCE_CWD, to: DEST_CWD });
  });
});

describe('executeMerge — blockers', () => {
  it('rifiuta il merge se la dest non ha sessioni (cwd non ricavabile), senza toccare nulla', () => {
    writeSession(sourceDir, 'sess-a.jsonl', SOURCE_CWD);

    expect(() => executeMerge(projectsDir, SOURCE_HASH, DEST_HASH)).toThrow(/Merge blocked/);

    // Nessun backup creato, source intatta, dest vuota.
    expect(existsSync(join(root, '.claudelens-backups'))).toBe(false);
    expect(existsSync(join(sourceDir, 'sess-a.jsonl'))).toBe(true);
    expect(readdirSync(destDir)).toEqual([]);
  });

  it('rifiuta source === dest', () => {
    writeSession(sourceDir, 'sess-a.jsonl', SOURCE_CWD);
    expect(() => executeMerge(projectsDir, SOURCE_HASH, SOURCE_HASH)).toThrow(/Merge blocked/);
  });

  it('rifiuta se la source non esiste più', () => {
    writeSession(destDir, 'sess-dest.jsonl', DEST_CWD);
    expect(() => executeMerge(projectsDir, '-tmp-ghost', DEST_HASH)).toThrow(/Merge blocked/);
  });
});

describe('executeMerge — rollback', () => {
  it('su errore a metà merge ripristina source e dest dallo stato pre-merge', () => {
    writeSession(sourceDir, 'sess-a.jsonl', SOURCE_CWD);
    writeSession(destDir, 'sess-dest.jsonl', DEST_CWD);
    const destSessionOriginal = readFileSync(join(destDir, 'sess-dest.jsonl'), 'utf-8');

    const srcMem = join(sourceDir, 'memory');
    const dstMem = join(destDir, 'memory');
    mkdirSync(srcMem, { recursive: true });
    mkdirSync(dstMem, { recursive: true });
    writeTopic(srcMem, 'a.md', 'Topic A', 'only in source');
    const destIndexOriginal = '# Memory Index\n\n- [z.md](z.md) — Topic Z\n';
    writeFileSync(join(dstMem, 'MEMORY.md'), destIndexOriginal, 'utf-8');

    // Sabotaggio: una directory chiamata *.md passa il piano come 'copy' ma fa
    // esplodere copyFileSync (EISDIR) a sessioni già spostate → rollback.
    mkdirSync(join(srcMem, 'boom.md'));

    expect(() => executeMerge(projectsDir, SOURCE_HASH, DEST_HASH)).toThrow(/rolled back/);

    // Source ricostruita dal backup: la sessione spostata è tornata al suo posto.
    expect(existsSync(join(sourceDir, 'sess-a.jsonl'))).toBe(true);
    expect(readFileSync(join(srcMem, 'a.md'), 'utf-8')).toContain('only in source');

    // Dest ripulita da tutto ciò che il merge aveva creato, file suoi intatti.
    expect(existsSync(join(destDir, 'sess-a.jsonl'))).toBe(false);
    expect(existsSync(join(dstMem, 'a.md'))).toBe(false);
    expect(readFileSync(join(destDir, 'sess-dest.jsonl'), 'utf-8')).toBe(destSessionOriginal);
    expect(readFileSync(join(dstMem, 'MEMORY.md'), 'utf-8')).toBe(destIndexOriginal);
  });
});
