import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { resolveRealPath, isAbsolutePath } from '../utils';

/** Spostamento di un file di sessione dalla source alla dest. */
export interface SessionMove {
  filename: string;
  /** true se nella dest esiste già un file con lo stesso nome (rename difensivo necessario). */
  collides: boolean;
  /** nome di destinazione effettivo (diverso da filename solo se collides). */
  targetName: string;
}

export type MemoryActionKind =
  | 'copy' // nessun file con lo stesso nome nella dest → copia diretta
  | 'identical' // file con lo stesso nome e contenuto identico → skip
  | 'conflict-rename'; // stesso nome, contenuto diverso → copia rinominata

export interface MemoryAction {
  filename: string;
  kind: MemoryActionKind;
  /** nome di destinazione quando kind === 'conflict-rename'. */
  targetName?: string;
}

/** Directory sidecar di sessione (UUID/) che contiene tool-results/, subagents/, ecc. */
export interface SidecarMove {
  name: string;
  /** true se una directory con lo stesso nome esiste già nella dest (verrà saltata). */
  collides: boolean;
}

export interface MergePlan {
  source: { hash: string; realPath: string; authoritative: boolean };
  dest: { hash: string; realPath: string; authoritative: boolean };
  /** Riscrittura cwd da applicare ai .jsonl spostati; null se non necessaria/possibile. */
  cwdRewrite: { from: string; to: string } | null;
  sessions: SessionMove[];
  /** Directory sidecar per-sessione da spostare insieme ai .jsonl. */
  sidecars: SidecarMove[];
  memory: MemoryAction[];
  /** true se MEMORY.md va rigenerato (la source ha topic o un indice da fondere). */
  regenerateIndex: boolean;
  /** true se la cartella source resterà priva di contenuti dopo il merge. */
  sourceEmptyAfter: boolean;
  /** Condizioni che impediscono il merge sicuro: vanno risolte prima di procedere. */
  blockers: string[];
  /** Avvisi non bloccanti. */
  warnings: string[];
}

function listFiles(dir: string, predicate: (name: string) => boolean): string[] {
  try {
    return readdirSync(dir).filter(predicate);
  } catch {
    return [];
  }
}

function listSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter(name => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function readCwdSet(filePath: string): Set<string> {
  const out = new Set<string>();
  try {
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      if (!line || line.indexOf('"cwd"') === -1) continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.cwd === 'string' && isAbsolutePath(obj.cwd)) out.add(obj.cwd);
      } catch {
        // riga malformata
      }
    }
  } catch {
    // file illeggibile
  }
  return out;
}

function uniqueRenameTarget(baseName: string, taken: Set<string>): string {
  // baseName es. "feedback_x.md" → prova "feedback_x_2.md", "_3", ...
  const dot = baseName.lastIndexOf('.');
  const stem = dot === -1 ? baseName : baseName.slice(0, dot);
  const ext = dot === -1 ? '' : baseName.slice(dot);
  let i = 2;
  let candidate = `${stem}_${i}${ext}`;
  while (taken.has(candidate)) {
    i += 1;
    candidate = `${stem}_${i}${ext}`;
  }
  return candidate;
}

/**
 * Calcola — in sola lettura — cosa comporterebbe fondere la cartella `sourceHash`
 * dentro `destHash`. Non scrive nulla: produce il piano che alimenta il dialog di
 * conferma e, successivamente, l'esecuzione.
 */
export function computeMergePlan(
  projectsDir: string,
  sourceHash: string,
  destHash: string
): MergePlan {
  const sourceDir = join(projectsDir, sourceHash);
  const destDir = join(projectsDir, destHash);

  const sourceSessions = listFiles(sourceDir, f => f.endsWith('.jsonl'));
  const destSessions = listFiles(destDir, f => f.endsWith('.jsonl'));

  const sourceReal = resolveRealPath(projectsDir, sourceHash);
  const destReal = resolveRealPath(projectsDir, destHash);
  const sourceAuthoritative = sourceSessions.length > 0;
  const destAuthoritative = destSessions.length > 0;

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (sourceHash === destHash) {
    blockers.push('Source and destination are the same folder.');
  }
  if (!existsSync(sourceDir)) {
    blockers.push('Source folder no longer exists.');
  }
  if (!existsSync(destDir)) {
    blockers.push('Destination folder no longer exists.');
  }

  // ── Sessioni ───────────────────────────────────────────────────────────────
  const destSessionSet = new Set(destSessions);
  const sessions: SessionMove[] = sourceSessions.map(filename => {
    const collides = destSessionSet.has(filename);
    return {
      filename,
      collides,
      targetName: collides ? uniqueRenameTarget(filename, destSessionSet) : filename,
    };
  });

  // ── Riscrittura cwd ──────────────────────────────────────────────────────────
  let cwdRewrite: { from: string; to: string } | null = null;
  if (sourceSessions.length > 0) {
    if (!destAuthoritative) {
      // Senza sessioni nella dest il cwd nuovo non è ricavabile in modo affidabile.
      blockers.push(
        'Cannot determine the destination cwd reliably: the destination folder has no sessions to read it from.'
      );
    } else if (sourceReal !== destReal) {
      cwdRewrite = { from: sourceReal, to: destReal };
      // Verifica che la source contenga davvero quel cwd (sanity check informativo).
      const sample = sourceSessions
        .map(f => readCwdSet(join(sourceDir, f)))
        .find(set => set.size > 0);
      if (sample && !sample.has(sourceReal)) {
        warnings.push(
          'Source sessions reference a cwd different from the resolved source path; rewrite will target the destination cwd anyway.'
        );
      }
    }
  }

  // ── Memory ───────────────────────────────────────────────────────────────────
  const sourceMemDir = join(sourceDir, 'memory');
  const destMemDir = join(destDir, 'memory');
  const sourceTopics = listFiles(sourceMemDir, f => f.endsWith('.md') && f !== 'MEMORY.md');
  const destTopicSet = new Set(listFiles(destMemDir, f => f.endsWith('.md') && f !== 'MEMORY.md'));
  const takenTargets = new Set(destTopicSet);

  const memory: MemoryAction[] = [];
  for (const filename of sourceTopics) {
    if (!destTopicSet.has(filename)) {
      memory.push({ filename, kind: 'copy' });
      takenTargets.add(filename);
      continue;
    }
    // stesso nome: confronta il contenuto
    let identical = false;
    try {
      const a = readFileSync(join(sourceMemDir, filename), 'utf-8');
      const b = readFileSync(join(destMemDir, filename), 'utf-8');
      identical = a === b;
    } catch {
      // se illeggibile, trattalo come conflitto prudenziale
    }
    if (identical) {
      memory.push({ filename, kind: 'identical' });
    } else {
      const targetName = uniqueRenameTarget(filename, takenTargets);
      takenTargets.add(targetName);
      memory.push({ filename, kind: 'conflict-rename', targetName });
      warnings.push(
        `Memory "${filename}" exists in both with different content → kept as "${targetName}". Wikilinks to its slug may become ambiguous.`
      );
    }
  }

  const sourceHasMemoryIndex = existsSync(join(sourceMemDir, 'MEMORY.md'));
  const regenerateIndex =
    memory.some(m => m.kind === 'copy' || m.kind === 'conflict-rename') || sourceHasMemoryIndex;

  // ── Directory sidecar di sessione (UUID/ con tool-results/, subagents/, …) ──────
  // Sono tutte le sottocartelle della source diverse da memory/. Vanno spostate
  // insieme ai .jsonl, altrimenti tool-results e subagent transcripts restano orfani.
  const destSubdirSet = new Set(listSubdirs(destDir));
  const sidecars: SidecarMove[] = listSubdirs(sourceDir)
    .filter(name => name !== 'memory')
    .map(name => {
      const collides = destSubdirSet.has(name);
      if (collides) {
        warnings.push(
          `Session folder "${name}" already exists in the destination → left in place (not overwritten).`
        );
      }
      return { name, collides };
    });
  const movableSidecars = new Set(sidecars.filter(s => !s.collides).map(s => s.name));

  // ── Stato finale della source ──────────────────────────────────────────────────
  // Il merge consuma sessioni (.jsonl), memory/ e le sidecar spostabili. La source
  // è cancellabile solo se non resta nient'altro (oltre a .DS_Store).
  let sourceEntries: string[] = [];
  try {
    sourceEntries = readdirSync(sourceDir);
  } catch {
    /* ignore */
  }
  const leftovers = sourceEntries.filter(
    n => n !== 'memory' && n !== '.DS_Store' && !n.endsWith('.jsonl') && !movableSidecars.has(n)
  );
  const sourceEmptyAfter = leftovers.length === 0;

  return {
    source: { hash: sourceHash, realPath: sourceReal, authoritative: sourceAuthoritative },
    dest: { hash: destHash, realPath: destReal, authoritative: destAuthoritative },
    cwdRewrite,
    sessions,
    sidecars,
    memory,
    regenerateIndex,
    sourceEmptyAfter,
    blockers,
    warnings,
  };
}
