import { exec } from 'child_process';
import { promisify } from 'util';
import { readlink } from 'fs/promises';

const execAsync = promisify(exec);

export interface ClaudeProcess {
  pid: number;
  cwd: string;
  cmdline: string;
}

/**
 * Resolve a process' working directory. On Linux the kernel exposes it as the
 * symlink /proc/<pid>/cwd — native, always available, no external binary. On
 * macOS (no /proc) we fall back to `lsof`.
 */
async function getProcessCwd(pid: number): Promise<string | null> {
  if (process.platform === 'linux') {
    try {
      return await readlink(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }
  try {
    // -a = AND semantics: intersezione di -p <pid> e -d cwd
    // -Fn = output solo il campo nome (path)
    const { stdout } = await execAsync(
      `lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n' | head -1`
    );
    return stdout.trim().replace(/^n/, '').trim();
  } catch {
    return null;
  }
}

/** True when a token names the CLI executable — bare `claude` or any path ending in it. */
function isClaudeExecutable(token: string): boolean {
  return /(^|\/)claude(-code)?$/.test(token);
}

// Carries "claude" without being a user session: the desktop app and ClaudeLens
// itself, the background-agent pty plumbing, and the shells Claude Code spawns
// for every Bash tool call — those source a snapshot under
// ~/.claude/shell-snapshots and inherit the project's cwd, so they look exactly
// like a session sitting in that folder.
const NOT_A_SESSION =
  /Applications\/Claude\.app|claudelens|esbuild|shell-snapshots|--bg-pty-host|--bg-spare|--bg-pty\b/i;

/**
 * True when a command line **is** the Claude Code CLI. The verdict is taken on
 * the executable, not on the word "claude" appearing somewhere in the line.
 *
 * That distinction is the whole point: the substring match this replaced
 * promoted any process that merely mentions claude to a live session in its own
 * cwd. Observed on this machine — `git clone …/claude-plugins.git` (three
 * processes, one per git helper), and the `/bin/zsh -c source
 * ~/.claude/shell-snapshots/…` that Claude Code spawns per Bash call. Downstream
 * it is not cosmetic: `DeleteProjectDialog` refuses to purge a project while a
 * session is live in it, so a clone running in that folder blocked the delete
 * with a session nobody was running.
 */
export function isClaudeCliCommand(cmd: string): boolean {
  const argv = cmd.trim().split(/\s+/);
  if (!argv[0] || NOT_A_SESSION.test(cmd)) return false;
  if (isClaudeExecutable(argv[0])) return true;
  // Run through an interpreter: `node …/@anthropic-ai/claude-code/cli.js`.
  if (/(^|\/)(node|bun|deno)$/.test(argv[0])) {
    return argv
      .slice(1)
      .some(arg => isClaudeExecutable(arg) || /claude[^/]*\/cli\.(js|mjs|cjs)$/.test(arg));
  }
  return false;
}

export async function findClaudeProcesses(): Promise<ClaudeProcess[]> {
  // Windows has no `ps`/`lsof`/`/proc`, and resolving an arbitrary process'
  // working directory requires native APIs (NtQueryInformationProcess). The
  // Live Monitor degrades to empty here; the rest of the app is unaffected.
  if (process.platform === 'win32') return [];

  try {
    // The grep is only a cheap pre-filter that keeps `ps -A` output small (some
    // command lines run to kilobytes); which of those lines is a session is
    // decided by `isClaudeCliCommand` below, where it can be unit-tested.
    const { stdout: psOut } = await execAsync(
      "ps -A -o pid=,args= 2>/dev/null | grep -iE '\\bclaude\\b' || true",
      { maxBuffer: 4 * 1024 * 1024 }
    );

    const lines = psOut
      .trim()
      .split('\n')
      .filter(l => l.trim());
    const results: ClaudeProcess[] = [];
    const ownPid = process.pid;

    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) continue;

      const pid = parseInt(match[1]);
      if (isNaN(pid) || pid === ownPid) continue;

      const cmdline = match[2].trim();
      if (!isClaudeCliCommand(cmdline)) continue;

      const cwd = await getProcessCwd(pid);
      if (cwd && cwd.length > 1 && cwd !== '/') {
        results.push({ pid, cwd, cmdline: cmdline.slice(0, 100) });
      }
    }

    return results;
  } catch {
    return [];
  }
}
