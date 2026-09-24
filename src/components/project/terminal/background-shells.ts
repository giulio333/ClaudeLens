import type { ProcessedMessage } from '../chat/utils';

/**
 * The shell commands a session left running in the background — the "1 shell"
 * Claude Code prints in its footer, which nothing in ClaudeLens used to show.
 *
 * A background shell is a `Bash` call whose result says it went on running
 * without the turn: either Claude asked for it (`run_in_background`) or the
 * harness moved it there when it outran its timeout. Both write a result naming
 * the task id — `Command running in background with ID: <id>.` or `… was moved
 * to the background (ID: <id>).` — and both end the same ways:
 *
 * - a `<task-notification>` carrying the call's `tool-use-id`, whose status is
 *   `completed`, `failed`, `stopped` or `killed` (the summary holds the exit
 *   code: `completed (exit code 0)`, `failed with exit code 1`);
 * - a successful `TaskStop` naming the task id, which writes NO notification —
 *   on disk every shell stopped that way has none, so without this rule a
 *   stopped shell would read as running for the rest of the session.
 *
 * A shell with neither is running only while the session is: the process that
 * owns it is the CLI, and a session that ended took its shells with it. That
 * half lives with the caller, which knows whether the session is live.
 *
 * This is state, not an event, which is why it stays out of Mission Control's
 * feed: it rides the session's top bar beside RUNNING.
 */

export type BackgroundShellState = 'running' | 'done' | 'failed' | 'stopped';

export type BackgroundShell = {
  toolUseId: string;
  /** The harness's task id, parsed from the result; what `TaskStop` names. */
  taskId: string | null;
  /** The `description` Claude gave the call, else the command's first line. */
  title: string;
  command: string;
  state: BackgroundShellState;
  /** Epoch ms of the turn that started it; 0 when unreadable. */
  startedAt: number;
  /** Epoch ms of the notification or the stop; absent while running. */
  endedAt?: number;
  exitCode?: number;
  /** 1-based turn index in `processed` of the call — where "Show in chat" goes. */
  turnN: number;
};

const BACKGROUND_ID_RE =
  /(?:running in background with ID: |moved to the background \(ID: )([\w-]+)/;
const EXIT_CODE_RE = /exit code (-?\d+)/i;

function epoch(ts: string | undefined): number {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function firstLine(s: string): string {
  return s.split('\n', 1)[0].trim();
}

function endState(status: string, exitCode: number | undefined): BackgroundShellState {
  if (/stop|kill/i.test(status)) return 'stopped';
  if (/fail|error/i.test(status)) return 'failed';
  return exitCode !== undefined && exitCode !== 0 ? 'failed' : 'done';
}

export function buildBackgroundShells(processed: ProcessedMessage[]): BackgroundShell[] {
  const shells: BackgroundShell[] = [];
  const byToolUseId = new Map<string, BackgroundShell>();
  const byTaskId = new Map<string, BackgroundShell>();

  processed.forEach((p, idx) => {
    for (const g of p.toolGroups) {
      if (g.use.name !== 'Bash' || !g.result || g.result.isError) continue;
      const taskId = g.result.content.match(BACKGROUND_ID_RE)?.[1] ?? null;
      if (!taskId) continue;
      const input = g.use.input as Record<string, unknown>;
      const command = typeof input.command === 'string' ? input.command : '';
      const description = typeof input.description === 'string' ? input.description.trim() : '';
      const shell: BackgroundShell = {
        toolUseId: g.use.id,
        taskId,
        title: description || firstLine(command) || 'Shell command',
        command,
        state: 'running',
        startedAt: epoch(p.msg.timestamp),
        turnN: idx + 1,
      };
      shells.push(shell);
      byToolUseId.set(shell.toolUseId, shell);
      byTaskId.set(taskId, shell);
    }
  });

  // Endings are applied in transcript order, so a later record wins — the CLI
  // re-notifies a shell on resume ("No completion record was found…").
  for (const p of processed) {
    const n = p.notification;
    if (n) {
      const shell =
        (n.toolUseId && byToolUseId.get(n.toolUseId)) || (n.taskId && byTaskId.get(n.taskId));
      if (shell) {
        const code = n.summary.match(EXIT_CODE_RE)?.[1];
        shell.exitCode = code !== undefined ? Number(code) : undefined;
        shell.state = endState(n.status, shell.exitCode);
        shell.endedAt = epoch(p.msg.timestamp);
      }
    }
    for (const g of p.toolGroups) {
      if (g.use.name !== 'TaskStop' || !g.result || g.result.isError) continue;
      const taskId = (g.use.input as Record<string, unknown>).task_id;
      const shell = typeof taskId === 'string' ? byTaskId.get(taskId) : undefined;
      if (shell && shell.state === 'running') {
        shell.state = 'stopped';
        shell.endedAt = epoch(p.msg.timestamp);
      }
    }
  }
  return shells;
}

/** How long a finished shell stays in the pill and its list. */
export const RECENT_WINDOW_MS = 10 * 60_000;

/**
 * What the top bar shows: the shells still running — only while the session
 * is live — and those that ended within the recent window, newest first.
 */
export function visibleShells(
  shells: BackgroundShell[],
  sessionLive: boolean,
  now: number
): { running: BackgroundShell[]; ended: BackgroundShell[] } {
  const running = sessionLive ? shells.filter(s => s.state === 'running') : [];
  const ended = shells
    .filter(s => s.state !== 'running' && s.endedAt && now - s.endedAt < RECENT_WINDOW_MS)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return { running, ended };
}

/** "12 min", "1 h 5 min" — plain words for the pill, never a stopwatch. */
export function spanLabel(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}
