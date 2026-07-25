// Lancio centralizzato della CLI `claude` (#60, epic #50). Su Windows la CLI è
// installata come `claude.cmd` (shim batch): spawn/execFile di Node senza
// `shell: true` non risolvono `.cmd` via PATHEXT (ENOENT), e da Node 18.20+
// spawnare direttamente un `.cmd` senza shell è comunque bloccato (EINVAL,
// CVE-2024-27980). `shell: true` è deliberatamente evitato — il quoting degli
// argomenti utente diventerebbe fragile. cross-spawn risolve lo shim e quota
// gli argv correttamente senza shell; su macOS/Linux è identico a
// child_process.spawn, incluso l'errore ENOENT quando la CLI manca dal PATH
// (che cross-spawn emula anche su Windows).
import spawn from 'cross-spawn';
import type { ChildProcess } from 'child_process';

export interface ClaudeSpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Percorso esplicito della CLI. Serve all'app pacchettizzata, dove `claude`
   * può non essere nel PATH del processo Electron ma il binario è comunque
   * disponibile unpacked (`resolveClaudeExecutablePath`). Assente = `claude`.
   */
  executable?: string;
}

// Processo streaming (stdin/stdout live), stile child_process.spawn.
export function spawnClaude(args: string[], opts: ClaudeSpawnOptions = {}): ChildProcess {
  return spawn(opts.executable || 'claude', args, { cwd: opts.cwd, env: opts.env });
}

export interface ExecClaudeError extends Error {
  code?: string;
  exitCode?: number | null;
  stderr?: string;
}

// Esecuzione bufferizzata stile promisify(execFile): risolve con stdout/stderr
// a exit 0, rigetta con un errore che porta `code` (ENOENT incluso) e `stderr`.
export function execClaude(
  args: string[],
  opts: ClaudeSpawnOptions & { maxBuffer?: number; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const maxBuffer = opts.maxBuffer ?? 1024 * 1024;
  return new Promise((resolve, reject) => {
    const proc = spawnClaude(args, opts);
    let stdout = '';
    let stderr = '';
    let settled = false;
    // Comandi come `mcp list` fanno health check di rete: senza un tetto, una
    // CLI che non termina lascerebbe la promise appesa per sempre.
    const timer = opts.timeout
      ? setTimeout(() => {
          proc.kill();
          fail(
            Object.assign(new Error(`claude timed out after ${opts.timeout}ms`), {
              code: 'ETIMEDOUT',
            })
          );
        }, opts.timeout)
      : undefined;

    const fail = (e: ExecClaudeError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (e.stderr === undefined) e.stderr = stderr;
      reject(e);
    };
    const overflow = () => {
      proc.kill();
      fail(
        Object.assign(new Error('stdout/stderr maxBuffer exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        })
      );
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > maxBuffer) overflow();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > maxBuffer) overflow();
    });
    proc.on('error', e => fail(e as ExecClaudeError));
    proc.on('close', code => {
      if (settled) return;
      if (code === 0) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr });
      } else {
        fail(Object.assign(new Error(`claude exited with code ${code}`), { exitCode: code }));
      }
    });
  });
}
