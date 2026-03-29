import { existsSync, statSync, openSync, fstatSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import chokidar from 'chokidar';

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
  watcher: ReturnType<typeof chokidar.watch>;
  filePath: string;
  fileOffset: number;
}

let state: MonitorState | null = null;

export function stopLiveMonitor(): void {
  if (state) {
    state.watcher.close().catch(() => {});
    state = null;
  }
}

export async function startLiveMonitor(
  projectPath: string,
  onEvent: EventCallback
): Promise<boolean> {
  stopLiveMonitor();

  // Cerca file JSONL nella cartella sessions o direttamente nel progetto
  const sessionsDir = join(projectPath, 'sessions');
  const searchDir = existsSync(sessionsDir) ? sessionsDir : projectPath;
  const files = await glob(join(searchDir, '*.jsonl'));

  if (files.length === 0) return false;

  // Prende il file più recente per data di modifica
  const sorted = files
    .filter(f => existsSync(f))
    .map(f => ({ f, mtime: statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (sorted.length === 0) return false;

  const filePath = sorted[0].f;
  // Parte dalla fine del file (solo eventi nuovi)
  const initialSize = statSync(filePath).size;

  const watcher = chokidar.watch(filePath, { ignoreInitial: true, usePolling: false });

  state = { watcher, filePath, fileOffset: initialSize };

  watcher.on('change', () => {
    if (!state) return;
    try {
      const fd = openSync(state.filePath, 'r');
      try {
        const st = fstatSync(fd);
        if (st.size <= state.fileOffset) return;
        const newBytes = st.size - state.fileOffset;
        const buf = Buffer.alloc(newBytes);
        readSync(fd, buf, 0, newBytes, state.fileOffset);
        state.fileOffset = st.size;

        const text = buf.toString('utf-8');
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const json = JSON.parse(line) as Record<string, unknown>;
            parseJsonlLine(json).forEach(onEvent);
          } catch { /* riga non-JSON */ }
        }
      } finally {
        closeSync(fd);
      }
    } catch { /* errore file */ }
  });

  return true;
}

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
