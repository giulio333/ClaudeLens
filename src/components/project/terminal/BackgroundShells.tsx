import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { STATE_WORD, shellStatusLine, spanLabel, visibleShells } from './background-shells';
import type { BackgroundShell } from './background-shells';
import { useMinuteClock } from './use-minute-clock';
import { StateIcon } from './ShellStateIcon';
import { BackgroundShellSheet } from './BackgroundShellSheet';

/**
 * The session's background shells, in its top bar beside RUNNING: a pill that
 * says how many are running and for how long, and opens the list on click.
 *
 * Written for a reader who does not want the shell: the title is the
 * `description` Claude already gives every command and the time is in minutes.
 * The rest — the command itself, the clock times, the exit code, how it got to
 * the background and where its output goes — is a click on its row away, in a
 * window that floats over the session (`BackgroundShellSheet`). No "show in
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
}: {
  shells: BackgroundShell[];
  /** When the CLI process running the session started; null when none is.
   *  Only the shells that process started are its children. */
  liveSince: number | null;
}) {
  // Where the pill was when the list opened; null while it is closed.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = anchor !== null;
  const now = useMinuteClock(shells.length > 0);
  const { running, ended } = visibleShells(shells, liveSince, now);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // The shell whose window is open, by call id: the shell itself is read fresh
  // from `shells` on every transcript read, so a running one ends in place.
  const [sheetId, setSheetId] = useState<string | null>(null);
  const sheetShell = sheetId ? shells.find(s => s.toolUseId === sheetId) : undefined;
  const sheet = sheetShell && (
    <BackgroundShellSheet shell={sheetShell} onClose={() => setSheetId(null)} />
  );

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

  // An open window outlives the pill: the shell can leave the recent window
  // while its window is being read.
  if (running.length === 0 && ended.length === 0) return sheet ?? null;

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
                      setSheetId(s.toolUseId);
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
      {sheet}
    </div>
  );
}
