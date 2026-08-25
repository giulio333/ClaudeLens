import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import { resolveRealPath, isAbsolutePath } from '../utils';
import { projectSessionDirSync } from './session-files';

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

/** Directory sidecar di sessione (UUID/) che contiene tool-results/, subagents/, ecc.
 *
 *  Vive ACCANTO al suo `.jsonl`, quindi la sua posizione la decide il layout
 *  (`MergeLayout`) esattamente come quella del transcript: si prende da
 *  `<source>/<layout.from>/<name>` e si consegna a `<dest>/<layout.to>/<name>`. */
export interface SidecarMove {
  name: string;
  /** true se una directory con lo stesso nome esiste già nella dest (verrà saltata). */
  collides: boolean;
}

/**
 * Dove stanno i transcript dei due progetti, relativo alla cartella del
 * progetto: `''` per la radice, `'sessions'` per il layout annidato.
 *
 * Il merge deve saperlo per tre motivi distinti, e prima li ignorava tutti e
 * tre. Legge da `from`, altrimenti in layout `sessions/` non vede una sola
 * sessione da spostare. Scrive in `to`, cioè nel layout che la dest usa GIÀ,
 * perché un progetto va tenuto su UNO: `listProjectSessionFiles` legge la
 * `sessions/` da sola quando non è vuota, quindi una dest lasciata con
 * transcript in entrambi i posti mostra solo la metà annidata e nasconde la sua
 * — che è esattamente il danno che questo piano produceva, spostando la
 * `sessions/` della source come se fosse la cartella sidecar di una sessione.
 * E i sidecar seguono il loro transcript, quindi vivono anche loro qui.
 */
export interface MergeLayout {
  from: string;
  to: string;
}

export interface MergePlan {
  source: { hash: string; realPath: string; authoritative: boolean };
  dest: { hash: string; realPath: string; authoritative: boolean };
  /** Sottocartella dei transcript nei due progetti — vedi `MergeLayout`. */
  layout: MergeLayout;
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
 * Cosa resta dentro `<source>/sessions` dopo il merge.
 *
 * I `.jsonl` e i sidecar spostabili se ne vanno solo se QUELLA è la cartella dei
 * transcript in uso; tutto il resto rimane. Una `sessions/` che non esiste, o che
 * il merge svuota, non conta come residuo: è un artefatto di layout, e
 * l'esecuzione la rimuove insieme a ciò che conteneva.
 */
function sessionsDirLeftovers(
  sourceDir: string,
  layout: MergeLayout,
  movableSidecars: Set<string>
): string[] {
  const consumedHere = layout.from === 'sessions';
  return listFiles(join(sourceDir, 'sessions'), () => true).filter(
    name =>
      name !== '.DS_Store' &&
      !(consumedHere && (name.endsWith('.jsonl') || movableSidecars.has(name)))
  );
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

  // I transcript stanno in uno dei due layout nativi, e i due progetti possono
  // usarne uno diverso: leggere la sola radice significava non vedere NIENTE da
  // spostare per una source annidata, e dichiarare una dest annidata priva di
  // sessioni — cioè bloccare il merge dicendo che non se ne può ricavare il cwd
  // mentre sta scritto nei suoi transcript.
  const sourceSessionDir = projectSessionDirSync(sourceDir);
  const destSessionDir = projectSessionDirSync(destDir);
  const layout: MergeLayout = {
    from: relative(sourceDir, sourceSessionDir),
    to: relative(destDir, destSessionDir),
  };

  const sourceSessions = listFiles(sourceSessionDir, f => f.endsWith('.jsonl'));
  const destSessions = listFiles(destSessionDir, f => f.endsWith('.jsonl'));

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
  // `takenSessionNames` viene aggiornato ad ogni iterazione (sia con targetName
  // rinominati sia con filename lasciati invariati) per evitare che due file
  // source finiscano per essere assegnati allo stesso nome di destinazione.
  const takenSessionNames = new Set(destSessions);
  const sessions: SessionMove[] = sourceSessions.map(filename => {
    const collides = takenSessionNames.has(filename);
    const targetName = collides ? uniqueRenameTarget(filename, takenSessionNames) : filename;
    takenSessionNames.add(targetName);
    return { filename, collides, targetName };
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
        .map(f => readCwdSet(join(sourceSessionDir, f)))
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
  // Stanno accanto ai loro transcript, quindi si cercano nella cartella dei
  // transcript della source e atterrano in quella della dest. Due nomi non sono
  // mai sidecar: `memory/`, che si fonde a parte, e `sessions/`, che è il layout
  // stesso — prenderla per la cartella di una sessione è ciò che rovesciava i
  // transcript della source dentro una dest che poi nascondeva i propri.
  const destSubdirSet = new Set(listSubdirs(destSessionDir));
  const sidecars: SidecarMove[] = listSubdirs(sourceSessionDir)
    .filter(name => name !== 'memory' && name !== 'sessions')
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
  //
  // Solo dentro la cartella dei transcript, però: quello che sta FUORI dal layout
  // in uso non viene spostato, e dichiararlo consumato cancellerebbe la source con
  // dei file dentro. Un `.jsonl` nella radice di un progetto in layout `sessions/`
  // è esattamente quel caso.
  let sourceEntries: string[] = [];
  try {
    sourceEntries = readdirSync(sourceDir);
  } catch {
    /* ignore */
  }
  const rootIsTranscriptDir = layout.from === '';
  const leftovers = sourceEntries.filter(name => {
    if (name === 'memory' || name === '.DS_Store') return false;
    if (rootIsTranscriptDir && (name.endsWith('.jsonl') || movableSidecars.has(name))) return false;
    // `sessions/` non è contenuto ma layout: se il merge ne porta via tutto resta
    // una cartella vuota, che l'esecuzione rimuove con i file che conteneva.
    if (name === 'sessions')
      return sessionsDirLeftovers(sourceDir, layout, movableSidecars).length > 0;
    return true;
  });
  const sourceEmptyAfter = leftovers.length === 0;

  return {
    source: { hash: sourceHash, realPath: sourceReal, authoritative: sourceAuthoritative },
    dest: { hash: destHash, realPath: destReal, authoritative: destAuthoritative },
    layout,
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
