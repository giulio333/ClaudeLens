import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useActiveSessions } from '../../../hooks/useIPC';
import type { ActiveSession } from '../../../types';
import { spanLabel } from './background-shells';
import { useMinuteClock } from './use-minute-clock';
import {
  TONE_LABEL,
  chipTone,
  endNeedsConfirm,
  instanceProjectName,
  instanceTitle,
  mostUrgentTone,
  registryEntryFor,
  type ChipTone,
  type TerminalInstance,
} from './terminal-instances';

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
  const rows = useSessionRows(instances, registryOverride);
  const { anchor, open, id, rootRef, panelRef, close, toggle } = useAnchoredPanel(
    instances.length > 0
  );
  if (instances.length === 0) return null;

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
        aria-controls={id}
        aria-label={summary}
        title={summary}
        onClick={toggle}
      >
        <span className="cl-parked-dot" data-tone={badgeTone} aria-hidden />
        <span className="cl-parked-count">{count}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="cl-parked-caret">
          <path d="M1.5 3 4 5.5 6.5 3" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      {anchor && (
        <SessionListPanel
          anchor={anchor}
          panelRef={panelRef}
          id={id}
          onDone={close}
          label="Sessions in background"
          title={`In background · ${count}`}
          lede="Sessions kept running while you are elsewhere. Open one to pick it up where it was."
          rows={rows}
          onRestore={onRestore}
          onClose={onClose}
        />
      )}
    </div>
  );
}

/**
 * The tab strip's way out when it runs out of room: every open session, the one
 * on screen included and marked, in the same list the background badge opens.
 */
export function OpenSessionsButton({
  instances,
  currentId,
  onRestore,
  onClose,
}: {
  instances: readonly TerminalInstance[];
  currentId: string | null;
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const rows = useSessionRows(instances);
  const { anchor, open, id, rootRef, panelRef, close, toggle } = useAnchoredPanel(
    instances.length > 0
  );
  const count = instances.length;
  return (
    <div ref={rootRef} className="cl-parked">
      <button
        type="button"
        className="cl-stabs-icon"
        aria-expanded={open}
        aria-controls={id}
        aria-label="All open sessions"
        title="All open sessions"
        onClick={toggle}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
        </svg>
      </button>
      {anchor && (
        <SessionListPanel
          anchor={anchor}
          panelRef={panelRef}
          id={id}
          onDone={close}
          label="Open sessions"
          title={`Open sessions · ${count}`}
          rows={rows}
          currentId={currentId}
          onRestore={onRestore}
          onClose={onClose}
          align="left"
          compact
        />
      )}
    </div>
  );
}

interface SessionRow {
  inst: TerminalInstance;
  tone: ChipTone;
  project: string;
  title: string;
  state: string;
  since: string | null;
}

function useSessionRows(
  instances: readonly TerminalInstance[],
  registryOverride?: readonly ActiveSession[]
): SessionRow[] {
  const { data: registry } = useActiveSessions();
  const activeSessions = registryOverride ?? registry;
  const now = useMinuteClock(instances.length > 0);
  return instances.map(inst => {
    const tone = chipTone(inst.report, activeSessions);
    const entry = registryEntryFor(inst.report, activeSessions);
    const state =
      tone === 'waiting' && entry?.waitingFor
        ? `${TONE_LABEL[tone]}: ${entry.waitingFor}`
        : TONE_LABEL[tone];
    const since = entry?.startedAt && tone !== 'ended' ? spanLabel(now - entry.startedAt) : null;
    return {
      inst,
      tone,
      project: instanceProjectName(inst),
      title: instanceTitle(inst),
      state,
      since,
    };
  });
}

/** Where the trigger was when the list opened; closed on a click outside, Esc
 *  and a resize, and when there is nothing left to list. */
function useAnchoredPanel(hasItems: boolean) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = anchor !== null;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  // The last session ended from the list takes the trigger with it: close the
  // list too, so the next session does not reopen it on its own.
  if (!hasItems && anchor) setAnchor(null);

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

  return {
    anchor,
    open,
    rootRef,
    panelRef,
    id,
    close: () => setAnchor(null),
    toggle: (e: React.MouseEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setAnchor(prev => (prev ? null : rect));
    },
  };
}

function SessionListPanel({
  anchor,
  panelRef,
  id,
  onDone,
  label,
  title,
  lede,
  rows,
  currentId,
  onRestore,
  onClose,
  align = 'right',
  compact = false,
}: {
  anchor: DOMRect;
  panelRef: React.RefObject<HTMLDivElement | null>;
  id: string;
  onDone: () => void;
  label: string;
  title: ReactNode;
  lede?: string;
  rows: SessionRow[];
  currentId?: string | null;
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
  /** Which edge of the trigger the panel lines up with: the badge sits at the
   *  right of its bar, the grid button at the left of the tabs. */
  align?: 'left' | 'right';
  /** The tab strip's list: one line per session, the project beside its state
   *  instead of above the title, and no lede — the tabs already said it. */
  compact?: boolean;
}) {
  const edge =
    align === 'left'
      ? { left: Math.max(8, anchor.left) }
      : { right: Math.max(8, window.innerWidth - anchor.right) };
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={label}
      className={`cl-bgshell-panel cl-parked-panel${compact ? ' cl-parked-panel--compact' : ''}`}
      style={{ top: anchor.bottom + 8, ...edge }}
    >
      <div className="cl-bgshell-panel-title">{title}</div>
      {lede && <p className="cl-bgshell-panel-lede">{lede}</p>}
      <ul className="cl-bgshell-list">
        {rows.map(({ inst, tone, project, title: rowTitle, state, since }) => {
          const current = inst.id === currentId;
          const color = inst.report.color;
          return (
            <li key={inst.id} className="cl-bgshell-entry cl-parked-row" data-current={current}>
              <button
                type="button"
                className="cl-bgshell-item"
                aria-current={current ? 'true' : undefined}
                aria-label={`Open ${project} · ${rowTitle} (${state})`}
                onClick={() => {
                  onDone();
                  if (!current) onRestore(inst.id);
                }}
              >
                <span className="cl-parked-dot" data-tone={tone} aria-hidden />
                <span className="cl-bgshell-item-body">
                  {!compact && <span className="cl-parked-project">{project}</span>}
                  {/* The session's colour is worn by its title, as on the
                      sessions list: it is what says which session this is. */}
                  <span
                    className={`cl-bgshell-item-title${
                      color ? ` cl-session-identity ${color}` : ''
                    }`}
                  >
                    {rowTitle}
                  </span>
                  <span className="cl-bgshell-item-sub cl-parked-state" data-tone={tone}>
                    {compact && <span className="cl-parked-project">{project} · </span>}
                    {since ? `${state} · ${since}` : state}
                    {current ? ' · on screen' : ''}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="cl-parked-close"
                title="End this session"
                aria-label={`End ${project} · ${rowTitle}`}
                onClick={() => {
                  if (
                    endNeedsConfirm(tone, inst.report) &&
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
          );
        })}
      </ul>
      <p className="cl-bgshell-panel-foot">
        Quitting ClaudeLens ends every session still running here.
      </p>
    </div>,
    document.body
  );
}
