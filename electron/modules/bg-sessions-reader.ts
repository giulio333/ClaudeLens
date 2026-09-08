import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { CLAUDE_DIR } from '../utils';
import { isPidAlive } from './sessions-registry-reader';
const JOBS_DIR = join(CLAUDE_DIR, 'jobs');
const ROSTER_PATH = join(CLAUDE_DIR, 'daemon', 'roster.json');

/** A unit of work the supervisor launched beside the turn (a shell, a fetch).
 *  A non-empty `fan` is the evidence that a worker is busy, whatever `state`
 *  says — see `src/components/project/agents-live/status.ts`. */
export interface BgFanTask {
  kind: string;
  label: string;
  /** Epoch ms. 0 when the state file carried no usable stamp — never NaN. */
  startedAt: number;
}

// Sessione background gestita dal supervisor di `claude agents`.
export interface BgSession {
  id: string; // short id (= nome cartella in ~/.claude/jobs)
  sessionId: string;
  name: string; // name esplicito, o derivato dall'intent, o id
  /** `done` | `failed` | `stopped` | `working` | `blocked` | … — an outcome
   *  name, NOT what the job is doing now. That is `tempo`. */
  state: string;
  /** `idle` | `active` | `blocked` — the live one. */
  tempo: string;
  detail: string; // ultima riga di stato: può essere la risposta dell'utente
  intent: string; // prompt originale
  initialPrompt: string; // prompt di partenza, quando l'intent non lo porta
  result: string | null; // output.result quando done
  cwd: string;
  projectName: string;
  template: string; // bg | claude | exec
  inFlightTasks: number;
  /** `inFlight.kinds` — WHICH kinds of work are in flight (`session_cron`, …),
   *  a different question from how many (`inFlightTasks` is 0 while a `fan`
   *  shell runs). Part of the recurring-job verdict. */
  inFlightKinds: string[];
  /** Work running beside the turn. */
  fan: BgFanTask[];
  /** Tokens the job has spent, when the supervisor reported them. There is no
   *  input/output/cache split here, so this can never become a dollar figure. */
  tokens: number | null;
  /** The flags a respawn would use — model, permission mode, effort. */
  respawnFlags: string[];
  /** True when the state file carries a `routine`: the job wakes on a schedule. */
  hasRoutine: boolean;
  /** True when the job re-wakes itself. */
  selfWake: boolean;
  /** The transcript the supervisor itself scans, i.e. the authoritative path.
   *  Never derived from the cwd, whose folder-name rule is lossy. */
  transcriptPath: string | null;
  alive: boolean; // processo attivo secondo il roster del supervisor
  pid: number | null;
  createdAt: string;
  updatedAt: string;
  needs: string | null; // testo libero quando il worker richiede input umano (rate-limit, blocco, ecc.)
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
    const json = JSON.parse(readFileSync(ROSTER_PATH, 'utf-8')) as {
      workers?: Record<string, RosterWorker>;
    };
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
  if (typeof state.pendingQuestion === 'string' && (state.pendingQuestion as string).trim())
    return true;
  return false;
}

function readResult(output: unknown): string | null {
  if (output && typeof output === 'object' && 'result' in output) {
    const r = (output as { result?: unknown }).result;
    if (typeof r === 'string' && r.trim()) return r.trim();
  }
  return null;
}

function readStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function readStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/** The `fan` array comes from an undocumented format: keep only the entries
 *  that can actually be shown, and never let a missing stamp become a NaN age. */
function readFan(v: unknown): BgFanTask[] {
  if (!Array.isArray(v)) return [];
  const out: BgFanTask[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const label = readStr(t.label).trim();
    const kind = readStr(t.kind).trim();
    if (!label && !kind) continue;
    const startedAt =
      typeof t.startedAt === 'number' && Number.isFinite(t.startedAt) ? t.startedAt : 0;
    out.push({ kind, label, startedAt });
  }
  return out;
}

function readInFlight(v: unknown): { tasks: number; kinds: string[] } {
  if (!v || typeof v !== 'object') return { tasks: 0, kinds: [] };
  const f = v as { tasks?: unknown; kinds?: unknown };
  // `|| 0` coerces a non-numeric tasks value (NaN) back to 0.
  return { tasks: Number(f.tasks ?? 0) || 0, kinds: readStrArray(f.kinds) };
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
    const inFlight = readInFlight(state.inFlight);

    sessions.push({
      id,
      sessionId: (state.sessionId as string) ?? worker?.sessionId ?? id,
      name: deriveName(state, id),
      state: (state.state as string) ?? 'unknown',
      tempo: (state.tempo as string) ?? 'idle',
      detail: (state.detail as string) ?? '',
      intent: (state.intent as string) ?? '',
      initialPrompt: readStr(state.initialPrompt),
      result: readResult(state.output),
      cwd,
      projectName: cwd ? basename(cwd) || cwd : '',
      template: (state.template as string) ?? '',
      inFlightTasks: inFlight.tasks,
      inFlightKinds: inFlight.kinds,
      fan: readFan(state.fan),
      tokens:
        typeof state.tokens === 'number' && Number.isFinite(state.tokens) ? state.tokens : null,
      respawnFlags: readStrArray(state.respawnFlags),
      hasRoutine: state.routine !== undefined && state.routine !== null,
      selfWake: state.selfWake === true,
      transcriptPath: readStr(state.linkScanPath) || null,
      // Probe the pid rather than trusting its mere presence in the roster: a
      // crashed worker leaves a stale pid. Treat the state field as a secondary
      // signal when the pid is gone.
      alive: worker?.pid != null && isPidAlive(worker.pid),
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
