import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'fs';
import { basename, join, resolve, sep } from 'path';

import { findSessionFile } from './session-reader';
import { isWithinPlansDir, listPlanSessionFiles, readPlanRefs } from './plans-reader';

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

/**
 * One path the caller asked to delete. `required` marks a path whose survival
 * makes the whole operation a failure — for a session that is its transcript,
 * the artifact the dialog shows as `locked`. Everything else is optional: it can
 * fail without invalidating the delete, but the caller has to be told.
 */
export interface DeleteRequest {
  path: string;
  required?: boolean;
}

/**
 * What became of one requested path.
 *
 *  - `deleted`  — it was there and now it is not (verified, see below)
 *  - `absent`   — nothing was there to begin with; the end state is the wanted one
 *  - `refused`  — we would not touch it (outside the Claude root, or not a path)
 *  - `failed`   — we tried and it is still there
 *
 * `absent` is kept apart from `deleted` on purpose: both satisfy a `required`
 * entry, but only one of them is something this call did, and a dialog that says
 * "deleted" about a file that was already gone is telling the user something it
 * does not know.
 */
export type DeleteStatus = 'deleted' | 'absent' | 'refused' | 'failed';

export interface ArtifactOutcome {
  path: string;
  status: DeleteStatus;
  required: boolean;
  /** Why, for `refused` and `failed`. Absent otherwise. */
  reason?: string;
}

export interface DeleteSessionResult {
  /** One entry per requested path, in the order they were asked for. */
  outcomes: ArtifactOutcome[];
  /**
   * I path che **questa chiamata** ha rimosso. Non include gli `absent`: non
   * c'erano, e dire "deleted" di un file già mancante è un'affermazione che
   * questa funzione non può fare.
   */
  deleted: string[];
  /** One ready-to-show line per `refused`/`failed` entry. */
  warnings: string[];
  /**
   * Every `required` path is gone. **The only signal a caller may read as
   * success**: the previous shape had none, so a renderer that saw a resolved
   * IPC call reported a deleted session over a transcript still on disk.
   */
  succeeded: boolean;
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

/** True solo per un file regolare esistente e leggibile. */
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Per ogni piano referenziato dalla sessione, conta in quante SESSIONI del
// progetto compare lo stesso `planFilePath`. Serve ad avvisare l'utente che un
// piano è condiviso prima di cancellarlo (i piani vivono globali in
// ~/.claude/plans).
//
// L'unità è la sessione, quindi l'enumerazione è quella condivisa
// (`listPlanSessionFiles` → `listProjectSessionFiles`), mai una glob ricorsiva.
// `**/*.jsonl` sbagliava tre volte in una riga: pescava le sidecar dei
// sub-agenti (`{sessionId}/subagents/agent-*.jsonl`, e quelle dei workflow
// annidate sotto `subagents/workflows/<runId>/`) contandole per sessioni — il
// dialog stampa "referenced by N sessions" —, apriva l'intero albero delle
// sidecar all'apertura di una modale, e soprattutto popolava la cache di
// `readPlanRefs` sotto directory che nessuna scansione ripassa mai: la potatura
// arriva dall'hook `onScan` di questa enumerazione, quindi quelle entry (refs +
// buffer parziale) sopravvivevano per tutta la vita del processo. È lo stesso
// errore di #95, nell'unico punto in cui era rimasto.
async function planReferenceCounts(projectPath: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const sessionFiles = await listPlanSessionFiles(projectPath);
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
  sessionFilename: string
): Promise<SessionArtifacts> {
  const sessionId = basename(sessionFilename, '.jsonl');
  const artifacts: SessionArtifact[] = [];

  // 1. Transcript della sessione (sempre cancellato).
  const sessionFile =
    (await findSessionFile(projectPath, sessionFilename)) ?? join(projectPath, sessionFilename);
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
  //
  // `planFilePath` arriva VERBATIM da un attachment del transcript, quindi può
  // nominare qualsiasi path su disco. `plans-reader` si rifiuta già di LEGGERE
  // fuori da ~/.claude/plans (transcript avvelenato/condiviso che punta a
  // ~/.aws/credentials); qui si offrirebbe di CANCELLARLO, che è strettamente
  // peggio, e l'unica guardia a valle è la root ~/.claude di
  // `deleteSessionArtifacts` — abbastanza larga da lasciar passare
  // ~/.claude/settings.json o il transcript di un altro progetto. Si confina
  // PRIMA di sondare: un path che abbiamo già stabilito non essere nostro non
  // merita nemmeno uno `stat` (esistenza inclusa).
  const planPaths = new Set(
    (await readPlanRefs(sessionFile)).map(r => r.filePath).filter(isWithinPlansDir)
  );
  if (planPaths.size > 0) {
    const refCounts = await planReferenceCounts(projectPath);
    for (const planPath of planPaths) {
      // `isDir: false` era un'assunzione, non un fatto: `deleteSessionArtifacts`
      // ri-statta il path e su una directory usa `rmSync` ricorsivo, quindi un
      // `planFilePath` che nomina una cartella diventava una casella sola che
      // cancella un albero. Un piano è un file regolare: se non lo è, o non c'è
      // più, semplicemente non si elenca.
      if (!isRegularFile(planPath)) continue;
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
 *
 * L'esito di ogni voce è **verificato dopo il tentativo**, non dedotto dal fatto
 * che nessuna eccezione sia stata lanciata: `rmSync(..., { force: true })` non
 * segnala tutto ciò che non riesce a rimuovere, e una cancellazione distruttiva
 * che si dichiara riuscita perché nessuno ha protestato è esattamente il modo in
 * cui questa app ha già raccontato una bugia all'utente una volta.
 */
export function deleteSessionArtifacts(
  requests: DeleteRequest[],
  rootDir: string
): DeleteSessionResult {
  const outcomes: ArtifactOutcome[] = [];
  const root = resolve(rootDir);

  const note = (path: string, required: boolean, status: DeleteStatus, reason?: string): void =>
    void outcomes.push(reason ? { path, status, required, reason } : { path, status, required });

  for (const req of requests) {
    const required = req?.required === true;
    const raw = req?.path;

    if (typeof raw !== 'string' || raw.length === 0) {
      note(String(raw), required, 'refused', `Invalid path: ${JSON.stringify(raw)}`);
      continue;
    }
    const resolved = resolve(raw);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      note(resolved, required, 'refused', `Refusing to delete path outside ${root}`);
      continue;
    }
    if (!existsSync(resolved)) {
      note(resolved, required, 'absent');
      continue;
    }
    try {
      if (statSync(resolved).isDirectory()) {
        rmSync(resolved, { recursive: true, force: true });
      } else {
        unlinkSync(resolved);
      }
    } catch (e) {
      note(resolved, required, 'failed', e instanceof Error ? e.message : String(e));
      continue;
    }
    // Il tentativo non ha lanciato: resta da chiedere al filesystem se è servito.
    if (existsSync(resolved)) {
      note(resolved, required, 'failed', 'still present after deletion');
    } else {
      note(resolved, required, 'deleted');
    }
  }

  const gone = (o: ArtifactOutcome) => o.status === 'deleted' || o.status === 'absent';
  return {
    outcomes,
    deleted: outcomes.filter(o => o.status === 'deleted').map(o => o.path),
    warnings: outcomes.filter(o => !gone(o)).map(o => `Failed to delete ${o.path}: ${o.reason}`),
    succeeded: outcomes.every(o => !o.required || gone(o)),
  };
}
