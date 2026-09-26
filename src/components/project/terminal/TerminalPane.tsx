import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../../../hooks/useTheme';
import { trackEvent } from '../../../lib/telemetry';
import { PALETTES, type TerminalStatus } from './terminal-theme';
import { createTerminalPromptController, type TerminalPromptHandle } from './terminal-prompt';
import { makeLinkHandler, parseOsc52 } from './terminal-osc';
import type { RemoteLaunchMode } from '../../../../electron/shared/remote-host';

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

export type { TerminalStatus } from './terminal-theme';

/** The same pane on another machine, over the system ssh (#242). */
export interface RemoteTerminalLaunch {
  hostId: string;
  mode: RemoteLaunchMode;
  dir?: string;
  /** Oldest Claude Code the remote may run — the host is refused below it. */
  minVersion?: string;
}

// Clipboard wiring is a Windows/Linux-only concern (see the mount effect): on
// macOS xterm leaves a Cmd+V keydown alone and Chromium pastes into the helper
// textarea by itself, so that path stays untouched.
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export function TerminalPane({
  ref,
  cwd,
  resumeSessionId,
  attachJobId,
  onPid,
  onStatus,
  remote,
  onExit,
  hideExitOverlay,
  onTerminalId,
}: {
  ref?: Ref<TerminalPromptHandle>;
  /** Local working directory; with `remote` set it is a label only. */
  cwd: string;
  resumeSessionId?: string;
  /** Live background-agent job id: `claude attach` it instead of `--resume`. */
  attachJobId?: string;
  /** Report the PTY pid so the parent can match it to the active-sessions registry. */
  onPid: (pid: number | null) => void;
  /** Surface lifecycle so the parent's chrome (RUNNING indicator) can react. */
  onStatus?: (status: TerminalStatus) => void;
  /** Run Claude Code on a remote host instead of locally. Fixed for the pane's
   *  lifetime: a parent that changes it remounts the pane (a new `key`). */
  remote?: RemoteTerminalLaunch;
  /** The process ended, with its exit code. */
  onExit?: (exitCode: number) => void;
  /** Leave the ended session's output uncovered: the parent says what happened
   *  and offers what to do next. A failure to start keeps its own notice. */
  hideExitOverlay?: boolean;
  /** The pane's terminal id once the PTY exists, null when it is gone — what a
   *  remote pane's Lens is keyed on in the main process (#294). */
  onTerminalId?: (id: string | null) => void;
}) {
  const { resolved } = useTheme();
  const palette = PALETTES[resolved];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  const promptRef = useRef<ReturnType<typeof createTerminalPromptController> | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      pastePrompt: (text, signal) =>
        promptRef.current?.pastePrompt(text, signal) ??
        Promise.reject(new Error('The terminal is not mounted yet. Try again.')),
    }),
    []
  );
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
  const earlyExitRef = useRef(new Map<string, number>());
  const onPidRef = useRef(onPid);
  // Read by `startSession` only; the launch never changes under a mounted pane.
  const remoteRef = useRef(remote);
  const onExitRef = useRef(onExit);
  const onTerminalIdRef = useRef(onTerminalId);
  const [status, setStatus] = useState<TerminalStatus>('starting');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest onPid in a ref so the mount-only PTY effect can report the
  // pid without re-subscribing (updating a ref during render is disallowed).
  useEffect(() => {
    onPidRef.current = onPid;
    onExitRef.current = onExit;
    onTerminalIdRef.current = onTerminalId;
  }, [onPid, onExit, onTerminalId]);

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
      promptRef.current?.setState('starting');
      setStatus('starting');
      setError(null);
      setExitCode(null);
      const launch = remoteRef.current;
      const res = await (
        launch
          ? window.electronAPI.terminal.createRemote({
              ...launch,
              cols: term.cols,
              rows: term.rows,
            })
          : window.electronAPI.terminal.create({
              cwd,
              // A live bg agent attaches by job id; --resume would be rejected while it
              // runs in the background. Never send both.
              resumeSessionId: attachJobId ? undefined : resume,
              attachJobId: attachJobId || undefined,
              cols: term.cols,
              rows: term.rows,
            })
      ).catch((cause: unknown) => ({
        data: null,
        error: cause instanceof Error ? cause.message : 'Failed to start the claude CLI.',
      }));
      // Stale generation: the pane unmounted (or StrictMode re-mounted) while the
      // PTY was being created, so the cleanup ran before there was an id to kill.
      // Kill the just-spawned process now instead of leaking an orphan `claude`.
      if (gen !== genRef.current) {
        if (res.data) void window.electronAPI.terminal.kill(res.data.id);
        return;
      }
      if (res.error || !res.data) {
        promptRef.current?.setState('error');
        setError(res.error || 'Failed to start the claude CLI.');
        setStatus('error');
        return;
      }
      idRef.current = res.data.id;
      trackEvent(launch ? 'remote_terminal_opened' : 'terminal_opened');
      onPidRef.current(res.data.pid);
      onTerminalIdRef.current?.(res.data.id);
      for (const chunk of earlyRef.current) {
        if (chunk.id === res.data.id) term.write(chunk.data);
      }
      earlyRef.current = [];
      const earlyExit = earlyExitRef.current.get(res.data.id);
      earlyExitRef.current.clear();
      if (earlyExit !== undefined) {
        idRef.current = null;
        onPidRef.current(null);
        promptRef.current?.setState('exited');
        setExitCode(earlyExit);
        setStatus('exited');
        onExitRef.current?.(earlyExit);
        return;
      }
      setStatus('running');
      promptRef.current?.setState('running');
      term.focus();
    },
    [cwd, attachJobId]
  );

  // Initialize xterm with its DOM during commit so the imperative prompt handle
  // is usable as soon as a parent flushSync mount returns, without waiting for a
  // passive effect or guessing readiness from an animation frame.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
      fontSize: 11,
      cursorBlink: true,
      scrollback: 10000,
      theme: paletteRef.current.term,
      // OSC 8 hyperlinks (#293): xterm's default asks with a native confirm()
      // and then opens a blank window the app refuses, so no link ever opened.
      linkHandler: makeLinkHandler(uri => window.open(uri, '_blank', 'noopener')),
    });
    // OSC 52 (#293): how a program over ssh — Claude Code's `c to copy` above
    // all — reaches this machine's clipboard. Handled here or dropped: a read
    // request is never answered and a clear is ignored (see `parseOsc52`).
    term.parser.registerOscHandler(52, data => {
      const osc = parseOsc52(data);
      if (osc.kind === 'copy') void window.electronAPI.clipboard.writeText(osc.text);
      return true;
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    termRef.current = term;
    promptRef.current = createTerminalPromptController(term);
    fitRef.current = fit;

    term.onData(data => {
      if (idRef.current) void window.electronAPI.terminal.write(idRef.current, data);
    });

    // Copy/paste off macOS has to be wired by hand. xterm maps Ctrl+letter to its
    // control char and cancels the keydown, so the DOM `paste` never fires and
    // Ctrl+V reaches the PTY as a bare ^V; and there is no context menu to fall
    // back on, since the app runs without a native menu bar on Windows/Linux
    // (`Menu.setApplicationMenu(null)`). Bindings follow the terminal convention
    // plus what users actually press: Ctrl+V and Ctrl+Shift+V paste, Ctrl+Shift+C
    // copies (a bare Ctrl+C must stay the interrupt), right-click copies when
    // there is a selection and pastes otherwise.
    const pasteFromClipboard = async () => {
      const res = await window.electronAPI.clipboard.readText();
      // `paste()` rather than a raw `terminal:write`: it normalizes newlines and
      // applies bracketed-paste mode when the TUI turned it on, so a multi-line
      // paste lands in the prompt as one block instead of N submitted lines.
      if (res.data) termRef.current?.paste(res.data);
    };
    const copySelection = () => {
      const selection = term.getSelection();
      if (!selection) return false;
      void window.electronAPI.clipboard.writeText(selection);
      term.clearSelection();
      return true;
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!copySelection()) void pasteFromClipboard();
    };
    if (!IS_MAC) {
      term.attachCustomKeyEventHandler(e => {
        if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
        const key = e.key.toLowerCase();
        if (key === 'v') {
          void pasteFromClipboard();
          return false;
        }
        // Nothing selected → let xterm have the key rather than swallow it.
        if (key === 'c' && e.shiftKey) return !copySelection();
        return true;
      });
      el.addEventListener('contextmenu', onContextMenu);
    }

    const disposeData = window.electronAPI.terminal.onData((id, data) => {
      if (idRef.current === null) {
        earlyRef.current.push({ id, data });
        return;
      }
      if (id === idRef.current) termRef.current?.write(data);
    });
    const disposeExit = window.electronAPI.terminal.onExit((id, code) => {
      if (idRef.current === null) {
        earlyExitRef.current.set(id, code);
        return;
      }
      if (id !== idRef.current) return;
      idRef.current = null;
      promptRef.current?.setState('exited');
      onPidRef.current(null);
      setExitCode(code);
      setStatus('exited');
      onExitRef.current?.(code);
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
      promptRef.current?.dispose();
      promptRef.current = null;
      earlyRef.current = [];
      earlyExitRef.current = new Map();
      ro.disconnect();
      el.removeEventListener('contextmenu', onContextMenu);
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

  const showOverlay = status === 'error' || (status === 'exited' && !hideExitOverlay);

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: palette.term.background,
        padding: '14px 16px 10px',
      }}
    >
      <div ref={containerRef} className="h-full w-full" />
      {showOverlay && (
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
