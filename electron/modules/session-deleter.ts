import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'fs';
import { basename, join, resolve, sep } from 'path';
import { glob } from 'glob';

import { findSessionFile } from './session-reader';
import { readPlanRefs } from './plans-reader';

// Una sessione di Claude Code è un semplice file `.jsonl` su disco, ma porta con
// sé alcuni artefatti collaterali (transcript dei sub-agenti, task, piani). Questo
// modulo enumera quegli artefatti per una data sessione (per mostrarli in un dialog
// di conferma) e li cancella in modo selettivo, validando che ogni path stia sotto
// la root di Claude (`~/.claude`) per impedire cancellazioni fuori scope.

export type ArtifactKind = 'session' | 'subagents' | 'tasks' | 'plan';

export interface SessionArtifact {
  kind: ArtifactKind;
  /** Etichetta leggibile mostrata nel dialog. */
  label: string;
  /** Path assoluto del file o cartella che verrebbe cancellato. */
  path: string;
  /** True se è una cartella (cancellazione ricorsiva). */
  isDir: boolean;
  /** Numero di file rilevanti contenuti (sub-agenti, task). */
  count?: number;
  /** La sessione stessa: sempre cancellata, non deselezionabile. */
  locked?: boolean;
  /** I piani sono file globali condivisi: segnalati come tali. */
  shared?: boolean;
  /** Per i piani: in quante sessioni del progetto è referenziato questo file. */
  referencedBy?: number;
  /** Stato iniziale della checkbox nel dialog. */
  defaultSelected: boolean;
}

export interface SessionArtifacts {
  sessionId: string;
  artifacts: SessionArtifact[];
}

export interface DeleteSessionResult {
  deleted: string[];
  warnings: string[];
}

// Conta i file `agent-*.jsonl` in una cartella subagents, se esiste.
function countSubagents(sidecarDir: string): number {
  const subagentsDir = join(sidecarDir, 'subagents');
  if (!existsSync(subagentsDir)) return 0;
  try {
    return readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

// La cartella "sidecar" di una sessione (con dentro `subagents/`) vive accanto al
// `.jsonl`, col nome del sessionId. Il `.jsonl` può stare nella root del progetto o
// sotto `sessions/`: proviamo entrambe le posizioni come fa `subagents-reader`.
function findSidecarDir(projectPath: string, sessionId: string): string | null {
  const candidates = [join(projectPath, sessionId), join(projectPath, 'sessions', sessionId)];
  return candidates.find(d => existsSync(d) && statSync(d).isDirectory()) ?? null;
}

// Per ogni piano referenziato dalla sessione, conta in quante sessioni del progetto
// compare lo stesso `planFilePath`. Serve ad avvisare l'utente che un piano è
// condiviso prima di cancellarlo (i piani vivono globali in ~/.claude/plans).
async function planReferenceCounts(projectPath: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const sessionFiles = await glob('**/*.jsonl', { cwd: projectPath, absolute: true });
  for (const file of sessionFiles) {
    const paths = new Set((await readPlanRefs(file)).map(r => r.filePath));
    for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return counts;
}

/**
 * Enumera tutti gli artefatti su disco collegati a una sessione, per popolare il
 * dialog di conferma. La sessione stessa è sempre presente e marcata `locked`.
 */
export async function getSessionArtifacts(
  projectPath: string,
  tasksDir: string,
  sessionFilename: string,
): Promise<SessionArtifacts> {
  const sessionId = basename(sessionFilename, '.jsonl');
  const artifacts: SessionArtifact[] = [];

  // 1. Transcript della sessione (sempre cancellato).
  const sessionFile = (await findSessionFile(projectPath, sessionFilename)) ?? join(projectPath, sessionFilename);
  artifacts.push({
    kind: 'session',
    label: 'Session transcript',
    path: sessionFile,
    isDir: false,
    locked: true,
    defaultSelected: true,
  });

  // 2. Cartella sidecar con i transcript dei sub-agenti.
  const sidecar = findSidecarDir(projectPath, sessionId);
  if (sidecar) {
    const count = countSubagents(sidecar);
    artifacts.push({
      kind: 'subagents',
      label: 'Sub-agent transcripts',
      path: sidecar,
      isDir: true,
      count,
      defaultSelected: true,
    });
  }

  // 3. Cartella dei task creati durante la sessione.
  const taskFolder = join(tasksDir, sessionId);
  if (existsSync(taskFolder) && statSync(taskFolder).isDirectory()) {
    let count = 0;
    try {
      count = readdirSync(taskFolder).filter(f => f.endsWith('.json')).length;
    } catch {
      // ignora: count resta 0
    }
    if (count > 0) {
      artifacts.push({
        kind: 'tasks',
        label: 'Tasks',
        path: taskFolder,
        isDir: true,
        count,
        defaultSelected: true,
      });
    }
  }

  // 4. Piani referenziati (file globali condivisi: default deselezionati).
  const planPaths = new Set((await readPlanRefs(sessionFile)).map(r => r.filePath));
  if (planPaths.size > 0) {
    const refCounts = await planReferenceCounts(projectPath);
    for (const planPath of planPaths) {
      if (!existsSync(planPath)) continue; // piano già cancellato altrove
      artifacts.push({
        kind: 'plan',
        label: basename(planPath, '.md'),
        path: planPath,
        isDir: false,
        shared: true,
        referencedBy: refCounts.get(planPath) ?? 1,
        defaultSelected: false,
      });
    }
  }

  return { sessionId, artifacts };
}

/**
 * Cancella i path indicati (file → unlink, cartelle → rm ricorsivo). Ogni path deve
 * risolvere sotto `rootDir` (~/.claude): quelli fuori scope sono scartati con un
 * warning. Best-effort per voce: un errore su un path non blocca gli altri.
 */
export function deleteSessionArtifacts(paths: string[], rootDir: string): DeleteSessionResult {
  const deleted: string[] = [];
  const warnings: string[] = [];
  const root = resolve(rootDir);

  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0) {
      warnings.push(`Invalid path: ${JSON.stringify(p)}`);
      continue;
    }
    const resolved = resolve(p);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      warnings.push(`Refusing to delete path outside ${root}: ${resolved}`);
      continue;
    }
    if (!existsSync(resolved)) {
      // Già assente: lo consideriamo un no-op silenzioso.
      continue;
    }
    try {
      if (statSync(resolved).isDirectory()) {
        rmSync(resolved, { recursive: true, force: true });
      } else {
        unlinkSync(resolved);
      }
      deleted.push(resolved);
    } catch (e) {
      warnings.push(`Failed to delete ${resolved}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { deleted, warnings };
}
