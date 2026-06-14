// Embedded-terminal backend: spawns the *interactive* `claude` CLI inside a
// real PTY (node-pty) and shuttles raw bytes to/from the renderer's xterm.
//
// This is deliberately NOT the Agent SDK path (`chat-runner.ts`). An SDK
// session is billed against the per-plan Agent SDK monthly credit (June 2026
// billing split), while the interactive CLI in a terminal draws from the
// subscription's usage limits — exactly like running `claude` in iTerm or the
// VS Code terminal. ClaudeLens only hosts the terminal emulator; the stock CLI
// runs untouched (entrypoint `cli`, native session registry, same `.jsonl`
// transcript the rest of the app reads).
//
// node-pty 1.x is N-API based: the shipped prebuild loads in Electron without
// an ABI rebuild. It is still a native module, so it is `require`d lazily —
// a load failure (unsupported platform, missing prebuild) surfaces as an IPC
// error on first use instead of crashing the main process at boot.

import { randomUUID } from 'crypto';
import type { IPty } from 'node-pty';

export interface TerminalCallbacks {
  /** Raw output bytes (already utf8 strings) to feed straight into xterm. */
  onData: (data: string) => void;
  /** The CLI process ended (user typed exit, /quit, crash…). */
  onExit: (exitCode: number) => void;
}

export interface CreateTerminalOptions {
  cwd: string;
  /** Executable to run inside the PTY (resolved via PATH). */
  command: string;
  args?: string[];
  env: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

const terminals = new Map<string, IPty>();

// `process.env` values can be undefined; node-pty wants a string-only record.
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function createTerminal(
  opts: CreateTerminalOptions,
  callbacks: TerminalCallbacks
): { id: string; pid: number } {
  // Lazy native-module load — see header comment.
  const pty = require('node-pty') as typeof import('node-pty');

  const id = randomUUID();
  const term = pty.spawn(opts.command, opts.args ?? [], {
    name: 'xterm-256color',
    cwd: opts.cwd,
    env: cleanEnv(opts.env),
    cols: opts.cols && opts.cols > 0 ? Math.floor(opts.cols) : 80,
    rows: opts.rows && opts.rows > 0 ? Math.floor(opts.rows) : 24,
  });

  terminals.set(id, term);
  term.onData(callbacks.onData);
  term.onExit(({ exitCode }) => {
    terminals.delete(id);
    callbacks.onExit(exitCode);
  });
  // The pid is the CLI process itself (spawned directly, no shell in between):
  // the renderer uses it to find this session in the active-sessions registry.
  return { id, pid: term.pid };
}

export function writeTerminal(id: string, data: string): void {
  terminals.get(id)?.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return;
  terminals.get(id)?.resize(Math.floor(cols), Math.floor(rows));
}

export function killTerminal(id: string): void {
  const term = terminals.get(id);
  if (!term) return;
  terminals.delete(id);
  const { pid } = term;
  try {
    // node-pty defaults to SIGHUP, which the interactive `claude` CLI can trap
    // and survive; ask for SIGTERM explicitly (Windows ConPTY ignores the arg).
    term.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  } catch {
    // The PTY may already be gone — nothing to do.
  }
  // Escalate: if the CLI trapped the signal and is still alive after a short
  // grace period, force it down so no `claude` ever outlives its terminal pane.
  if (process.platform !== 'win32') {
    setTimeout(() => {
      try {
        process.kill(pid, 0); // throws if the process is already gone
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already exited — good.
      }
    }, 2000);
  }
}

/** App shutdown: make sure no orphan `claude` processes outlive the window. */
export function disposeAllTerminals(): void {
  for (const id of [...terminals.keys()]) killTerminal(id);
}
