import { existsSync, statSync } from 'fs';
import { join } from 'path';
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

interface MonitorState {
  watcher: FileWatcher;
  filePath: string;
  fileOffset: number;
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

export async function startLiveMonitor(
  projectPath: string,
  sessionId: string | null,
  onEvent: EventCallback
): Promise<boolean> {
  stopLiveMonitor();
  const myGeneration = startGeneration;

  // Cerca file JSONL nella cartella sessions o direttamente nel progetto
  const sessionsDir = join(projectPath, 'sessions');
  const searchDir = existsSync(sessionsDir) ? sessionsDir : projectPath;

  // Con un sessionId (dal registro delle sessioni vive) si taila il transcript
  // esatto; senza, fallback al file più recente per mtime. Il pattern check
  // evita che un id arbitrario esca dalla directory del progetto.
  let filePath: string | null = null;
  if (sessionId && /^[a-zA-Z0-9-]+$/.test(sessionId)) {
    const exact = join(searchDir, `${sessionId}.jsonl`);
    if (existsSync(exact)) filePath = exact;
  }

  if (!filePath) {
    // Dir via `cwd`, pattern relativo: un pattern costruito con path.join
    // conterrebbe `\` su Windows, che glob interpreta come escape (#59).
    const files = await glob('*.jsonl', { cwd: searchDir, absolute: true });
    const sorted = files
      .filter(f => existsSync(f))
      .map(f => ({ f, mtime: statSync(f).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (sorted.length === 0) return false;
    filePath = sorted[0].f;
  }
  // Parte dalla fine del file (solo eventi nuovi)
  const initialSize = statSync(filePath).size;

  // chokidar 5 è ESM-only: import dinamico per usarlo dal bundle CommonJS.
  const { watch } = await import('chokidar');
  // A concurrent start/stop may have superseded us across the awaits above
  // (glob + dynamic import). If so, don't create/assign a watcher we'd leak.
  if (myGeneration !== startGeneration) return false;
  const watcher = watch(filePath, { ignoreInitial: true, usePolling: false });

  state = { watcher, filePath, fileOffset: initialSize };

  watcher.on('change', () => {
    if (!state) return;
    try {
      const read = readAppend(state.filePath, state.fileOffset);
      state.fileOffset = read.offset;
      read.events.forEach(onEvent);
      if (read.dropped > 0) {
        console.warn(
          `[live-monitor] dropped ${read.dropped} malformed/oversized JSONL line(s) in ${state.filePath}`
        );
      }
    } catch {
      /* errore file */
    }
  });

  return true;
}
