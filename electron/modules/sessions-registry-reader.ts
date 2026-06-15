import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { findClaudeProcesses } from './process-scanner';
import { CLAUDE_DIR } from '../utils';

// Claude Code 2.x mantiene un registro delle sessioni vive: un file JSON per
// processo in ~/.claude/sessions/<pid>.json, con sessionId, cwd, status
// (busy/waiting + waitingFor) e heartbeat updatedAt. È un formato interno non
// documentato — come i .jsonl dei transcript — quindi qui si valida ogni campo
// e si degrada con grazia: directory assente o vuota → fallback al
// process-scanner (ps + lsof), che resta l'unica via per CLI pre-2.x.

export interface ActiveSession {
  pid: number;
  /** Empty when the entry comes from the process-scanner fallback. */
  sessionId: string;
  cwd: string;
  /** Epoch ms; undefined when unknown (fallback entries). */
  startedAt?: number;
  /** Known values: 'busy', 'waiting', 'idle'. 'unknown' for fallback entries. */
  status: string;
  /** What the session is blocked on when status is 'waiting' (e.g. "permission prompt"). */
  waitingFor?: string;
  /** Claude Code version that wrote the entry. */
  version?: string;
  /** Epoch ms of the last registry heartbeat. */
  updatedAt?: number;
  source: 'registry' | 'process-scan';
}

export function defaultSessionsDir(): string {
  // Derive from the same root as the rest of the app so a relocated
  // CLAUDE_CONFIG_DIR is honored (otherwise the registry watch/read silently
  // point at ~/.claude/sessions and degrade to the process-scanner fallback).
  return join(CLAUDE_DIR, 'sessions');
}

/** True when a process with this pid exists (signal 0 probes without killing). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but belongs to another user.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Validate a raw registry entry. Returns null for malformed entries and for
 * non-CLI sessions (e.g. SDK-spawned ones, like ClaudeLens' own chat): the
 * Live views show what the user runs in a terminal, matching the old
 * process-scanner behavior that excluded ClaudeLens' children.
 */
export function parseRegistryEntry(raw: unknown): ActiveSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.pid !== 'number' || !Number.isInteger(r.pid) || r.pid <= 0) return null;
  if (typeof r.sessionId !== 'string' || r.sessionId.length === 0) return null;
  if (typeof r.cwd !== 'string' || r.cwd.length <= 1) return null;
  if (r.entrypoint !== undefined && r.entrypoint !== 'cli') return null;

  return {
    pid: r.pid,
    sessionId: r.sessionId,
    cwd: r.cwd,
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : undefined,
    status: typeof r.status === 'string' && r.status ? r.status : 'unknown',
    waitingFor: typeof r.waitingFor === 'string' ? r.waitingFor : undefined,
    version: typeof r.version === 'string' ? r.version : undefined,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : undefined,
    source: 'registry',
  };
}

// The registry heartbeats every few seconds; treat an entry whose last
// updatedAt is older than this as stale. This is immune to pid reuse (a crashed
// session's <pid>.json whose pid the OS later reassigns to an unrelated process
// would otherwise pass the pid probe and be shown as live, then tailed).
const HEARTBEAT_STALE_MS = 60_000;

export interface ReadActiveSessionsOptions {
  dir?: string;
  /** Injectable for tests. */
  pidAlive?: (pid: number) => boolean;
  /** Injectable for tests (defaults to Date.now()). */
  now?: () => number;
}

export async function readActiveSessions(
  options: ReadActiveSessionsOptions = {}
): Promise<ActiveSession[]> {
  const dir = options.dir ?? defaultSessionsDir();
  const pidAlive = options.pidAlive ?? isPidAlive;
  const now = options.now ?? Date.now;

  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter(f => f.endsWith('.json'));
  } catch {
    // Directory missing: Claude Code < 2.x — scanner fallback below.
  }

  const sessions: ActiveSession[] = [];
  for (const file of files) {
    try {
      const parsed = parseRegistryEntry(JSON.parse(await readFile(join(dir, file), 'utf-8')));
      if (!parsed) continue;
      // A crashed session leaves its file behind: the pid probe filters most out.
      if (!pidAlive(parsed.pid)) continue;
      // The heartbeat is the registry's own liveness signal and survives pid
      // reuse. Drop entries that haven't heartbeated recently; keep entries with
      // no updatedAt (older CLI) and rely on the pid probe alone for those.
      if (parsed.updatedAt !== undefined && now() - parsed.updatedAt > HEARTBEAT_STALE_MS) continue;
      sessions.push(parsed);
    } catch {
      // Malformed or mid-write file: skip it.
    }
  }
  if (sessions.length > 0) {
    return sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }

  // No registry entries: either nothing is running or the CLI predates the
  // registry. The scanner distinguishes the two (and returns [] on Windows).
  const procs = await findClaudeProcesses();
  return procs.map(p => ({
    pid: p.pid,
    sessionId: '',
    cwd: p.cwd,
    status: 'unknown',
    source: 'process-scan' as const,
  }));
}
