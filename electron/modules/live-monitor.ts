import { existsSync, statSync } from 'fs';
import { basename, join } from 'path';
import { glob } from 'glob';
import { readAppend, type LiveEvent } from './transcript-tail';

export type { LiveEvent };

// chokidar 5 è ESM-only: il modulo si carica con un import dinamico (vedi sotto).
// Tipizziamo il watcher in modo strutturale con i soli metodi usati, così da
// evitare un import di tipo da un modulo ESM in questo bundle CommonJS.
interface FileWatcher {
  on(event: string, listener: (...args: unknown[]) => void): FileWatcher;
  close(): Promise<void>;
}

type EventCallback = (event: LiveEvent) => void;

/**
 * Che cosa sta tailando il monitor.
 *
 * `pending` è lo stato che mancava, ed è la ragione di #194: chiesto un
 * `sessionId` il cui transcript non esiste ancora, il monitor ripiegava sul
 * `.jsonl` più recente del progetto e rispondeva `started: true`. Mostrava
 * quindi l'attività di **un'altra sessione** dichiarandosi agganciato a quella
 * richiesta — e succede proprio all'avvio, quando il registro pubblica un id
 * prima che il suo file esista. Ora un id esplicito non porta mai su un altro
 * file: si aspetta il suo, e lo si dice.
 */
export type LiveMonitorState = 'tailing' | 'pending' | 'none';

export interface LiveMonitorStatus {
  state: LiveMonitorState;
  /** La sessione richiesta (null in modalità fallback, senza id). */
  sessionId: string | null;
  /** Il file effettivamente tailato, quando `state` è `tailing`. */
  filePath: string | null;
}

interface MonitorState {
  watcher: FileWatcher;
  /** Il file da leggere; null finché si attende che il transcript compaia. */
  filePath: string | null;
  fileOffset: number;
  sessionId: string | null;
  /** Il nome file esatto atteso, in modalità `pending`. */
  awaitedFile: string | null;
  /**
   * True quando il watcher osserva la CARTELLA (attesa del transcript, e poi
   * l'aggancio): lì gli eventi arrivano anche per gli altri file e vanno
   * filtrati. Con il watch diretto su un file non c'è nulla da filtrare.
   */
  dirWatch: boolean;
  onEvent: EventCallback;
  onStatus?: (status: LiveMonitorStatus) => void;
}

let state: MonitorState | null = null;
// Bumped on every start/stop. A start that loses a race against a newer start
// (across its awaits) uses this to detect it's been superseded and bail instead
// of leaking its just-created chokidar watcher.
let startGeneration = 0;

export function stopLiveMonitor(): void {
  startGeneration++;
  if (state) {
    state.watcher.close().catch(() => {});
    state = null;
  }
}

// Un id che non ha la forma di un session id non viene mai risolto in un file:
// senza questo controllo un `../…` uscirebbe dalla cartella del progetto.
const SESSION_ID_RE = /^[a-zA-Z0-9-]+$/;

export interface TailTarget {
  state: LiveMonitorState;
  /** Il transcript da tailare, se già esistente. */
  filePath: string | null;
  /** La cartella da osservare in attesa del transcript (`state: 'pending'`). */
  watchDir: string | null;
  sessionId: string | null;
}

/**
 * Che cosa tailare, deciso **prima** di aprire qualsiasi watcher — e la metà del
 * modulo dove viveva il bug, quindi la metà che si testa da sola.
 *
 * Due modalità, tenute separate di proposito:
 *
 *  - **con `sessionId`**: si risolve solo `<sessionId>.jsonl`, cercato in
 *    entrambi i layout nativi (`<hash>/sessions/` e `<hash>/`). Se non c'è,
 *    l'esito è `pending`, mai il transcript di un'altra sessione. Un id
 *    malformato non è nemmeno pending: è `none` (non c'è nulla che possa
 *    comparire con quel nome che valga la pena aspettare).
 *  - **senza `sessionId`**: resta il fallback storico al `.jsonl` più recente
 *    per mtime, che serve alle entry del `process-scanner` — quelle non portano
 *    alcun id, quindi "il file più recente del progetto" è la sola risposta
 *    possibile, e lì è una stima dichiarata, non un aggancio sbagliato.
 */
export async function resolveTailTarget(
  projectPath: string,
  sessionId: string | null
): Promise<TailTarget> {
  if (sessionId) {
    if (!SESSION_ID_RE.test(sessionId)) {
      return { state: 'none', filePath: null, watchDir: null, sessionId };
    }
    // Entrambi i layout, non solo quello che oggi ha la cartella: `sessions/`
    // può esistere e il transcript stare comunque nella radice del progetto.
    for (const dir of [join(projectPath, 'sessions'), projectPath]) {
      const exact = join(dir, `${sessionId}.jsonl`);
      if (existsSync(exact)) {
        return { state: 'tailing', filePath: exact, watchDir: null, sessionId };
      }
    }
    // Il file non c'è ancora. Si osserva la cartella del progetto a profondità 1
    // — non il percorso esatto — così il transcript viene visto sia se nasce
    // nella radice sia se nasce in una `sessions/` creata dopo di noi.
    if (!existsSync(projectPath)) {
      return { state: 'none', filePath: null, watchDir: null, sessionId };
    }
    return { state: 'pending', filePath: null, watchDir: projectPath, sessionId };
  }

  const sessionsDir = join(projectPath, 'sessions');
  const searchDir = existsSync(sessionsDir) ? sessionsDir : projectPath;
  // Dir via `cwd`, pattern relativo: un pattern costruito con path.join
  // conterrebbe `\` su Windows, che glob interpreta come escape (#59).
  const files = await glob('*.jsonl', { cwd: searchDir, absolute: true });
  const newest = files
    .filter(f => existsSync(f))
    .map(f => ({ f, mtime: statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) return { state: 'none', filePath: null, watchDir: null, sessionId: null };
  return { state: 'tailing', filePath: newest.f, watchDir: null, sessionId: null };
}

export interface StartLiveMonitorOptions {
  projectPath: string;
  /** L'id della sessione da tailare; null = fallback al transcript più recente. */
  sessionId: string | null;
  onEvent: EventCallback;
  /** Notificato quando l'attesa del transcript si risolve in un tail vero. */
  onStatus?: (status: LiveMonitorStatus) => void;
  /**
   * Opzioni chokidar aggiuntive. Esistono per i test, che con il polling non
   * dipendono dalla latenza degli eventi nativi del filesystem.
   */
  watchOptions?: Record<string, unknown>;
}

export async function startLiveMonitor(opts: StartLiveMonitorOptions): Promise<LiveMonitorStatus> {
  const { projectPath, sessionId, onEvent, onStatus, watchOptions } = opts;
  stopLiveMonitor();
  const myGeneration = startGeneration;

  const target = await resolveTailTarget(projectPath, sessionId);
  if (target.state === 'none') {
    return { state: 'none', sessionId: target.sessionId, filePath: null };
  }

  const initialOffset = target.filePath ? statSync(target.filePath).size : 0;

  // chokidar 5 è ESM-only: import dinamico per usarlo dal bundle CommonJS.
  const { watch } = await import('chokidar');
  // A concurrent start/stop may have superseded us across the awaits above
  // (glob + dynamic import). If so, don't create/assign a watcher we'd leak.
  if (myGeneration !== startGeneration) {
    return { state: 'none', sessionId: target.sessionId, filePath: null };
  }

  const watchPath = target.filePath ?? target.watchDir!;
  const watcher = watch(watchPath, {
    ignoreInitial: true,
    usePolling: false,
    // Serve solo in attesa del transcript: la cartella del progetto contiene i
    // `.jsonl` e la sidecar `subagents/`, che non ci interessa.
    ...(target.filePath ? {} : { depth: 1 }),
    ...watchOptions,
  });

  state = {
    watcher,
    filePath: target.filePath,
    fileOffset: initialOffset,
    sessionId: target.sessionId,
    awaitedFile: target.filePath ? null : `${target.sessionId}.jsonl`,
    dirWatch: !target.filePath,
    onEvent,
    onStatus,
  };

  const onFsEvent = (raw: unknown) => {
    const path = typeof raw === 'string' ? raw : '';
    if (!state || !path) return;

    if (state.awaitedFile) {
      // Solo il transcript atteso scioglie l'attesa: qualunque altro file che
      // compare nella cartella (un'altra sessione che parte, una sidecar) resta
      // fuori. Il file è appena nato, quindi si legge da 0 — nulla da saltare.
      if (basename(path) !== state.awaitedFile) return;
      state.filePath = path;
      state.fileOffset = 0;
      state.awaitedFile = null;
      state.onStatus?.({ state: 'tailing', sessionId: state.sessionId, filePath: path });
    } else if (state.dirWatch && basename(path) !== basename(state.filePath!)) {
      // Il watcher di cartella resta aperto dopo l'aggancio: gli append degli
      // altri transcript del progetto non sono di questa sessione. Il confronto è
      // sul NOME del file, non sul percorso: chokidar riporta il path risolto
      // (su macOS `/private/var/…` dove noi avevamo `/var/…`) e su Windows i
      // separatori possono differire, quindi un confronto di percorsi scarterebbe
      // gli eventi del file giusto. Dentro una cartella il nome basta a
      // distinguere un transcript dall'altro — è l'id della sessione.
      return;
    }

    try {
      const read = readAppend(state.filePath!, state.fileOffset);
      state.fileOffset = read.offset;
      read.events.forEach(state.onEvent);
      if (read.dropped > 0) {
        console.warn(
          `[live-monitor] dropped ${read.dropped} malformed/oversized JSONL line(s) in ${state.filePath}`
        );
      }
    } catch {
      /* errore file */
    }
  };

  watcher.on('add', onFsEvent);
  watcher.on('change', onFsEvent);

  return { state: target.state, sessionId: target.sessionId, filePath: target.filePath };
}
