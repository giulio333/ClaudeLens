import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../../../hooks/useTheme';

/**
 * The terminal "dumb pipe": an xterm.js emulator wired to the interactive
 * `claude` CLI running in a real PTY (`terminal:*` IPC → node-pty in the main
 * process). Keystrokes go down `terminal:write`, raw PTY bytes come back on
 * `terminal:data`. The PTY's lifetime is bound to this component — unmounting
 * kills the process, like closing a terminal window.
 *
 * The console follows the app theme (light/dark): xterm reports its background
 * color to the `claude` CLI via OSC 11, and the CLI picks its TUI palette from
 * that — so a light slab makes the TUI render light and a dark slab dark. We
 * give xterm concrete colors drawn from the brand `--cl-paper`/`--cl-ink`
 * surfaces and a terracotta cursor in both themes. The parent
 * (TerminalMissionControl) owns the framing and the session-id discovery —
 * this component just reports its PTY `pid` and `status` up.
 */

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'error';

const STATUS_LABEL: Record<TerminalStatus, string> = {
  starting: 'Starting…',
  running: 'Running',
  exited: 'Ended',
  error: 'Error',
};

// Per-theme terminal palettes — the brand surfaces (`--cl-paper-2`/`--cl-ink`)
// plus a terracotta cursor. xterm needs concrete colors; `scrim`/`muted`/`body`
// drive the exit overlay so it sits on the matching ground. The `term` field is
// the xterm theme; the CLI reads `term.background` (OSC 11) to pick its palette.
const PALETTES = {
  dark: {
    term: {
      background: '#262421',
      foreground: '#cfccc3',
      cursor: '#C15F3C',
      cursorAccent: '#262421',
      selectionBackground: 'rgba(193, 95, 60, 0.28)',
    },
    scrim: 'color-mix(in srgb, #262421 82%, transparent)',
    muted: '#8d897f',
    body: '#cfccc3',
  },
  light: {
    term: {
      background: '#FFFFFF',
      foreground: '#2b2722',
      cursor: '#C15F3C',
      cursorAccent: '#FFFFFF',
      selectionBackground: 'rgba(193, 95, 60, 0.20)',
    },
    scrim: 'color-mix(in srgb, #FFFFFF 82%, transparent)',
    muted: '#7c7669',
    body: '#2b2722',
  },
} as const;

// The terminal's surface color per theme — exported so the unified Terminal/Lens
// view can paint its frame the same color when TERMINAL is active (seamless edge,
// matches in both light and dark since it's the very color xterm renders).
const TERMINAL_SURFACE: Record<'light' | 'dark', string> = {
  light: PALETTES.light.term.background,
  dark: PALETTES.dark.term.background,
};

export function TerminalPane({
  cwd,
  resumeSessionId,
  onPid,
  onStatus,
}: {
  cwd: string;
  resumeSessionId?: string;
  /** Report the PTY pid so the parent can match it to the active-sessions registry. */
  onPid: (pid: number | null) => void;
  /** Surface lifecycle so the parent's chrome (RUNNING indicator) can react. */
  onStatus?: (status: TerminalStatus) => void;
}) {
  const { resolved } = useTheme();
  const palette = PALETTES[resolved];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  // Bumped on every cleanup so a `terminal.create` that resolves *after* this
  // pane is gone can tell its generation is stale and kill the orphan PTY rather
  // than leak it — covers the navigate-away race and StrictMode's dev double-mount.
  const genRef = useRef(0);
  // The mount-only PTY effect runs once; read the current palette through a ref
  // so it seeds the Terminal with the live theme without re-subscribing.
  const paletteRef = useRef(palette);
  // PTY output can race the `terminal:create` invoke result: the main process
  // starts pushing `terminal:data` as soon as the CLI prints, possibly before
  // the renderer learns its terminal id. Park unmatched chunks here and flush
  // them once the id arrives.
  const earlyRef = useRef<Array<{ id: string; data: string }>>([]);
  const onPidRef = useRef(onPid);
  const [status, setStatus] = useState<TerminalStatus>('starting');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest onPid in a ref so the mount-only PTY effect can report the
  // pid without re-subscribing (updating a ref during render is disallowed).
  useEffect(() => {
    onPidRef.current = onPid;
  }, [onPid]);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  // Re-theme the live terminal when the app theme flips. The already-running
  // CLI detected its TUI palette from the boot-time background (OSC 11) and
  // won't re-query, but the xterm chrome (background/foreground/cursor) tracks
  // the app so it never looks stranded on the wrong ground.
  useEffect(() => {
    paletteRef.current = palette;
    if (termRef.current) termRef.current.options.theme = palette.term;
  }, [palette]);

  const startSession = useCallback(
    async (resume?: string) => {
      const term = termRef.current;
      if (!term || idRef.current) return;
      const gen = genRef.current;
      setStatus('starting');
      setError(null);
      setExitCode(null);
      const res = await window.electronAPI.terminal.create({
        cwd,
        resumeSessionId: resume,
        cols: term.cols,
        rows: term.rows,
      });
      // Stale generation: the pane unmounted (or StrictMode re-mounted) while the
      // PTY was being created, so the cleanup ran before there was an id to kill.
      // Kill the just-spawned process now instead of leaking an orphan `claude`.
      if (gen !== genRef.current) {
        if (res.data) void window.electronAPI.terminal.kill(res.data.id);
        return;
      }
      if (res.error || !res.data) {
        setError(res.error || 'Failed to start the claude CLI.');
        setStatus('error');
        return;
      }
      idRef.current = res.data.id;
      onPidRef.current(res.data.pid);
      for (const chunk of earlyRef.current) {
        if (chunk.id === res.data.id) term.write(chunk.data);
      }
      earlyRef.current = [];
      setStatus('running');
      term.focus();
    },
    [cwd]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
      fontSize: 11,
      cursorBlink: true,
      scrollback: 10000,
      theme: paletteRef.current.term,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData(data => {
      if (idRef.current) void window.electronAPI.terminal.write(idRef.current, data);
    });

    const disposeData = window.electronAPI.terminal.onData((id, data) => {
      if (idRef.current === null) {
        earlyRef.current.push({ id, data });
        return;
      }
      if (id === idRef.current) termRef.current?.write(data);
    });
    const disposeExit = window.electronAPI.terminal.onExit((id, code) => {
      if (id !== idRef.current) return;
      idRef.current = null;
      onPidRef.current(null);
      setExitCode(code);
      setStatus('exited');
    });

    const ro = new ResizeObserver(() => {
      // The parent toggles the pane with `display:none` (Terminal ↔ Lens switch),
      // which fires the observer with a 0×0 box. FitAddon doesn't no-op on a
      // zero-width parent — it clamps to MINIMUM_COLS (2), reflowing the buffer
      // and resizing the PTY to ~2 cols, which mangles the TUI. Skip the fit
      // while hidden; the observer fires again with the real box on re-show.
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      fitRef.current?.fit();
      const t = termRef.current;
      if (idRef.current && t)
        void window.electronAPI.terminal.resize(idRef.current, t.cols, t.rows);
    });
    ro.observe(el);

    void startSession(resumeSessionId);

    return () => {
      // Invalidate this mount's generation: any in-flight create now resolves as
      // stale and kills its own PTY (see startSession), so none leaks.
      genRef.current += 1;
      ro.disconnect();
      // Drop this pane's PTY IPC listeners so they stop writing into its
      // (now unmounted) refs. Each subscribe returned a disposer that removes only
      // its own handler — a parallel terminal pane keeps its listeners intact.
      disposeData();
      disposeExit();
      if (idRef.current) void window.electronAPI.terminal.kill(idRef.current);
      idRef.current = null;
      onPidRef.current(null);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Mount-only: the PTY's lifetime is the view's lifetime, like a terminal window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: palette.term.background,
        padding: '14px 16px 10px',
      }}
    >
      <div ref={containerRef} className="h-full w-full" />
      {(status === 'exited' || status === 'error') && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: palette.scrim }}
        >
          <div className="text-center" style={{ maxWidth: 420 }}>
            <div
              className="font-mono uppercase"
              style={{
                fontSize: 11,
                letterSpacing: '0.18em',
                color: palette.muted,
                marginBottom: 6,
              }}
            >
              {status === 'error' ? 'FAILED TO START' : 'SESSION ENDED'}
            </div>
            <div style={{ fontSize: 13, color: palette.body, marginBottom: 16 }}>
              {status === 'error'
                ? error
                : exitCode
                  ? `The claude process exited with code ${exitCode}.`
                  : 'The claude process exited.'}
            </div>
            <button
              className="cl-btn cl-btn--primary"
              type="button"
              onClick={() => {
                termRef.current?.reset();
                void startSession();
              }}
            >
              {status === 'error' ? 'Retry' : 'New session'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { STATUS_LABEL, TERMINAL_SURFACE };
