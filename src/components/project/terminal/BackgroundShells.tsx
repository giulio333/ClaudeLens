import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { spanLabel, visibleShells } from './background-shells';
import type { BackgroundShell } from './background-shells';

/**
 * The session's background shells, in its top bar beside RUNNING: a pill that
 * says how many are running and for how long, and opens the list on click.
 *
 * Written for a reader who does not want the shell: the title is the
 * `description` Claude already gives every command and the time is in minutes.
 * The rest — the command itself, the clock times, the exit code, how it got to
 * the background and where its output goes — is one click away on its row,
 * for whoever wants it. No "show in chat": the pill only exists in the session
 * that started the shell, so the chat is already the one on screen. Nothing
 * here can stop a shell: it belongs to the CLI, and the pane only reads it.
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
  // The one row whose details are open.
  const [openRow, setOpenRow] = useState<string | null>(null);

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
    label = ENDED_WORD[latest.state];
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
              {items.map(s => {
                const expanded = openRow === s.toolUseId;
                return (
                  <li key={s.toolUseId} className="cl-bgshell-entry">
                    <button
                      type="button"
                      className="cl-bgshell-item"
                      aria-expanded={expanded}
                      onClick={() => setOpenRow(expanded ? null : s.toolUseId)}
                    >
                      <StateIcon state={s.state} size={16} />
                      <span className="cl-bgshell-item-body">
                        <span className="cl-bgshell-item-title">{s.title}</span>
                        <span className="cl-bgshell-item-sub" data-tone={s.state}>
                          {itemLine(s, now)}
                        </span>
                      </span>
                      <span className="cl-bgshell-caret" aria-hidden="true">
                        {expanded ? '−' : '+'}
                      </span>
                    </button>
                    {expanded && <ShellDetails shell={s} />}
                  </li>
                );
              })}
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

/**
 * The time the labels are measured against. Nothing on disk changes while a
 * shell just runs, so the minutes can't ride the watcher; a coarse tick of
 * its own keeps "12 min" and the recent window honest.
 */
function useMinuteClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const ENDED_WORD: Record<BackgroundShell['state'], string> = {
  running: 'Running',
  done: 'Finished',
  failed: 'Failed',
  stopped: 'Stopped',
};

/** When it ended comes first, how long it ran second: "Finished after 20 min"
 *  read as twenty minutes ago on a command that had just ended. */
function itemLine(s: BackgroundShell, now: number): string {
  if (s.state === 'running') return `Running for ${spanLabel(now - s.startedAt)}`;
  const when = s.endedAt ? ` ${spanLabel(now - s.endedAt)} ago` : '';
  const ran = s.endedAt && s.startedAt ? ` · ran ${spanLabel(s.endedAt - s.startedAt)}` : '';
  const code = s.state === 'failed' && s.exitCode !== undefined ? ` · exit code ${s.exitCode}` : '';
  return `${ENDED_WORD[s.state]}${when}${ran}${code}`;
}

/** The facts the transcript holds about one shell, as label and value. */
function ShellDetails({ shell: s }: { shell: BackgroundShell }) {
  const rows: Array<[string, string]> = [];
  if (s.startedAt) rows.push(['Started', clockTime(s.startedAt)]);
  if (s.endedAt) rows.push(['Ended', clockTime(s.endedAt)]);
  if (s.startedAt && s.endedAt) rows.push(['Ran', spanLabel(s.endedAt - s.startedAt)]);
  if (s.exitCode !== undefined) rows.push(['Exit code', String(s.exitCode)]);
  rows.push([
    'Background',
    s.via === 'timeout'
      ? `Moved there after its ${s.timeoutS ?? '?'} s timeout`
      : 'Started there by Claude',
  ]);
  if (s.stoppedByClaude) rows.push(['Stopped', 'By Claude, with TaskStop']);
  return (
    <div className="cl-bgshell-detail">
      <div className="cl-bgshell-detail-head">
        <span>Command</span>
        <CopyText text={s.command} label="Copy command" />
      </div>
      <pre className="cl-bgshell-cmd">{s.command}</pre>
      <dl className="cl-bgshell-facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {s.outputFile && (
          <div>
            <dt>Output</dt>
            <dd className="cl-bgshell-path" title={s.outputFile}>
              {s.outputFile.split('/').pop()}
              <CopyText text={s.outputFile} label="Copy path" />
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="cl-bgshell-copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function StateIcon({ state, size = 14 }: { state: BackgroundShell['state']; size?: number }) {
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
