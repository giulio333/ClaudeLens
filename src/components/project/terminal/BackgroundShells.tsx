import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { STATE_WORD, shellStatusLine, spanLabel, visibleShells } from './background-shells';
import type { BackgroundShell } from './background-shells';
import { useMinuteClock } from './use-minute-clock';

/**
 * The session's background shells, in its top bar beside RUNNING: a pill that
 * says how many are running and for how long, and opens the list on click.
 *
 * Written for a reader who does not want the shell: the title is the
 * `description` Claude already gives every command and the time is in minutes.
 * The rest — the command itself, the clock times, the exit code, how it got to
 * the background and where its output goes — is a click on its row away, on a
 * page of its own (`BackgroundShellPage`, in the frame's overlay). No "show in
 * chat": the pill only exists in the session that started the shell, so the
 * chat is already the one on screen. Nothing here can stop a shell: it belongs
 * to the CLI, and the pane only reads it.
 *
 * With nothing running, the pill reports the latest ending for the recent
 * window and then goes; with nothing to report it is not drawn at all.
 *
 * The list is portalled to `<body>` and placed under the pill: the top bar is
 * a stacking context of its own (its `backdrop-filter`), so a panel drawn
 * inside it would sit under the terminal and the rail it hangs over.
 */
export function BackgroundShells({
  shells,
  liveSince,
  onOpen,
}: {
  shells: BackgroundShell[];
  /** When the CLI process running the session started; null when none is.
   *  Only the shells that process started are its children. */
  liveSince: number | null;
  /** Open the shell's page. */
  onOpen: (shell: BackgroundShell) => void;
}) {
  // Where the pill was when the list opened; null while it is closed.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = anchor !== null;
  const now = useMinuteClock(shells.length > 0);
  const { running, ended } = visibleShells(shells, liveSince, now);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => setAnchor(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (running.length === 0 && ended.length === 0) return null;

  const latest = ended[0];
  const tone = running.length > 0 ? 'running' : latest.state;
  let label: string;
  let meta: string;
  if (running.length > 0) {
    label = `${running.length} in background`;
    // One shell: how long it has run. Several: the count says enough.
    meta = running.length === 1 ? spanLabel(now - running[0].startedAt) : '';
  } else {
    label = STATE_WORD[latest.state];
    meta = `${spanLabel(now - (latest.endedAt ?? now))} ago`;
  }
  const items = [...running, ...ended];

  return (
    <div
      ref={rootRef}
      className="cl-bgshell"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <button
        type="button"
        className="cl-bgshell-pill"
        data-tone={tone}
        aria-expanded={open}
        aria-controls={panelId}
        title={running.length === 0 ? latest.title : undefined}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor(prev => (prev ? null : rect));
        }}
      >
        <StateIcon state={tone} />
        <span>{label}</span>
        {meta && <span className="cl-bgshell-pill-meta">· {meta}</span>}
      </button>

      {anchor &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Background work"
            className="cl-bgshell-panel"
            style={{ top: anchor.bottom + 8, right: Math.max(8, window.innerWidth - anchor.right) }}
          >
            <div className="cl-bgshell-panel-title">In background</div>
            <p className="cl-bgshell-panel-lede">
              Commands Claude left running. It is told when each one finishes.
            </p>
            <ul className="cl-bgshell-list">
              {items.map(s => (
                <li key={s.toolUseId}>
                  <button
                    type="button"
                    className="cl-bgshell-item"
                    onClick={() => {
                      setAnchor(null);
                      onOpen(s);
                    }}
                  >
                    <StateIcon state={s.state} size={16} />
                    <span className="cl-bgshell-item-body">
                      <span className="cl-bgshell-item-title">{s.title}</span>
                      <span className="cl-bgshell-item-sub" data-tone={s.state}>
                        {shellStatusLine(s, now)}
                      </span>
                    </span>
                    <span className="cl-bgshell-caret" aria-hidden="true">
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="cl-bgshell-panel-foot">
              {running.length > 0
                ? 'Only Claude can stop them — ask it in the terminal.'
                : 'Finished commands leave this list after 10 minutes.'}
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}

export function StateIcon({
  state,
  size = 14,
}: {
  state: BackgroundShell['state'];
  size?: number;
}) {
  if (state === 'running') {
    return (
      <svg
        className="cl-bgshell-spin"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="var(--cl-line)" strokeWidth="2.4" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="var(--cl-accent)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const color =
    state === 'done' ? 'var(--cl-ok)' : state === 'failed' ? 'var(--cl-danger)' : 'var(--cl-ink-3)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" />
      {state === 'done' && <path d="M8 12.5l2.6 2.6L16 9.5" />}
      {state === 'failed' && (
        <>
          <path d="M12 7.5v5.5" />
          <path d="M12 16.5v.01" />
        </>
      )}
      {state === 'stopped' && <rect x="9" y="9" width="6" height="6" rx="1" />}
    </svg>
  );
}
