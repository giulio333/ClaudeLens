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
 * A shell with neither is running only if the CLI process running the session
 * now is the one that started it: a shell is that process's child, and one
 * started before it — a resumed session carries the shells of the process
 * that exited — died with its parent. On disk 5 of the 122 background shells
 * have no ending at all, and the resume notice that marks them stopped is no
 * help here: it arrives late and lists several task ids, of which
 * `parseTaskNotification` keeps the first. So the caller passes the live
 * process's start time and `visibleShells` keeps only what began after it.
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
  /** How it got there: Claude asked (`run_in_background`), or the harness
   *  moved it when it outran `timeoutS`. Read off the result's sentence. */
  via: 'requested' | 'timeout';
  timeoutS?: number;
  /** Where the harness writes its output, as the result names it. */
  outputFile?: string;
  /** Ended by a `TaskStop` call — the one ending whose author is on record. */
  stoppedByClaude?: true;
};

const BACKGROUND_ID_RE =
  /(?:running in background with ID: |moved to the background \(ID: )([\w-]+)/;
const EXIT_CODE_RE = /exit code (-?\d+)/i;
const TIMEOUT_RE = /within its (\d+)s timeout/;
const OUTPUT_FILE_RE = /Output is being written to: (\S+?)\.?(?:\s|$)/;

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

  for (const p of processed) {
    for (const g of p.toolGroups) {
      if (g.use.name !== 'Bash' || !g.result || g.result.isError) continue;
      const taskId = g.result.content.match(BACKGROUND_ID_RE)?.[1] ?? null;
      if (!taskId) continue;
      const input = g.use.input as Record<string, unknown>;
      const command = typeof input.command === 'string' ? input.command : '';
      const description = typeof input.description === 'string' ? input.description.trim() : '';
      const timeout = g.result.content.match(TIMEOUT_RE)?.[1];
      const outputFile = g.result.content.match(OUTPUT_FILE_RE)?.[1];
      const shell: BackgroundShell = {
        toolUseId: g.use.id,
        taskId,
        title: description || firstLine(command) || 'Shell command',
        command,
        state: 'running',
        startedAt: epoch(p.msg.timestamp),
        via: timeout ? 'timeout' : 'requested',
        ...(timeout ? { timeoutS: Number(timeout) } : {}),
        ...(outputFile ? { outputFile } : {}),
      };
      shells.push(shell);
      byToolUseId.set(shell.toolUseId, shell);
      byTaskId.set(taskId, shell);
    }
  }

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
        shell.stoppedByClaude = true;
        shell.endedAt = epoch(p.msg.timestamp);
      }
    }
  }
  return shells;
}

/** How long a finished shell stays in the pill and its list. */
export const RECENT_WINDOW_MS = 10 * 60_000;

/**
 * What the top bar shows: the shells the live CLI process started — running,
 * or ended within the recent window, newest first. `liveSince` is when that
 * process started; null when the session is not running, which shows nothing.
 */
export function visibleShells(
  shells: BackgroundShell[],
  liveSince: number | null,
  now: number
): { running: BackgroundShell[]; ended: BackgroundShell[] } {
  if (liveSince === null) return { running: [], ended: [] };
  const own = shells.filter(s => s.startedAt >= liveSince);
  const running = own.filter(s => s.state === 'running');
  const ended = own
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

/** What each ending is called, in the pill and on the page. */
export const STATE_WORD: Record<BackgroundShellState, string> = {
  running: 'Running',
  done: 'Finished',
  failed: 'Failed',
  stopped: 'Stopped',
};

/**
 * One line on where a shell stands. When it ended comes first, how long it
 * ran second: "Finished after 20 min" read as twenty minutes ago on a command
 * that had just ended.
 */
export function shellStatusLine(s: BackgroundShell, now: number): string {
  if (s.state === 'running') return `Running for ${spanLabel(now - s.startedAt)}`;
  const when = s.endedAt ? ` ${spanLabel(now - s.endedAt)} ago` : '';
  const ran = s.endedAt && s.startedAt ? ` · ran ${spanLabel(s.endedAt - s.startedAt)}` : '';
  const code = s.state === 'failed' && s.exitCode !== undefined ? ` · exit code ${s.exitCode}` : '';
  return `${STATE_WORD[s.state]}${when}${ran}${code}`;
}
