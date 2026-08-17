import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { findClaudeProcesses, isClaudeCliCommand } from './process-scanner';
import { CLAUDE_DIR } from '../utils';

const execFileAsync = promisify(execFile);

// Claude Code 2.x mantiene un registro delle sessioni vive: un file JSON per
// processo in ~/.claude/sessions/<pid>.json, con sessionId, cwd, status
// (busy/waiting + waitingFor) e updatedAt. È un formato interno non
// documentato — come i .jsonl dei transcript — quindi qui si valida ogni campo
// e si degrada con grazia: directory assente o vuota → fallback al
// process-scanner (ps + lsof), che resta l'unica via per CLI pre-2.x.
//
// ATTENZIONE (verificato dal vivo su 2.1.198): updatedAt NON è un heartbeat
// periodico — il CLI riscrive il file solo ai cambi di stato (busy↔waiting).
// Durante un turno lungo, o con una sessione ferma in waiting, il file resta
// intatto per minuti/ore. Qualsiasi soglia temporale su updatedAt scarta
// quindi sessioni perfettamente vive; la liveness va decisa dal processo.

export interface ActiveSession {
  pid: number;
  /** Empty when the entry comes from the process-scanner fallback. */
  sessionId: string;
  cwd: string;
  /** Human-readable session name the CLI derives (e.g. "claudelens-b4"). The
   *  Monitor titles its rows with this instead of a truncated UUID. Absent on
   *  fallback entries and on CLIs that predate the field. */
  name?: string;
  /** 'interactive' for a terminal session; other values exist for non-tty runs. */
  kind?: string;
  /** Epoch ms; undefined when unknown (fallback entries). */
  startedAt?: number;
  /** Known values: 'busy', 'waiting', 'idle'. 'unknown' for fallback entries. */
  status: string;
  /** What the session is blocked on when status is 'waiting' (e.g. "permission prompt"). */
  waitingFor?: string;
  /** Claude Code version that wrote the entry. */
  version?: string;
  /** Epoch ms of the last registry write (status transitions — NOT a periodic
   *  heartbeat: a busy or waiting session can leave this untouched for hours). */
  updatedAt?: number;
  /** Epoch ms of the last status transition. Same caveat as `updatedAt`: it
   *  dates the transition INTO the current status, so it answers "waiting since
   *  when", never "still alive as of when". */
  statusUpdatedAt?: number;
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
    name: typeof r.name === 'string' && r.name ? r.name : undefined,
    kind: typeof r.kind === 'string' && r.kind ? r.kind : undefined,
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : undefined,
    status: typeof r.status === 'string' && r.status ? r.status : 'unknown',
    waitingFor: typeof r.waitingFor === 'string' ? r.waitingFor : undefined,
    version: typeof r.version === 'string' ? r.version : undefined,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : undefined,
    statusUpdatedAt: typeof r.statusUpdatedAt === 'number' ? r.statusUpdatedAt : undefined,
    source: 'registry',
  };
}

/** Command line of each given pid (one `ps` call for all of them). Guards the
 *  pid probe against pid reuse: a crashed session's `<pid>.json` whose pid the
 *  OS later reassigns to an unrelated process would otherwise be shown as live,
 *  then tailed. The registry is keyed by pid, so a live pid that still runs a
 *  claude CLI can only be the entry's own process — a newer claude session with
 *  the same pid would have overwritten the file.
 *
 *  Returns null when the check can't run (Windows has no `ps`; ps missing or
 *  failing) — callers then fall back to the pid probe alone. */
async function readPidCommands(pids: number[]): Promise<Map<number, string> | null> {
  if (process.platform === 'win32' || pids.length === 0) return null;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('ps', ['-o', 'pid=,args=', '-p', pids.join(',')]));
  } catch (e) {
    // ps exits non-zero when some of the pids are gone but still prints the
    // live ones; a missing/failed ps yields no output at all.
    stdout = (e as { stdout?: string }).stdout ?? '';
    if (!stdout) return null;
  }
  const commands = new Map<number, string>();
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m) commands.set(parseInt(m[1], 10), m[2].trim());
  }
  return commands;
}

export interface ReadActiveSessionsOptions {
  dir?: string;
  /** Injectable for tests. */
  pidAlive?: (pid: number) => boolean;
  /** Injectable for tests. */
  pidCommands?: (pids: number[]) => Promise<Map<number, string> | null>;
}

export async function readActiveSessions(
  options: ReadActiveSessionsOptions = {}
): Promise<ActiveSession[]> {
  const dir = options.dir ?? defaultSessionsDir();
  const pidAlive = options.pidAlive ?? isPidAlive;
  const pidCommands = options.pidCommands ?? readPidCommands;

  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter(f => f.endsWith('.json'));
  } catch {
    // Directory missing: Claude Code < 2.x — scanner fallback below.
  }

  const candidates: ActiveSession[] = [];
  for (const file of files) {
    try {
      const parsed = parseRegistryEntry(JSON.parse(await readFile(join(dir, file), 'utf-8')));
      if (!parsed) continue;
      // A crashed session leaves its file behind: the pid probe filters most out.
      if (!pidAlive(parsed.pid)) continue;
      candidates.push(parsed);
    } catch {
      // Malformed or mid-write file: skip it.
    }
  }

  // Pid-reuse guard: the surviving pids must still run a claude CLI. Where the
  // check can't run (Windows) the pid probe alone decides.
  const commands = await pidCommands(candidates.map(s => s.pid));
  const sessions =
    commands === null
      ? candidates
      : candidates.filter(s => {
          const cmd = commands.get(s.pid);
          return cmd !== undefined && isClaudeCliCommand(cmd);
        });

  // A populated registry dir means a 2.x CLI owns liveness: entries filtered
  // out above are dead sessions, not a reason to guess with the scanner (whose
  // entries carry no sessionId and would poison consumers that match on it).
  if (files.length > 0) {
    return sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }

  // No registry at all: either nothing is running or the CLI predates the
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
