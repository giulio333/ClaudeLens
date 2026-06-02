import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import os from 'os';

const CLAUDE_DIR = join(os.homedir(), '.claude');
const JOBS_DIR = join(CLAUDE_DIR, 'jobs');
const ROSTER_PATH = join(CLAUDE_DIR, 'daemon', 'roster.json');

// Sessione background gestita dal supervisor di `claude agents`.
export interface BgSession {
  id: string;            // short id (= nome cartella in ~/.claude/jobs)
  sessionId: string;
  name: string;          // name esplicito, o derivato dall'intent, o id
  state: string;         // running | done | failed | stopped | ...
  tempo: string;         // idle | thinking | busy
  detail: string;        // ultima riga di stato
  intent: string;        // prompt originale
  result: string | null; // output.result quando done
  cwd: string;
  projectName: string;
  template: string;      // bg | claude
  inFlightTasks: number;
  alive: boolean;        // processo attivo secondo il roster del supervisor
  pid: number | null;
  createdAt: string;
  updatedAt: string;
  needs: string | null;  // testo libero quando il worker richiede input umano (rate-limit, blocco, ecc.)
  hasPendingQuestion: boolean; // true se c'è un AskUserQuestion senza risposta
}

interface RosterWorker {
  pid?: number;
  sessionId?: string;
  cwd?: string;
}

function readRoster(): Record<string, RosterWorker> {
  if (!existsSync(ROSTER_PATH)) return {};
  try {
    const json = JSON.parse(readFileSync(ROSTER_PATH, 'utf-8')) as { workers?: Record<string, RosterWorker> };
    return json.workers ?? {};
  } catch {
    return {};
  }
}

function deriveName(state: Record<string, unknown>, id: string): string {
  const name = typeof state.name === 'string' ? state.name.trim() : '';
  if (name) return name;
  const intent = typeof state.intent === 'string' ? state.intent.trim() : '';
  if (intent) return intent.length > 60 ? intent.slice(0, 60) + '…' : intent;
  return id;
}

function readNeeds(state: Record<string, unknown>): string | null {
  const candidates = [state.needs, state.needsInput, state.awaiting];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  // pendingQuestion può essere un oggetto strutturato: ne estraiamo il prompt.
  const pq = state.pendingQuestion;
  if (pq && typeof pq === 'object') {
    const q = (pq as Record<string, unknown>).question ?? (pq as Record<string, unknown>).prompt;
    if (typeof q === 'string' && q.trim()) return q.trim();
    return 'Waiting for answer';
  }
  return null;
}

function hasPending(state: Record<string, unknown>): boolean {
  if (state.pendingQuestion && typeof state.pendingQuestion === 'object') return true;
  if (typeof state.pendingQuestion === 'string' && (state.pendingQuestion as string).trim()) return true;
  return false;
}

function readResult(output: unknown): string | null {
  if (output && typeof output === 'object' && 'result' in output) {
    const r = (output as { result?: unknown }).result;
    if (typeof r === 'string' && r.trim()) return r.trim();
  }
  return null;
}

export function getBgSessions(): BgSession[] {
  if (!existsSync(JOBS_DIR)) return [];

  const roster = readRoster();
  const sessions: BgSession[] = [];

  let entries: string[];
  try {
    entries = readdirSync(JOBS_DIR);
  } catch {
    return [];
  }

  for (const id of entries) {
    const statePath = join(JOBS_DIR, id, 'state.json');
    if (!existsSync(statePath)) continue;

    let state: Record<string, unknown>;
    try {
      state = JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }

    const worker = roster[id];
    const cwd = (state.cwd as string) ?? worker?.cwd ?? '';

    sessions.push({
      id,
      sessionId: (state.sessionId as string) ?? worker?.sessionId ?? id,
      name: deriveName(state, id),
      state: (state.state as string) ?? 'unknown',
      tempo: (state.tempo as string) ?? 'idle',
      detail: (state.detail as string) ?? '',
      intent: (state.intent as string) ?? '',
      result: readResult(state.output),
      cwd,
      projectName: cwd ? (basename(cwd) || cwd) : '',
      template: (state.template as string) ?? '',
      inFlightTasks:
        state.inFlight && typeof state.inFlight === 'object'
          ? Number((state.inFlight as { tasks?: number }).tasks ?? 0)
          : 0,
      alive: Boolean(worker?.pid),
      pid: worker?.pid ?? null,
      createdAt: (state.createdAt as string) ?? '',
      updatedAt: (state.updatedAt as string) ?? '',
      needs: readNeeds(state),
      hasPendingQuestion: hasPending(state),
    });
  }

  // Attive prima, poi per data di aggiornamento decrescente.
  return sessions.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}
