import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ClaudeProcess {
  pid: number;
  cwd: string;
  cmdline: string;
}

export async function findClaudeProcesses(): Promise<ClaudeProcess[]> {
  try {
    // Cattura anche il bare command "claude" (senza path), esclude Claude.app desktop e ClaudeLens
    const { stdout: psOut } = await execAsync(
      "ps -A -o pid=,args= 2>/dev/null | grep -iE '\\bclaude\\b' | grep -ivE 'Applications/Claude\\.app|claudelens|esbuild' || true"
    );

    const lines = psOut.trim().split('\n').filter(l => l.trim());
    const results: ClaudeProcess[] = [];
    const ownPid = process.pid;

    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) continue;

      const pid = parseInt(match[1]);
      if (isNaN(pid) || pid === ownPid) continue;

      const cmdline = match[2].trim();

      try {
        // -a = AND semantics: intersezione di -p <pid> e -d cwd
        // -Fn = output solo il campo nome (path)
        const { stdout: lsofOut } = await execAsync(
          `lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n' | head -1`
        );
        const cwd = lsofOut.trim().replace(/^n/, '').trim();
        if (cwd && cwd.length > 1 && cwd !== '/') {
          results.push({ pid, cwd, cmdline: cmdline.slice(0, 100) });
        }
      } catch {
        // Processo terminato o permesso negato
      }
    }

    return results;
  } catch {
    return [];
  }
}
