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
import { existsSync } from 'fs';
import { win32 as pathWin32 } from 'path';
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

// Image extensions node-pty/CreateProcess can launch directly (a PE binary).
// A `.cmd`/`.bat` shim is a script, not a PE image, so it must be run via cmd.exe.
const DIRECT_EXEC_EXTS = new Set(['.EXE', '.COM']);

/**
 * Find `claude` on the Windows PATH, honoring PATHEXT (same resolution order as
 * `where claude`: PATH dir first, then extension). Returns the resolved absolute
 * path and whether it is a directly-launchable image (`.exe`/`.com`) versus a
 * shim (`.cmd`/`.bat`) that needs a cmd.exe wrapper. Injectable for tests.
 */
export function findClaudeOnWindowsPath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync
): { path: string; direct: boolean } | null {
  const pathVar = env.Path ?? env.PATH ?? '';
  const pathExt = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  // Windows semantics regardless of the host OS (win32-only fn; keeps unit tests
  // deterministic on a Linux/macOS CI runner): `;` PATH delimiter, `\` joins.
  for (const dir of pathVar.split(pathWin32.delimiter).filter(Boolean)) {
    for (const ext of pathExt) {
      const candidate = pathWin32.join(dir, `claude${ext}`);
      if (exists(candidate)) {
        return { path: candidate, direct: DIRECT_EXEC_EXTS.has(ext.toUpperCase()) };
      }
    }
  }
  return null;
}

// Build the executable + args to launch the interactive `claude` CLI in a PTY.
// On Windows we PREFER launching the native `claude.exe` directly: node-pty then
// reports the CLI's OWN pid — the pid the session registry
// (`~/.claude/sessions/<pid>.json`) is keyed by — so the Lens / Mission Control
// pid-match resolves this terminal's session (transcript + rail render). The
// older npm install ships `claude.cmd`, a batch shim node-pty/CreateProcess
// cannot launch directly (not a PE image → "File not found"); that still routes
// through cmd.exe (`cmd /c claude …`, resolved on PATH, same ConPTY for the TUI),
// where the reported pid is the cmd.exe wrapper's — the registry misses it and
// the renderer falls back to matching by cwd (see TerminalMissionControl). On
// POSIX the binary is exec'd directly. Pure + exported so it is unit/integration
// testable on its own; the PATH lookup is injectable.
export function resolveClaudeCommand(
  args: string[] = [],
  find: typeof findClaudeOnWindowsPath = findClaudeOnWindowsPath
): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    const resolved = find();
    if (resolved?.direct) return { command: resolved.path, args };
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/c', 'claude', ...args] };
  }
  return { command: 'claude', args };
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
  // On POSIX — and on Windows when the native `claude.exe` was launched directly
  // (see resolveClaudeCommand) — the pid IS the CLI process itself, which the
  // renderer matches against the active-sessions registry to pin this session.
  // Only a legacy `claude.cmd` install still wraps in cmd.exe, so the pid is the
  // shim's; there the renderer falls back to matching by cwd.
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
