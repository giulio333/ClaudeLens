import { readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { resolveRealPath } from '../utils';
import { listProjectSessionFilesSync } from './session-files';

/** Una singola cartella history in ~/.claude/projects/ candidata a duplicato. */
export interface DuplicateFolder {
  hash: string;
  /** cwd autoritativo letto dai .jsonl quando disponibile, altrimenti fallback lossy da hashToPath. */
  realPath: string;
  /** true se realPath proviene da un .jsonl (affidabile), false se è il fallback ricostruito dal nome cartella. */
  realPathAuthoritative: boolean;
  /** Numero di file di sessione .jsonl nella cartella. */
  sessionCount: number;
  /** mtime ISO della sessione più recente, null se nessuna sessione. */
  lastActivity: string | null;
  /** Numero di topic .md in memory/ (escluso MEMORY.md). */
  memoryTopicCount: number;
  /** true se esiste memory/MEMORY.md. */
  hasMemoryIndex: boolean;
}

/** Gruppo di cartelle che con buona probabilità sono lo stesso progetto aperto da path diversi. */
export interface DuplicateGroup {
  /** Chiave di raggruppamento: basename del realPath normalizzato (lowercase). */
  key: string;
  /** Nome leggibile del progetto (basename della cartella suggerita come primaria). */
  name: string;
  /** Cartelle del gruppo, ordinate con la primaria suggerita per prima. */
  folders: DuplicateFolder[];
}

function scanFolder(projectsDir: string, hash: string): DuplicateFolder {
  const dir = join(projectsDir, hash);

  // Entrambi i layout nativi: leggere la sola radice dava zero sessioni per ogni
  // progetto in layout `sessions/`, e quello zero non è solo un numero sbagliato
  // nella card — è anche `realPathAuthoritative` (sotto) che diventa false, cioè
  // il path del progetto marcato come stimato mentre sta scritto in un transcript.
  let sessionCount = 0;
  let lastMtime = 0;
  for (const file of listProjectSessionFilesSync(dir)) {
    sessionCount++;
    try {
      const m = statSync(file).mtimeMs;
      if (m > lastMtime) lastMtime = m;
    } catch {
      // file sparito fra l'elenco e lo stat: non aggiorna l'attività
    }
  }

  let memoryTopicCount = 0;
  let hasMemoryIndex = false;
  const memoryDir = join(dir, 'memory');
  if (existsSync(memoryDir)) {
    try {
      for (const entry of readdirSync(memoryDir)) {
        if (!entry.endsWith('.md')) continue;
        if (entry === 'MEMORY.md') hasMemoryIndex = true;
        else memoryTopicCount++;
      }
    } catch {
      // ignore
    }
  }

  const realPath = resolveRealPath(projectsDir, hash);
  // Il path è affidabile quando proviene dal cwd di una sessione. Senza sessioni
  // resolveRealPath ricade per forza sul fallback lossy di hashToPath (path stimato).
  // (Confrontare realPath con hashToPath sarebbe ambiguo: per i path senza '.'/'~'/spazi
  // il fallback coincide con quello reale e marcherebbe a torto come stimato.)
  const realPathAuthoritative = sessionCount > 0;

  return {
    hash,
    realPath,
    realPathAuthoritative,
    sessionCount,
    lastActivity: lastMtime > 0 ? new Date(lastMtime).toISOString() : null,
    memoryTopicCount,
    hasMemoryIndex,
  };
}

/** Ordina le cartelle di un gruppo: la più "viva" (attività recente, poi più sessioni) per prima. */
function sortPrimaryFirst(a: DuplicateFolder, b: DuplicateFolder): number {
  const ta = a.lastActivity ? Date.parse(a.lastActivity) : 0;
  const tb = b.lastActivity ? Date.parse(b.lastActivity) : 0;
  if (tb !== ta) return tb - ta;
  return b.sessionCount - a.sessionCount;
}

/**
 * Rileva i progetti duplicati: cartelle history distinte che si riferiscono allo
 * stesso progetto (stesso basename del path, case-insensitive).
 *
 * Operazione read-only: si limita a *segnalare* i candidati. L'identità non è certa
 * (basename uguali possono appartenere a progetti diversi, es. due repo "api"), quindi
 * la conferma e l'eventuale merge restano all'utente.
 */
/** Chiave di confronto tollerante: minuscolo, senza separatori (`.`, `-`, spazi, `/`). */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Chiavi candidate per una cartella-residuo (senza cwd affidabile): code di token
 * crescenti del nome hash, normalizzate. Dalla più specifica (più token) alla meno.
 * Es. `-Users-…-Documents-SARA2-0` → ['documentssara20', 'sara20', '0'].
 * Serve a riconoscere che `…-Documents-SARA2-0` è lo stesso progetto di `SARA2.0`
 * (→ 'sara20'), nonostante l'hash lossy non permetta di ricostruirne il basename.
 */
function candidateKeysFromHash(hash: string, maxRun = 5): string[] {
  const tokens = hash.replace(/^-/, '').split('-').filter(Boolean);
  const out: string[] = [];
  for (let run = Math.min(maxRun, tokens.length); run >= 1; run--) {
    const key = normKey(tokens.slice(tokens.length - run).join(''));
    if (key) out.push(key);
  }
  return out;
}

export function detectDuplicateProjects(projectsDir: string): DuplicateGroup[] {
  let hashes: string[];
  try {
    hashes = readdirSync(projectsDir).filter(name => {
      try {
        return statSync(join(projectsDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }

  const folders = hashes.map(hash => scanFolder(projectsDir, hash));

  // Pass 1: le cartelle con cwd affidabile definiscono i gruppi (chiave = basename normalizzato).
  const byKey = new Map<string, DuplicateFolder[]>();
  const authoritativeKeys = new Set<string>();
  for (const folder of folders) {
    if (!folder.realPathAuthoritative) continue;
    const key = normKey(basename(folder.realPath));
    if (!key) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(folder);
    authoritativeKeys.add(key);
  }

  // Pass 2: le cartelle-residuo (senza cwd) si agganciano a un gruppo autoritativo se
  // una loro coda di token combacia; altrimenti restano sul proprio basename lossy
  // (così due residui con lo stesso nome lossy continuano a raggrupparsi tra loro).
  for (const folder of folders) {
    if (folder.realPathAuthoritative) continue;
    const matched = candidateKeysFromHash(folder.hash).find(k => authoritativeKeys.has(k));
    const key = matched ?? normKey(basename(folder.realPath));
    if (!key) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(folder);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, folders] of byKey) {
    if (folders.length < 2) continue; // solo gruppi con più di una cartella
    folders.sort(sortPrimaryFirst);
    groups.push({
      key,
      name: basename(folders[0].realPath),
      folders,
    });
  }

  // Gruppi con più sessioni totali per primi (più rilevanti da riordinare).
  groups.sort((a, b) => {
    const sa = a.folders.reduce((s, f) => s + f.sessionCount, 0);
    const sb = b.folders.reduce((s, f) => s + f.sessionCount, 0);
    return sb - sa;
  });

  return groups;
}
