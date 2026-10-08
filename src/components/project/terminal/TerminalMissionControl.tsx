import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useActiveSessions, useChatSession, useSessionList } from '../../../hooks/useIPC';
import { useTheme } from '../../../hooks/useTheme';
import type { SessionSummary } from '../../../hooks/useIPC';
import {
  SessionBottomGlow,
  SessionColorFrame,
  SessionColorIdentity,
} from '../shared/SessionColorIdentity';
import { CloseOverlayButton } from '../shared/CloseOverlayButton';
import { ChatView } from '../chat/ChatView';
import { SessionActions } from './SessionActions';
import { SessionDetailPanel } from '../shared/SessionDetailPanel';
import { overlayCrumb as crumbOf, type SessionOverlay } from '../shared/session-overlay';
import type { SessionWaiting } from '../chat/WaitingLine';
import { buildProcessedMessages, toolRunStatus, touchedFiles } from '../chat/utils';
import { contextFiles } from '../chat/context-files';
import { sessionGitState, shownBranch } from '../chat/git-state';
import { relToRoot, sessionMarks } from '../files/session-marks';
import { sessionTitle } from '../utils';
import { TerminalPane } from './TerminalPane';
import { TERMINAL_SURFACE, type TerminalStatus } from './terminal-theme';
import { MissionRail } from './MissionRail';
import { BackgroundShells } from './BackgroundShells';
import { buildBackgroundShells } from './background-shells';
import { flushSync } from 'react-dom';
import type { TerminalPromptHandle } from './terminal-prompt';
import type { InstanceReport } from './terminal-instances';

/**
 * The unified Terminal ↔ Lens view ("Terminal Mission Control").
 *
 * One main column with a switch in the frame above the console: TERMINAL shows
 * the real interactive `claude` TUI (a dark slab, billed against the
 * subscription); LENS shows the *same session* rendered read-only by the
 * ClaudeLens chat (the embedded `ChatView` — no composer, no spend). Opening a
 * recent session defaults to LENS (read-only, zero cost); the terminal mounts
 * lazily on the first switch to TERMINAL, then stays mounted (toggling
 * visibility, not unmounting) so flipping back to Lens doesn't kill the PTY.
 * The choice persists.
 *
 * A scrolling Mission Control rail sits to the right in both modes, surfacing
 * the session's meaningful units (agents, skills, file changes, tasks). The
 * session id is discovered from the PTY's pid via the active-sessions registry
 * (the CLI joins a few seconds after boot); a resumed session id seeds the rail
 * immediately until then.
 */

/** Compare two absolute paths tolerantly: registry `cwd` (from the CLI) and the
 *  project realPath can differ in slash direction and drive-letter case on
 *  Windows. Normalize both to forward slashes, drop a trailing slash, and
 *  compare case-insensitively (Windows/macOS filesystems are case-preserving
 *  but case-insensitive; a Linux collision on case alone is not worth the risk). */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    p
      .replace(/[\\/]+/g, '/')
      .replace(/\/$/, '')
      .toLowerCase();
  return norm(a) === norm(b);
}

const RAIL_DEFAULT = 432;
const RAIL_MIN = 380;
const RAIL_MAX = 560;

export type View = 'terminal' | 'lens';

/** v2 centered tab switch: TERMINAL ❯_ ↔ LENS ◎ as underline tabs that head the
 *  focus (center) column, replacing the glass segmented pill (design 02 · Outline
 *  + Focus). The active tab carries an accent bottom border.
 *
 *  It is also the frame's only control row: the session tags and the two column
 *  toggles ride in its `right` slot instead of a strip of their own above it.
 *  That strip cost 46px of vertical chrome — on a tool detail opened from the
 *  rail there were four stacked bars before the first line of content — to hold
 *  three controls that fit at the end of this one. A 3-column grid keeps the
 *  tabs centered on the column while the right cluster stays flush right: with a
 *  plain flex row a long tag list would push them off center. */
export function ViewTabs({
  view,
  setView,
  right,
}: {
  view: View;
  setView: (v: View) => void;
  right?: ReactNode;
}) {
  const opts: Array<{ id: View; label: string; glyph: string }> = [
    { id: 'terminal', label: 'TERMINAL', glyph: '❯_' },
    { id: 'lens', label: 'LENS', glyph: '◎' },
  ];
  return (
    <div
      className="shrink-0"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        alignItems: 'center',
        padding: '0 26px',
        borderBottom: '1px solid var(--cl-line)',
      }}
    >
      <span />
      <div className="flex items-center justify-center" style={{ gap: 30 }}>
        {opts.map(o => {
          const on = view === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setView(o.id)}
              className="inline-flex items-center transition-colors"
              style={{
                gap: 7,
                padding: '14px 4px 12px',
                borderBottom: `2px solid ${on ? 'var(--cl-accent)' : 'transparent'}`,
              }}
            >
              <span
                className="font-mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: on ? 'var(--cl-accent-ink)' : 'var(--cl-ink-4)',
                }}
              >
                {o.glyph}
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  fontWeight: on ? 700 : 500,
                  color: on ? 'var(--cl-ink)' : 'var(--cl-ink-4)',
                }}
              >
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
      {/* Flush right and clipped: with more tags than fit, the overflow falls off
          the *start* of the cluster (justify-end), so the toggles and `+ tag`
          survive and the row never grows a second line. */}
      <div
        className="flex items-center justify-end"
        style={{ gap: 14, minWidth: 0, overflow: 'hidden' }}
      >
        {right}
      </div>
    </div>
  );
}

/** Terminal / Lens as one segmented control, the active half filled — the
 *  switch at the right end of Mission Control's single top bar (variant C).
 *  `ViewTabs` is the centred underline row the Remote view still draws. */
export function ViewSwitch({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="cl-stabs-view" role="group" aria-label="View">
      <button type="button" aria-pressed={view === 'terminal'} onClick={() => setView('terminal')}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m3 4.5 3.5 3.5L3 11.5M8.5 12H13" />
        </svg>
        Terminal
      </button>
      <button type="button" aria-pressed={view === 'lens'} onClick={() => setView('lens')}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="5.5" />
          <circle cx="8" cy="8" r="1.6" />
        </svg>
        Lens
      </button>
    </div>
  );
}

/** The tab bar's way back, at its left end. What it goes back to is the
 *  caller's to say: the session from a detail, the app from a session. */
export function TabBarBack({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cl-stabs-icon cl-stabs-back"
      onClick={onClick}
      aria-label={label}
      title={title}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
    </button>
  );
}

/** The Mission Control toggle at the tab bar's right end: the same panel-right
 *  glyph as `RailToggle`, drawn as one of the bar's bare icons. */
export function TabBarRailToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = collapsed ? 'Show Mission Control' : 'Hide Mission Control';
  return (
    <button
      type="button"
      className="cl-stabs-icon"
      onClick={onToggle}
      aria-pressed={!collapsed}
      aria-label={label}
      title={label}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="2" y="3.25" width="12" height="9.5" rx="2" />
        <line x1="9.75" y1="3.25" x2="9.75" y2="12.75" />
        {!collapsed && (
          <rect
            x="9.75"
            y="3.25"
            width="4.25"
            height="9.5"
            fill="currentColor"
            stroke="none"
            opacity="0.3"
          />
        )}
      </svg>
    </button>
  );
}

/** Collapse/expand toggle for the Mission Control rail — a panel-right glyph
 *  (right pane filled when the rail is shown). Stays visible in the frame so the
 *  rail can be reopened after collapsing. Collapsed state is persisted by the parent. */
export function RailToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? 'Show Mission Control' : 'Hide Mission Control';
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={!collapsed}
      className="inline-flex items-center justify-center transition-colors shrink-0"
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        border: '1px solid var(--cl-glass-border)',
        background: collapsed ? 'transparent' : 'var(--cl-glass-bg-strong)',
        WebkitBackdropFilter: 'blur(12px) saturate(1.5)',
        backdropFilter: 'blur(12px) saturate(1.5)',
        color: collapsed ? 'var(--cl-ink-4)' : 'var(--cl-accent-ink)',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="2" y="3.25" width="12" height="9.5" rx="2" />
        <line x1="9.75" y1="3.25" x2="9.75" y2="12.75" />
        {!collapsed && (
          <rect
            x="9.75"
            y="3.25"
            width="4.25"
            height="9.5"
            fill="currentColor"
            stroke="none"
            opacity="0.22"
          />
        )}
      </svg>
    </button>
  );
}

export function TerminalMissionControl({
  project,
  resumeSessionId,
  attachJobId,
  focusMessageUuid,
  onBack,
  onOpenSession,
  onOpenExchange,
  active = true,
  onPark,
  onReport,
  sessionTabs,
}: {
  project: { hash: string; realPath: string };
  resumeSessionId?: string;
  // Set when the row is a *live* background agent: the TERMINAL tab then `claude
  // attach`es the live worker instead of `--resume` (which the CLI rejects while
  // a session runs in the background). The LENS pane still reads by sessionId.
  attachJobId?: string;
  /** Open the Lens scrolled to the turn holding this message — a search hit.
   *  Handed straight to the embedded ChatView, which matches by uuid and says so
   *  when the message is past the compaction boundary the SDK read truncates at. */
  focusMessageUuid?: string;
  onBack: () => void;
  /** Navigate to another session's Mission Control (used by the team detail
   *  overlay's "open chat"). This view is not parked by it, so it unmounts and a
   *  live PTY dies: gate behind a confirm here. */
  onOpenSession?: (resumeSessionId: string) => void;
  /** Open the exchange a message from or to another session belongs to
   *  (#280) — handed to the embedded ChatView, whose bubbles offer it on both
   *  halves, and to the rail, whose MESSAGES rows open the same page. */
  onOpenExchange?: (entry: { sessionId: string; msgId: string }) => void;
  /** Whether this Mission Control is the one on screen. A parked one stays
   *  mounted (that is what keeps its `claude` alive) but hidden, and must not
   *  take keys meant for the one the user is looking at. */
  active?: boolean;
  /** Keep this session running in the background and leave it (TerminalHost):
   *  what the top bar's back arrow does when it is given. Without it the arrow
   *  ends the session, as Back always did. */
  onPark?: () => void;
  /** What this session's tab shows: its PTY, session, title, state. */
  onReport?: (report: InstanceReport) => void;
  /** The first row: every open session as a tab (`SessionTabs`). Without it the
   *  row names the project and the session. */
  sessionTabs?: ReactNode;
}) {
  const { resolved } = useTheme();
  // Opening an existing session defaults to LENS (read-only, nothing spawned); a
  // fresh terminal (no resume id) has nothing to read, so it defaults to TERMINAL.
  // An explicit past choice (persisted) wins for resumed sessions.
  const [view, setViewRaw] = useState<View>(() => {
    if (!resumeSessionId) return 'terminal';
    return localStorage.getItem('tmc-view') === 'terminal' ? 'terminal' : 'lens';
  });
  // The PTY is expensive (spawns a real `claude`): mount TerminalPane only once
  // the user actually opens TERMINAL, then keep it mounted across toggles so the
  // session isn't killed when flipping back to Lens. Driven from setView (the
  // only path that changes view), so no setState-in-effect.
  const [terminalMounted, setTerminalMounted] = useState(view === 'terminal');
  const terminalPromptRef = useRef<TerminalPromptHandle>(null);
  const promptInsertionRef = useRef<AbortController | null>(null);
  useEffect(() => () => promptInsertionRef.current?.abort(), []);
  const setView = useCallback((v: View) => {
    if (v === 'lens') promptInsertionRef.current?.abort();
    setViewRaw(v);
    localStorage.setItem('tmc-view', v);
    if (v === 'terminal') setTerminalMounted(true);
  }, []);

  const [railWidth, setRailWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('tmc-rail-width'));
    return Number.isFinite(saved) && saved >= RAIL_MIN && saved <= RAIL_MAX ? saved : RAIL_DEFAULT;
  });
  const onWidthChange = useCallback((w: number) => {
    setRailWidth(w);
    localStorage.setItem('tmc-rail-width', String(w));
  }, []);

  // Mission Control rail collapses to give the chat/terminal the full width.
  const [railCollapsed, setRailCollapsed] = useState<boolean>(
    () => localStorage.getItem('tmc-rail-collapsed') === '1'
  );
  const toggleRail = useCallback(() => {
    setRailCollapsed(c => {
      const next = !c;
      localStorage.setItem('tmc-rail-collapsed', next ? '1' : '0');
      return next;
    });
  }, []);

  // Imperative scroll handle into the embedded Lens transcript — a rail row
  // calls it to jump to a turn (set by ChatView, null in Terminal mode).
  const jumpToTurnRef = useRef<((n: number) => void) | null>(null);
  const jumpToTurn = useCallback(
    (turnN: number) => {
      if (view === 'lens') {
        jumpToTurnRef.current?.(turnN);
        return;
      }
      // Coming from Terminal: reveal the Lens first, then scroll once the
      // transcript is on screen (it stays mounted under display:none, so the ref
      // is already wired — only its visibility flips this frame).
      setView('lens');
      requestAnimationFrame(() => jumpToTurnRef.current?.(turnN));
    },
    [view, setView]
  );

  // A parked session reached again from a search hit carries a new message to
  // show, and only the Lens can show it. Render-phase, like the latch below, and
  // through the raw setter: nothing is written to localStorage during render.
  const [seenFocus, setSeenFocus] = useState(focusMessageUuid);
  if (focusMessageUuid !== seenFocus) {
    setSeenFocus(focusMessageUuid);
    if (focusMessageUuid) setViewRaw('lens');
  }

  const [ptyPid, setPtyPid] = useState<number | null>(null);
  // When this pane's CLI came up — the stand-in for the registry's `startedAt`
  // until the CLI joins it.
  const [ptySince, setPtySince] = useState<number | null>(null);
  const onPid = useCallback((pid: number | null) => {
    setPtyPid(pid);
    setPtySince(pid ? Date.now() : null);
  }, []);
  const [termStatus, setTermStatus] = useState<TerminalStatus>('starting');
  const [overlay, setOverlay] = useState<SessionOverlay | null>(null);
  useEffect(() => {
    if (overlay) promptInsertionRef.current?.abort();
  }, [overlay]);
  const closeOverlay = useCallback(() => setOverlay(null), []);

  // A parked Mission Control drops what it was about to type: a Playbook paste
  // still waiting for the CLI would otherwise land in a session nobody sees.
  useEffect(() => {
    if (!active) promptInsertionRef.current?.abort();
  }, [active]);

  // Esc closes a rail detail overlay (the embedded chat handles its own Esc).
  // Only the Mission Control on screen listens: the key is the user's answer to
  // what they are looking at, never to an overlay left open in a parked one.
  useEffect(() => {
    if (!overlay || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOverlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, closeOverlay, active]);

  /** What the open overlay is called in the top bar, and what dismissing it is
   *  called. The detail views themselves no longer say it: they render
   *  `chromeless` here, so this crumb is the only place the frame states which
   *  of the session's units is on screen. */
  const overlayCrumb = useMemo(() => crumbOf(overlay), [overlay]);

  // The CLI registers itself in `~/.claude/sessions/<pid>.json` a few seconds
  // after boot; matching by the PTY's pid pins down *this* terminal's session.
  // Until then (or on CLI < 2.x) fall back to the resumed id. The registry wins
  // once available: `--resume` may mint a fresh session id.
  const { data: activeSessions } = useActiveSessions();
  const registrySessionId = useMemo(() => {
    if (!ptyPid || !activeSessions) return null;
    // Primary: the PTY's pid IS the CLI's pid (POSIX, and Windows native
    // claude.exe launched directly) — the registry is keyed by it.
    const byPid = activeSessions.find(s => s.pid === ptyPid && s.sessionId);
    if (byPid) return byPid.sessionId;
    // Fallback for a legacy Windows `claude.cmd` install: the PTY pid is the
    // cmd.exe wrapper, never in the registry, so the pid match can't work. Match
    // this pane's cwd instead — but only when it is UNAMBIGUOUS (exactly one live
    // session in this folder): with a second `claude` running here (e.g. an
    // external terminal) we bail rather than pin the wrong session.
    const inCwd = activeSessions.filter(s => s.sessionId && samePath(s.cwd, project.realPath));
    return inCwd.length === 1 ? inCwd[0].sessionId : null;
  }, [ptyPid, activeSessions, project.realPath]);
  // Latch the resolved id. The CLI rewrites `~/.claude/sessions/<pid>.json` on
  // every status change — not on a heartbeat (see sessions-registry-reader.ts),
  // though that is still at least once per turn; a (debounced) registry read
  // landing mid-write transiently drops our entry, so `registrySessionId` flaps
  // to null — which would null out `sessionId`, disable `useChatSession`, and
  // blank the whole Lens/rail until the next read (the "everything vanishes
  // while Claude thinks" bug). The pid is stable for this pane's lifetime and
  // its session id never changes, so once resolved we keep it (keyed by pid;
  // cleared when the PTY exits and pid → null). Converge via a render-phase
  // setState (no blank frame, unlike an effect).
  const [latched, setLatched] = useState<{ pid: number; sessionId: string } | null>(null);
  if (
    ptyPid &&
    registrySessionId &&
    (latched?.pid !== ptyPid || latched.sessionId !== registrySessionId)
  ) {
    setLatched({ pid: ptyPid, sessionId: registrySessionId });
  }
  const latchedSessionId = ptyPid && latched?.pid === ptyPid ? latched.sessionId : null;
  const sessionId = registrySessionId ?? latchedSessionId ?? resumeSessionId ?? null;
  const filename = sessionId ? `${sessionId}.jsonl` : null;

  // "Open chat" from the team detail overlay: jump to that session's Mission
  // Control. Same session → just close the overlay. Different session →
  // real navigation, which remounts this view and kills a live PTY — confirm
  // first when one is actually running (LENS-only viewing has nothing to lose).
  const openSessionFromOverlay = useCallback(
    (session: SessionSummary) => {
      const targetId = session.filename.replace(/\.jsonl$/, '');
      if (targetId === sessionId) {
        setOverlay(null);
        return;
      }
      if (!onOpenSession) return;
      if (
        terminalMounted &&
        termStatus === 'running' &&
        !window.confirm(
          'Opening another session will close the current terminal session. Continue?'
        )
      ) {
        return;
      }
      onOpenSession(targetId);
    },
    [sessionId, onOpenSession, terminalMounted, termStatus]
  );

  // The shells this session left running in the background — the CLI footer's
  // "1 shell". Same query the rail reads, so it costs no second read. Only the
  // live CLI process's own shells count, so this needs when it started: the
  // registry says (this pane's entry first, else whichever process runs the
  // session elsewhere), and this pane's own spawn time covers the seconds
  // before the CLI joins the registry.
  const { data: chatMessages } = useChatSession(project.hash, filename);
  const sessionProcessed = useMemo(
    () => (chatMessages ? buildProcessedMessages(chatMessages) : []),
    [chatMessages]
  );
  const backgroundShells = useMemo(
    () => buildBackgroundShells(sessionProcessed),
    [sessionProcessed]
  );
  // For the tab card: the same answer the rail's strip gives, off the same read.
  const gitBranch = useMemo(() => shownBranch(sessionGitState(chatMessages)), [chatMessages]);
  // A file a read, a diff or the rail names, opened in the Files viewer — when
  // it is a file of this project; elsewhere there is nothing to open it in.
  const fileOpenerFor = useCallback(
    (path: string) => {
      const rel = relToRoot(path, project.realPath);
      return rel ? () => setOverlay({ kind: 'file', rel }) : undefined;
    },
    [project.realPath]
  );

  // A file open in the overlay is read again each time this session writes it:
  // the count of its writes is part of the read's key.
  const openFileRel = overlay?.kind === 'file' ? overlay.rel : null;
  const openFileMarks = useMemo(() => {
    if (!openFileRel) return null;
    const root = project.realPath;
    const shellReads = contextFiles(sessionProcessed, root).flatMap(f =>
      f.reads.some(r => r.via === 'shell') ? [f.path] : []
    );
    const touched = touchedFiles(sessionProcessed.flatMap(p => p.toolGroups));
    return sessionMarks(touched, root, shellReads);
  }, [openFileRel, sessionProcessed, project.realPath]);
  const liveSince = useMemo(() => {
    const entries = (activeSessions ?? []).filter(s => sessionId && s.sessionId === sessionId);
    const own = entries.find(s => s.pid === ptyPid) ?? entries[0];
    if (own?.startedAt) return own.startedAt;
    return termStatus === 'running' ? ptySince : null;
  }, [activeSessions, sessionId, ptyPid, termStatus, ptySince]);

  // Whether Claude is working in this session right now — the registry's
  // `busy`, whichever process runs it (this pane's or a terminal elsewhere).
  // The orb that says so is on the session's tab (`SessionTabs`).
  const busy = activeSessions?.some(s => s.sessionId === sessionId && s.status === 'busy');

  // Back closes the terminal, as it always did; with Claude mid-turn in *this*
  // pane that throws work away, so it asks first. `busy` alone also holds for the
  // session running in a terminal elsewhere, which Back does not touch. Only the
  // top bar's Back asks: the Lens calls `onBack` after deleting the session, a
  // step the user has already confirmed.
  const paneBusy = terminalMounted && termStatus === 'running' && !!busy;

  // The session waiting on the user, for the Lens: its transcript does not hold
  // the question until it is answered (see `WaitingLine`). The terminal is
  // offered only when this pane runs one — showing it is all the button does;
  // without one, opening the terminal would resume the session a second time.
  const waitingEntry = activeSessions?.find(
    s => s.sessionId === sessionId && s.status === 'waiting'
  );
  // A string, not the entry: every registry read hands over new objects.
  const waitingFor = waitingEntry ? waitingEntry.waitingFor || '' : null;
  const paneRunning = terminalMounted && termStatus === 'running';
  const waiting = useMemo<SessionWaiting | null>(
    () =>
      waitingFor === null
        ? null
        : {
            reason: waitingFor || null,
            onOpenTerminal: paneRunning ? () => setView('terminal') : undefined,
          },
    [waitingFor, paneRunning, setView]
  );
  const requestBack = useCallback(() => {
    if (
      paneBusy &&
      !window.confirm(
        'Claude is still working in this session. Going back closes the terminal and stops it. Close it anyway?'
      )
    ) {
      return;
    }
    onBack();
  }, [paneBusy, onBack]);

  const { data: sessionList } = useSessionList(project.hash);
  const summary = useMemo(
    () => sessionList?.find(s => s.filename === filename),
    [sessionList, filename]
  );

  // ChatView needs a SessionSummary; once the id is known but the list hasn't
  // caught up yet, a minimal stand-in lets Lens mount (the transcript loads from
  // disk regardless, and the watcher refreshes the real metadata).
  const sessionForChat: SessionSummary | null = useMemo(() => {
    if (summary) return summary;
    if (!filename) return null;
    return {
      filename,
      date: new Date().toISOString(),
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      cacheSavings: 0,
      messageCount: 0,
      models: {},
    };
  }, [summary, filename]);

  const projectName = project.realPath.split(/[\\/]/).filter(Boolean).pop() || project.realPath;
  // Session title (custom > AI > first user message) — restored as the accent
  // crumb so the bar reads project / title / mode instead of a bare "TERMINAL".
  const title = summary ? sessionTitle(summary) : null;

  const onReportRef = useRef(onReport);
  useEffect(() => {
    onReportRef.current = onReport;
  }, [onReport]);
  useEffect(() => {
    onReportRef.current?.({
      pid: ptyPid,
      sessionId,
      title,
      color: summary?.agentColor ?? null,
      termStatus: terminalMounted ? termStatus : null,
      gitBranch,
    });
  }, [ptyPid, sessionId, title, summary?.agentColor, terminalMounted, termStatus, gitBranch]);

  async function insertPrompt(text: string) {
    promptInsertionRef.current?.abort();
    const insertion = new AbortController();
    promptInsertionRef.current = insertion;
    try {
      flushSync(() => {
        setOverlay(null);
        setView('terminal');
      });
      // Allow the newly visible terminal to fit before focusing it.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (insertion.signal.aborted) throw new Error('Prompt insertion cancelled.');
      if (!terminalPromptRef.current) throw new Error('The terminal is no longer open.');
      await terminalPromptRef.current.pastePrompt(text, insertion.signal);
    } finally {
      if (promptInsertionRef.current === insertion) promptInsertionRef.current = null;
    }
  }

  return (
    // When TERMINAL is active the view paints the terminal's own surface color so
    // the console blends into the frame with no visible seam (no slab edge);
    // LENS keeps the normal --cl-paper so the embedded chat reads as usual.
    // MissionRail keeps its own --cl-paper (set in railWrap). Holds in light + dark.
    <SessionColorFrame
      color={summary?.agentColor}
      className="cl-chat"
      style={{ background: view === 'terminal' ? TERMINAL_SURFACE[resolved] : 'var(--cl-paper)' }}
    >
      {/* Level one: the way back to the app, then every open session as a tab.
          The arrow walks the stack: with a detail open it returns to the
          session, and only from the session does it leave — and leaving keeps
          the session running (`onPark`); ending one is its tab's ✕. The active
          tab is painted with the surface below so it reads as part of it. */}
      <div
        className="cl-stabs-bar"
        style={
          {
            '--cl-stab-surface':
              view === 'terminal' ? TERMINAL_SURFACE[resolved] : 'var(--cl-paper)',
          } as React.CSSProperties
        }
      >
        <TabBarBack
          onClick={overlay ? closeOverlay : (onPark ?? requestBack)}
          label={overlay ? 'Back to session' : onPark ? 'Back to app' : 'Back'}
          title={
            overlay
              ? 'Back to session (Esc)'
              : onPark
                ? 'Back to the app; this session keeps running'
                : 'Back'
          }
        />
        {sessionTabs ?? (
          <span className="cl-stabs-fallback">
            <span>{projectName.toUpperCase()}</span>
            {title && <SessionColorIdentity color={summary?.agentColor} title={title} />}
          </span>
        )}
        {/* The right end, variant C: the detail on screen when one is open (what
            the crumb used to name, its status and its ✕), then the view switch,
            the session's background shells and the Mission Control toggle. */}
        <div className="cl-stabs-end">
          {overlayCrumb && (
            <span className="cl-stabs-crumb">
              {overlayCrumb.icon && <span aria-hidden>{overlayCrumb.icon}</span>}
              {overlayCrumb.kind !== 'tool' && (
                <span className="cl-stabs-crumb-kind">{overlayCrumb.kind} ·</span>
              )}
              <span className="truncate">{overlayCrumb.label}</span>
            </span>
          )}
          {overlay?.kind === 'tool' && (
            <span
              className={`cl-tool-status ${toolRunStatus(overlay.group.result, overlay.group.use.name).tone}`}
            >
              {toolRunStatus(overlay.group.result, overlay.group.use.name).label}
            </span>
          )}
          {overlay && overlay.kind !== 'file' && (
            <CloseOverlayButton label="Back to session" onClose={closeOverlay} />
          )}
          {filename && <SessionActions projectHash={project.hash} filename={filename} />}
          <ViewSwitch view={view} setView={setView} />
          <BackgroundShells shells={backgroundShells} liveSince={liveSince} compact />
          <TabBarRailToggle collapsed={railCollapsed} onToggle={toggleRail} />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        {/* main column */}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* the view: dark TUI slab or the embedded Lens chat (both kept mounted).
              Relative so a rail-opened detail overlay anchors to the content area
              (not over the whole split), keeping the Terminal/Lens switch and the
              rail visible — the same framing the Lens shows when a tool detail
              opens inside the chat, so the skill/tool page reads identically from
              either entry point. */}
          <div
            className="cl-session-stage"
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              padding: '12px 26px 22px',
              position: 'relative',
            }}
          >
            {terminalMounted && (
              <div
                className="flex-1 min-w-0"
                style={{ display: view === 'terminal' ? 'block' : 'none' }}
              >
                <TerminalPane
                  ref={terminalPromptRef}
                  cwd={project.realPath}
                  resumeSessionId={resumeSessionId}
                  attachJobId={attachJobId}
                  onPid={onPid}
                  onStatus={setTermStatus}
                  active={active && view === 'terminal'}
                />
              </div>
            )}
            {sessionForChat && (
              <div
                className="flex-1 min-w-0"
                style={{ display: view === 'lens' ? 'block' : 'none' }}
              >
                <ChatView
                  embedded
                  project={project}
                  session={sessionForChat}
                  onBack={onBack}
                  onOpenSkill={skill => setOverlay({ kind: 'skill-def', skill })}
                  onOpenAgent={agent => setOverlay({ kind: 'agent-def', agent })}
                  // A tool opened from the embedded transcript is hoisted to this
                  // frame's overlay — the same one the rail opens. Otherwise it
                  // would mount inside a ChatView whose top bar isn't on screen,
                  // and this bar would have no idea a tool is open to crumb it.
                  onOpenTool={group => setOverlay({ kind: 'tool', group })}
                  fileOpenerFor={fileOpenerFor}
                  jumpToTurnRef={jumpToTurnRef}
                  focusMessageUuid={focusMessageUuid}
                  waiting={waiting}
                />
              </div>
            )}

            {/* detail overlay opened from the rail — scoped to the content box (the
                pane area), so the header row above and the rail to the right stay
                visible. Matches the Lens's own tool-detail overlay one-to-one.
                Above the Lens's control pill (z 40): the pill drives the
                transcript underneath, and over a detail it covered the page. */}
            {overlay && (
              <div
                className="absolute z-50 flex flex-col overflow-hidden"
                style={{ top: 12, right: 26, bottom: 22, left: 26, background: 'var(--cl-paper)' }}
              >
                {/* Every panel here is `chromeless`: the crumb in the top bar,
                    the ✕ in the tab row and Esc are the frame's, so a panel
                    drawing its own bar would only repeat them one line lower. */}
                <SessionDetailPanel
                  overlay={overlay}
                  project={project}
                  sessionId={sessionId}
                  onClose={closeOverlay}
                  fileOpenerFor={fileOpenerFor}
                  fileMarks={openFileMarks}
                  onOpenChat={openSessionFromOverlay}
                />
              </div>
            )}

            <SessionBottomGlow color={summary?.agentColor} active={view === 'lens'} />
          </div>
        </main>

        {/* mission control rail — persistent in both modes, collapsible for width */}
        {!railCollapsed && (
          <MissionRail
            hash={project.hash}
            sessionId={sessionId}
            realPath={project.realPath}
            width={railWidth}
            onWidthChange={onWidthChange}
            onOpenTool={group => setOverlay({ kind: 'tool', group })}
            onOpenChange={change => setOverlay({ kind: 'change', change })}
            onOpenAgent={agent => setOverlay({ kind: 'agent', agent })}
            onOpenSkillDef={skill => setOverlay({ kind: 'skill-def', skill })}
            onOpenAgentDef={agent => setOverlay({ kind: 'agent-def', agent })}
            onOpenTeam={teamName => setOverlay({ kind: 'team', teamName })}
            // A QUESTIONS row locates its turn in the Lens, which reveals the
            // Lens first when we're on Terminal.
            onLocateTurn={jumpToTurn}
            // A MESSAGES row opens the exchange the way the bubbles do: the
            // session is this one, whichever side of the message it was on.
            onOpenExchange={
              onOpenExchange && sessionId
                ? msgId => onOpenExchange({ sessionId, msgId })
                : undefined
            }
            onUsePrompt={insertPrompt}
            onOpenFile={rel => setOverlay({ kind: 'file', rel })}
            openFile={openFileRel}
            // The Lens has the control pill, which carries context % and spend
            // with their readout cards; the Terminal has no pill, so there the
            // rail's band stays and is the only place either figure is stated.
            showVitals={view === 'terminal'}
          />
        )}
      </div>
    </SessionColorFrame>
  );
}
