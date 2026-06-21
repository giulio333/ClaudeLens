import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveSessions, useSessionList } from '../../../hooks/useIPC';
import { useSessionTags } from '../../../hooks/useSessionTags';
import { ManagedTagChip } from '../sessions/ManagedTagChip';
import { TagPicker } from '../sessions/TagPicker';
import { useTheme } from '../../../hooks/useTheme';
import type { Agent, SessionSummary, Skill } from '../../../hooks/useIPC';
import { TopBar } from '../shared/TopBar';
import { ToolDetailPanel } from '../chat/ToolDetailPanel';
import { SubagentTranscriptPanel } from '../chat/SubagentTranscriptPanel';
import { SkillDetailView } from '../skills/SkillDetailView';
import { AgentDetailView } from '../agents/AgentDetailView';
import { ChatView } from '../chat/ChatView';
import type { SessionAgent, ToolGroup } from '../chat/utils';
import { fmtCost, sessionTitle } from '../utils';
import { TerminalPane, STATUS_LABEL, TERMINAL_SURFACE, type TerminalStatus } from './TerminalPane';
import { MissionRail } from './MissionRail';
import { SessionOutline } from './SessionOutline';

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
// v2 Outline column — a fixed-width session navigator on the left.
const OUTLINE_WIDTH = 266;

type View = 'terminal' | 'lens';
type Overlay =
  | { kind: 'tool'; group: ToolGroup }
  | { kind: 'agent'; agent: SessionAgent }
  | { kind: 'skill-def'; skill: Skill }
  | { kind: 'agent-def'; agent: Agent }
  | null;

/** v2 centered tab switch: TERMINAL ❯_ ↔ LENS ◎ as underline tabs that head the
 *  focus (center) column, replacing the glass segmented pill (design 02 · Outline
 *  + Focus). The active tab carries an accent bottom border. */
function ViewTabs({ view, setView }: { view: View; setView: (v: View) => void }) {
  const opts: Array<{ id: View; label: string; glyph: string }> = [
    { id: 'terminal', label: 'TERMINAL', glyph: '❯_' },
    { id: 'lens', label: 'LENS', glyph: '◎' },
  ];
  return (
    <div
      className="shrink-0 flex items-center justify-center"
      style={{ gap: 30, padding: '0 26px', borderBottom: '1px solid var(--cl-line)' }}
    >
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
              style={{ fontSize: 10, fontWeight: 700, color: on ? 'var(--cl-accent-ink)' : 'var(--cl-ink-4)' }}
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
  );
}

/** Collapse/expand toggle for the v2 Outline column — a panel-left glyph (left
 *  pane filled when the outline is shown). Mirrors RailToggle. */
function OutlineToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? 'Show session outline' : 'Hide session outline';
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
        <line x1="6.25" y1="3.25" x2="6.25" y2="12.75" />
        {!collapsed && (
          <rect x="2" y="3.25" width="4.25" height="9.5" fill="currentColor" stroke="none" opacity="0.22" />
        )}
      </svg>
    </button>
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

  // v2 Outline column — collapsible like the rail, defaults to shown for a
  // resumed session (something to index), hidden for a fresh terminal.
  const [outlineCollapsed, setOutlineCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('tmc-outline-collapsed');
    if (saved != null) return saved === '1';
    return !resumeSessionId;
  });
  const toggleOutline = useCallback(() => {
    setOutlineCollapsed(c => {
      const next = !c;
      localStorage.setItem('tmc-outline-collapsed', next ? '1' : '0');
      return next;
    });
  }, []);

  // Imperative scroll handle into the embedded Lens transcript — an outline row
  // calls it to jump to a turn (set by ChatView, null in Terminal mode).
  const jumpToTurnRef = useRef<((n: number) => void) | null>(null);
  const jumpToTurn = useCallback((turnN: number) => {
    if (view === 'lens') {
      jumpToTurnRef.current?.(turnN);
      return;
    }
    // Coming from Terminal: reveal the Lens first, then scroll once the
    // transcript is on screen (it stays mounted under display:none, so the ref
    // is already wired — only its visibility flips this frame).
    setView('lens');
    requestAnimationFrame(() => jumpToTurnRef.current?.(turnN));
  }, [view, setView]);

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
  // Latch the resolved id. The CLI rewrites `~/.claude/sessions/<pid>.json` on
  // every heartbeat; a (debounced) registry read landing mid-write transiently
  // drops our entry, so `registrySessionId` flaps to null — which would null out
  // `sessionId`, disable `useChatSession`, and blank the whole Lens/rail until
  // the next read (the "everything vanishes while Claude thinks" bug). The pid is
  // stable for this pane's lifetime and its session id never changes, so once
  // resolved we keep it (keyed by pid; cleared when the PTY exits and pid → null).
  // Converge via a render-phase setState (no blank frame, unlike an effect).
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

  // Session tags, editable from inside the session (the embedded ChatView drops
  // its own TopBar, so the tag affordance lives in this frame's chrome instead).
  const {
    tags: allTags,
    tagsForSession,
    toggleTagOnSession,
    removeTagFromSession,
    renameTag,
    deleteTag,
  } = useSessionTags(project.hash);
  const sessionFilename = sessionForChat?.filename ?? null;
  const sessionTags = sessionFilename ? tagsForSession(sessionFilename) : [];
  const [tagPickerAnchor, setTagPickerAnchor] = useState<DOMRect | null>(null);

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
        crumbs={[
          { label: projectName.toUpperCase() },
          ...(title ? [{ label: title, accent: true }] : []),
        ]}
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
        {/* v2 Outline column — the session navigator (collapsible) */}
        {!outlineCollapsed && (
          <SessionOutline
            hash={project.hash}
            sessionId={sessionId}
            realPath={project.realPath}
            width={OUTLINE_WIDTH}
            onJump={jumpToTurn}
            onOpenTool={group => setOverlay({ kind: 'tool', group })}
            onOpenAgent={agent => setOverlay({ kind: 'agent', agent })}
            onOpenSkillDef={skill => setOverlay({ kind: 'skill-def', skill })}
          />
        )}

        {/* main column */}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* frame above the console: session tags + outline/rail toggles */}
          <div className="shrink-0 flex items-center" style={{ gap: 14, padding: '14px 26px 0' }}>
            <span style={{ flex: 1 }} />
            {sessionFilename && (
              <div className="cl-chat-tags" onClick={e => e.stopPropagation()}>
                {sessionTags.map(name => (
                  <ManagedTagChip
                    key={name}
                    name={name}
                    onRemoveFromItem={() => removeTagFromSession(sessionFilename, name)}
                    removeLabel="Remove from this session"
                    onRename={renameTag}
                    onDelete={() => deleteTag(name)}
                  />
                ))}
                <button
                  type="button"
                  className="cl-chat-tag-add"
                  aria-label="Add tag"
                  title="Add tag"
                  data-haspicker={!!tagPickerAnchor}
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTagPickerAnchor(prev => (prev ? null : rect));
                  }}
                >
                  + tag
                </button>
                {tagPickerAnchor && (
                  <TagPicker
                    anchorRect={tagPickerAnchor}
                    allTags={allTags}
                    selected={sessionTags}
                    onToggle={name => toggleTagOnSession(sessionFilename, name)}
                    onClose={() => setTagPickerAnchor(null)}
                  />
                )}
              </div>
            )}
            <OutlineToggle collapsed={outlineCollapsed} onToggle={toggleOutline} />
            <RailToggle collapsed={railCollapsed} onToggle={toggleRail} />
          </div>

          {/* v2: the Terminal/Lens switch heads the focus column as centered tabs */}
          <ViewTabs view={view} setView={setView} />

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
                <ChatView
                  embedded
                  project={project}
                  session={sessionForChat}
                  onBack={onBack}
                  onOpenSkill={skill => setOverlay({ kind: 'skill-def', skill })}
                  onOpenAgent={agent => setOverlay({ kind: 'agent-def', agent })}
                  jumpToTurnRef={jumpToTurnRef}
                />
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
                ) : overlay.kind === 'skill-def' ? (
                  <SkillDetailView skill={overlay.skill} project={project} onBack={closeOverlay} readOnly />
                ) : overlay.kind === 'agent-def' ? (
                  <AgentDetailView agent={overlay.agent} project={project} onBack={closeOverlay} readOnly />
                ) : overlay.kind === 'agent' && overlay.agent.agentId && sessionId ? (
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
            onOpenSkillDef={skill => setOverlay({ kind: 'skill-def', skill })}
            onOpenAgentDef={agent => setOverlay({ kind: 'agent-def', agent })}
          />
        )}
      </div>
    </div>
  );
}
