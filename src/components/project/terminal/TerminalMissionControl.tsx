import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveSessions, useSessionList } from '../../../hooks/useIPC';
import { useTheme } from '../../../hooks/useTheme';
import type { SessionSummary } from '../../../hooks/useIPC';
import { TopBar } from '../shared/TopBar';
import { ToolDetailPanel } from '../chat/ToolDetailPanel';
import { SubagentTranscriptPanel } from '../chat/SubagentTranscriptPanel';
import { ChatView } from '../chat/ChatView';
import type { SessionAgent, ToolGroup } from '../chat/utils';
import { fmtCost } from '../utils';
import { TerminalPane, STATUS_LABEL, TERMINAL_SURFACE, type TerminalStatus } from './TerminalPane';
import { MissionRail } from './MissionRail';

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

const RAIL_DEFAULT = 432;
const RAIL_MIN = 380;
const RAIL_MAX = 560;

type View = 'terminal' | 'lens';
type Overlay = { kind: 'tool'; group: ToolGroup } | { kind: 'agent'; agent: SessionAgent } | null;

/** Glass segmented control: TERMINAL (dark-slab active) ↔ LENS (paper active). */
function ViewSwitch({ view, setView }: { view: View; setView: (v: View) => void }) {
  const opts: Array<{ id: View; label: string; glyph: string }> = [
    { id: 'terminal', label: 'TERMINAL', glyph: '❯_' },
    { id: 'lens', label: 'LENS', glyph: '◎' },
  ];
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: 3,
        borderRadius: 999,
        background: 'var(--cl-glass-bg-strong)',
        border: '1px solid var(--cl-glass-border)',
        WebkitBackdropFilter: 'blur(12px) saturate(1.5)',
        backdropFilter: 'blur(12px) saturate(1.5)',
        boxShadow: 'inset 0 1px 0 var(--cl-glass-highlight)',
        flexShrink: 0,
      }}
    >
      {opts.map(o => {
        const on = view === o.id;
        const dark = o.id === 'terminal';
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setView(o.id)}
            className="inline-flex items-center transition-colors"
            style={{
              gap: 7,
              padding: '6px 14px',
              borderRadius: 999,
              background: on ? (dark ? '#262421' : 'var(--cl-paper)') : 'transparent',
              boxShadow: on ? '0 1px 4px oklch(0 0 0/.14)' : 'none',
            }}
          >
            <span
              className="font-mono"
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: on ? (dark ? '#e0654a' : 'var(--cl-accent-ink)') : 'var(--cl-ink-4)',
              }}
            >
              {o.glyph}
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: 9.5,
                letterSpacing: '0.14em',
                fontWeight: on ? 700 : 500,
                color: on ? (dark ? '#efece4' : 'var(--cl-ink)') : 'var(--cl-ink-4)',
              }}
            >
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Collapse/expand toggle for the Mission Control rail — a panel-right glyph
 *  (right pane filled when the rail is shown). Stays visible in the frame so the
 *  rail can be reopened after collapsing. Collapsed state is persisted by the parent. */
function RailToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
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
          <rect x="9.75" y="3.25" width="4.25" height="9.5" fill="currentColor" stroke="none" opacity="0.22" />
        )}
      </svg>
    </button>
  );
}

export function TerminalMissionControl({
  project,
  resumeSessionId,
  onBack,
}: {
  project: { hash: string; realPath: string };
  resumeSessionId?: string;
  onBack: () => void;
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
  const setView = useCallback((v: View) => {
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

  const [ptyPid, setPtyPid] = useState<number | null>(null);
  const [termStatus, setTermStatus] = useState<TerminalStatus>('starting');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const closeOverlay = useCallback(() => setOverlay(null), []);

  // Esc closes a rail detail overlay (the embedded chat handles its own Esc).
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOverlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, closeOverlay]);

  // The CLI registers itself in `~/.claude/sessions/<pid>.json` a few seconds
  // after boot; matching by the PTY's pid pins down *this* terminal's session.
  // Until then (or on CLI < 2.x) fall back to the resumed id. The registry wins
  // once available: `--resume` may mint a fresh session id.
  const { data: activeSessions } = useActiveSessions();
  const registrySessionId =
    (ptyPid && activeSessions?.find(s => s.pid === ptyPid && s.sessionId)?.sessionId) || null;
  const sessionId = registrySessionId ?? resumeSessionId ?? null;
  const filename = sessionId ? `${sessionId}.jsonl` : null;

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

  return (
    // When TERMINAL is active the view paints the terminal's own surface color so
    // the console blends into the frame with no visible seam (no slab edge);
    // LENS keeps the normal --cl-paper so the embedded chat reads as usual.
    // MissionRail keeps its own --cl-paper (set in railWrap). Holds in light + dark.
    <div
      className="cl-chat"
      style={{ background: view === 'terminal' ? TERMINAL_SURFACE[resolved] : 'var(--cl-paper)' }}
    >
      <TopBar
        onBack={onBack}
        crumbs={[{ label: projectName.toUpperCase() }, { label: 'TERMINAL', accent: true }]}
        right={
          <div className="flex items-center" style={{ gap: 14 }}>
            {terminalMounted && (
              <span
                className="flex items-center font-mono uppercase"
                style={{ gap: 7, fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--cl-ink-3)' }}
              >
                <span
                  aria-hidden
                  className={termStatus === 'running' ? 'cl-live-dot' : ''}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: termStatus === 'running' ? 'var(--cl-ok)' : 'var(--cl-ink-4)',
                  }}
                />
                {termStatus === 'running' ? 'RUNNING' : STATUS_LABEL[termStatus].toUpperCase()}
              </span>
            )}
            {summary && (
              <span
                className="font-mono"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--cl-accent-ink)',
                }}
              >
                {fmtCost(summary.estimatedCost)}
              </span>
            )}
          </div>
        }
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        {/* main column */}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* frame above the console: path + Terminal/Lens switch */}
          <div className="shrink-0 flex items-center" style={{ gap: 14, padding: '14px 26px 0' }}>
            <span
              className="font-mono truncate"
              style={{ fontSize: 10, letterSpacing: '0.06em', color: 'var(--cl-ink-3)' }}
              title={project.realPath}
            >
              {project.realPath}
            </span>
            <span style={{ flex: 1 }} />
            <ViewSwitch view={view} setView={setView} />
            <RailToggle collapsed={railCollapsed} onToggle={toggleRail} />
          </div>

          {/* the view: dark TUI slab or the embedded Lens chat (both kept mounted).
              Relative so a rail-opened detail overlay anchors to the content area
              (not over the whole split), keeping the Terminal/Lens switch and the
              rail visible — the same framing the Lens shows when a tool detail
              opens inside the chat, so the skill/tool page reads identically from
              either entry point. */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: '12px 26px 22px', position: 'relative' }}>
            {terminalMounted && (
              <div
                className="flex-1 min-w-0"
                style={{ display: view === 'terminal' ? 'block' : 'none' }}
              >
                <TerminalPane
                  cwd={project.realPath}
                  resumeSessionId={resumeSessionId}
                  onPid={setPtyPid}
                  onStatus={setTermStatus}
                />
              </div>
            )}
            {sessionForChat && (
              <div
                className="flex-1 min-w-0"
                style={{ display: view === 'lens' ? 'block' : 'none' }}
              >
                <ChatView embedded project={project} session={sessionForChat} onBack={onBack} />
              </div>
            )}

            {/* detail overlay opened from the rail — scoped to the content box (the
                pane area), so the header row above and the rail to the right stay
                visible. Matches the Lens's own tool-detail overlay one-to-one. */}
            {overlay && (
              <div
                className="absolute z-20 flex flex-col overflow-hidden"
                style={{ top: 12, right: 26, bottom: 22, left: 26, background: 'var(--cl-paper)' }}
              >
                {overlay.kind === 'tool' ? (
                  <ToolDetailPanel group={overlay.group} onBack={closeOverlay} />
                ) : overlay.agent.agentId && sessionId ? (
                  <SubagentTranscriptPanel
                    hash={project.hash}
                    sessionFilename={`${sessionId}.jsonl`}
                    agentId={overlay.agent.agentId}
                    subagentType={overlay.agent.subagentType}
                    description={overlay.agent.description}
                    onBack={closeOverlay}
                  />
                ) : null}
              </div>
            )}
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
            onOpenAgent={agent => setOverlay({ kind: 'agent', agent })}
          />
        )}
      </div>
    </div>
  );
}
