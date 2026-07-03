import { existsSync, statSync, openSync, fstatSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

// chokidar 5 è ESM-only: il modulo si carica con un import dinamico (vedi sotto).
// Tipizziamo il watcher in modo strutturale con i soli metodi usati, così da
// evitare un import di tipo da un modulo ESM in questo bundle CommonJS.
interface FileWatcher {
  on(event: string, listener: (...args: unknown[]) => void): FileWatcher;
  close(): Promise<void>;
}

export interface LiveEvent {
  id: string;
  timestamp: string;
  type: 'tool_use' | 'tool_result' | 'text' | 'thinking' | 'user_message' | 'status_change';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  content?: string;
  isError?: boolean;
  model?: string;
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
      const fd = openSync(state.filePath, 'r');
      try {
        const st = fstatSync(fd);
        // A truncated or recreated transcript (size shrank below our offset) leaves
        // the offset past EOF: reset to 0 and re-read from the start, otherwise
        // every later append is missed until the file grows past the stale offset.
        if (st.size < state.fileOffset) state.fileOffset = 0;
        if (st.size <= state.fileOffset) return;

        // Read the delta in bounded chunks (never allocate the whole append at
        // once) and assemble complete lines from a byte-level buffer so multi-byte
        // UTF-8 chars and lines straddling a chunk boundary are handled correctly.
        let offset = state.fileOffset;
        let consumed = state.fileOffset; // bytes up to and including the last newline
        let pending = Buffer.alloc(0);
        let dropped = 0;

        const emitLine = (lineBuf: Buffer) => {
          const line = lineBuf.toString('utf-8').trim();
          if (!line) return;
          try {
            const json = JSON.parse(line) as Record<string, unknown>;
            parseJsonlLine(json).forEach(onEvent);
          } catch {
            dropped++;
          }
        };

        while (offset < st.size) {
          const chunkSize = Math.min(MAX_READ_BYTES, st.size - offset);
          const buf = Buffer.alloc(chunkSize);
          const n = readSync(fd, buf, 0, chunkSize, offset);
          if (n <= 0) break;
          offset += n;
          pending = pending.length ? Buffer.concat([pending, buf.subarray(0, n)]) : buf.subarray(0, n);

          let nl: number;
          while ((nl = pending.indexOf(0x0a)) !== -1) {
            emitLine(pending.subarray(0, nl));
            consumed += nl + 1;
            pending = pending.subarray(nl + 1);
          }

          // Guard against an unterminated, oversized (likely corrupt) line:
          // drop it instead of buffering unboundedly.
          if (pending.length > MAX_LINE_BYTES) {
            dropped++;
            consumed += pending.length;
            pending = Buffer.alloc(0);
          }
        }

        // Leave the trailing partial line (no newline yet) unconsumed for next time.
        state.fileOffset = consumed;

        if (dropped > 0) {
          console.warn(`[live-monitor] dropped ${dropped} malformed/oversized JSONL line(s) in ${state.filePath}`);
        }
      } finally {
        closeSync(fd);
      }
    } catch { /* errore file */ }
  });

  return true;
}

// Cap per readSync allocation; loop for larger appends.
const MAX_READ_BYTES = 4 * 1024 * 1024; // 4 MB
// A single JSONL line above this is treated as corrupt and dropped.
const MAX_LINE_BYTES = 16 * 1024 * 1024; // 16 MB

function parseJsonlLine(json: Record<string, unknown>): LiveEvent[] {
  const events: LiveEvent[] = [];

  if (json.type !== 'user' && json.type !== 'assistant') return events;
  if (json.isMeta === true || json.isSidechain === true) return events;

  const msg = json.message as Record<string, unknown> | undefined;
  if (!msg) return events;

  const role = msg.role as string;
  const model = msg.model as string | undefined;
  const ts = String(json.timestamp ?? new Date().toISOString());
  const baseId = `${ts}-${Math.random().toString(36).slice(2, 8)}`;

  // ── Status derivato da stop_reason (assistant) ─────────────────────────────
  // stop_reason: null = draft scritto durante lo streaming, sempre seguito dal vero stop_reason
  // → lo ignoriamo per evitare il flash thinking→idle nel batch React
  if (json.type === 'assistant') {
    const stopReason = msg.stop_reason as string | null | undefined;
    if (stopReason === 'end_turn') {
      events.push({ id: `${baseId}-st`, timestamp: ts, type: 'status_change', content: 'idle' });
    } else if (stopReason === 'tool_use') {
      events.push({ id: `${baseId}-st`, timestamp: ts, type: 'status_change', content: 'busy' });
    }
  }

  // ── Qualsiasi messaggio utente → Claude inizia a rispondere (thinking) ──────
  // Copre sia il testo libero dell'utente che i tool_result
  if (json.type === 'user') {
    events.push({ id: `${baseId}-st`, timestamp: ts, type: 'status_change', content: 'thinking' });
  }

  // Messaggio testuale dell'utente
  if (typeof msg.content === 'string' && role === 'user') {
    const text = msg.content.replace(/<[^>]+>/g, '').trim();
    if (text) {
      events.push({ id: baseId, timestamp: ts, type: 'user_message', content: text.slice(0, 300) });
    }
    return events;
  }

  if (!Array.isArray(msg.content)) return events;

  for (const block of msg.content as Record<string, unknown>[]) {
    if (block.type === 'text' && role === 'assistant') {
      const text = (block.text as string ?? '').trim();
      if (text) {
        events.push({ id: `${baseId}-t`, timestamp: ts, type: 'text', content: text.slice(0, 400), model });
      }
    } else if (block.type === 'thinking') {
      const text = (block.thinking as string ?? '').trim();
      if (text) {
        events.push({ id: `${baseId}-th`, timestamp: ts, type: 'thinking', content: text.slice(0, 300), model });
      }
    } else if (block.type === 'tool_use') {
      events.push({
        id: `${baseId}-tu-${String(block.id ?? '').slice(-4)}`,
        timestamp: ts,
        type: 'tool_use',
        toolName: String(block.name ?? 'unknown'),
        toolInput: block.input as Record<string, unknown>,
        model,
      });
    } else if (block.type === 'tool_result') {
      const content =
        typeof block.content === 'string' ? block.content :
        Array.isArray(block.content)
          ? (block.content as { text?: string }[]).map(c => c.text ?? '').join(' ')
          : '';
      events.push({
        id: `${baseId}-tr-${String(block.tool_use_id ?? '').slice(-4)}`,
        timestamp: ts,
        type: 'tool_result',
        content: content.slice(0, 400),
        isError: Boolean(block.is_error),
      });
    }
  }

  return events;
}
