import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useActiveSessions } from '../../../hooks/useIPC';
import type { ActiveSession } from '../../../types';
import { spanLabel } from './background-shells';
import { useMinuteClock } from './use-minute-clock';
import {
  chipTone,
  mostUrgentTone,
  registryEntryFor,
  type ChipTone,
  type TerminalInstance,
} from './terminal-instances';

const TONE_LABEL: Record<ChipTone, string> = {
  starting: 'Starting',
  busy: 'Claude is working',
  waiting: 'Waiting for you',
  idle: 'Your turn',
  lens: 'Lens only, no terminal',
  ended: 'Session ended',
};

/**
 * The sessions kept running in the background, behind one badge: how many, and
 * a dot in the colour of the one that most needs the user (waiting before
 * working before done). A click opens the list — any number of sessions fits
 * there, where a row of chips in the top bar ran out of room at the second one.
 * A row brings its session back exactly as it was left (same process, same
 * scrollback); its ✕ ends it.
 *
 * Same anatomy as the background-shells pill beside it in Mission Control, and
 * portalled to `<body>` for the same reason: the top bar is a stacking context
 * of its own, so a panel drawn inside it would sit under the page.
 *
 * `activeSessions` stands in for the registry where the instances are not real
 * ones (the "What's new" preview): there, the user's own registry could only
 * make them idle, or match a live session of theirs.
 */
export function ParkedTerminals({
  instances,
  onRestore,
  onClose,
  activeSessions: registryOverride,
}: {
  instances: readonly TerminalInstance[];
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
  activeSessions?: readonly ActiveSession[];
}) {
  const { data: registry } = useActiveSessions();
  const activeSessions = registryOverride ?? registry;
  const now = useMinuteClock(instances.length > 0);
  // Where the badge was when the list opened; null while it is closed.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = anchor !== null;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // The last session ended from the list takes the badge with it: close the
  // list too, so the next parked session does not reopen it on its own.
  if (instances.length === 0 && anchor) setAnchor(null);

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

  if (instances.length === 0) return null;

  const rows = instances.map(inst => {
    const tone = chipTone(inst.report, activeSessions);
    const entry = registryEntryFor(inst.report, activeSessions);
    const project =
      inst.view.project.realPath.split(/[\\/]/).filter(Boolean).pop() || inst.view.project.realPath;
    const title = inst.report.title ?? 'New session';
    const state =
      tone === 'waiting' && entry?.waitingFor
        ? `${TONE_LABEL[tone]}: ${entry.waitingFor}`
        : TONE_LABEL[tone];
    const since = entry?.startedAt && tone !== 'ended' ? spanLabel(now - entry.startedAt) : null;
    return { inst, tone, project, title, state, since, color: inst.report.color };
  });
  const badgeTone = mostUrgentTone(rows.map(r => r.tone));
  const waiting = rows.filter(r => r.tone === 'waiting').length;
  const count = instances.length;
  const summary =
    `${count} ${count === 1 ? 'session' : 'sessions'} in background` +
    (waiting ? ` · ${waiting} waiting for you` : '');

  return (
    <div ref={rootRef} className="cl-parked">
      <button
        type="button"
        className="cl-parked-badge"
        data-tone={badgeTone}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={summary}
        title={summary}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor(prev => (prev ? null : rect));
        }}
      >
        <span className="cl-parked-dot" data-tone={badgeTone} aria-hidden />
        <span className="cl-parked-count">{count}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="cl-parked-caret">
          <path d="M1.5 3 4 5.5 6.5 3" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>

      {anchor &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Sessions in background"
            className="cl-bgshell-panel cl-parked-panel"
            style={{ top: anchor.bottom + 8, right: Math.max(8, window.innerWidth - anchor.right) }}
          >
            <div className="cl-bgshell-panel-title">In background · {count}</div>
            <p className="cl-bgshell-panel-lede">
              Sessions kept running while you are elsewhere. Open one to pick it up where it was.
            </p>
            <ul className="cl-bgshell-list">
              {rows.map(({ inst, tone, project, title, state, since, color }) => (
                <li key={inst.id} className="cl-bgshell-entry cl-parked-row">
                  <button
                    type="button"
                    className="cl-bgshell-item"
                    aria-label={`Open ${project} · ${title} (${state})`}
                    onClick={() => {
                      setAnchor(null);
                      onRestore(inst.id);
                    }}
                  >
                    <span className="cl-parked-dot" data-tone={tone} aria-hidden />
                    <span className="cl-bgshell-item-body">
                      <span className="cl-parked-project">{project}</span>
                      {/* The session's colour is worn by its title, as on the
                          sessions list: it is what says which session this is. */}
                      <span
                        className={`cl-bgshell-item-title${
                          color ? ` cl-session-identity ${color}` : ''
                        }`}
                      >
                        {title}
                      </span>
                      <span className="cl-bgshell-item-sub cl-parked-state" data-tone={tone}>
                        {since ? `${state} · ${since}` : state}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cl-parked-close"
                    title="End this session"
                    aria-label={`End ${project} · ${title}`}
                    onClick={() => {
                      // Only a turn in this session's own terminal is stopped by
                      // the ✕: a Lens-only one busy elsewhere closes nothing.
                      if (
                        tone === 'busy' &&
                        inst.report.termStatus === 'running' &&
                        !window.confirm(
                          'Claude is still working in this session. End the terminal anyway?'
                        )
                      ) {
                        return;
                      }
                      onClose(inst.id);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <p className="cl-bgshell-panel-foot">
              Quitting ClaudeLens ends every session still running here.
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}
