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

export async function findClaudeProcesses(): Promise<ClaudeProcess[]> {
  // Windows has no `ps`/`lsof`/`/proc`, and resolving an arbitrary process'
  // working directory requires native APIs (NtQueryInformationProcess). The
  // Live Monitor degrades to empty here; the rest of the app is unaffected.
  if (process.platform === 'win32') return [];

  try {
    // Cattura anche il bare command "claude" (senza path), esclude Claude.app desktop, ClaudeLens
    // e il plumbing del daemon background agent (--bg-pty-host / --bg-spare): non sono sessioni utente.
    const { stdout: psOut } = await execAsync(
      "ps -A -o pid=,args= 2>/dev/null | grep -iE '\\bclaude\\b' | grep -ivE 'Applications/Claude\\.app|claudelens|esbuild|--bg-pty-host|--bg-spare|--bg-pty' || true"
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
