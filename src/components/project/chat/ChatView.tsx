import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  saveMarkdownExport,
  savePdfExport,
  useActiveSessions,
  useChatSession,
  useSessionSubagents,
  useGlobalAgents,
  useProjectAgents,
  useAllSkills,
  usePlugins,
} from '../../../hooks/useIPC';
import { SessionSummary, Skill, Agent } from '../../../hooks/useIPC';
import { sessionTitle } from '../utils';
import { trackEvent } from '../../../lib/telemetry';
import {
  buildProcessedMessages,
  correlateSessionAgents,
  correlateSessionSkills,
  ChatDetailsFilter,
  SessionAgent,
  ToolGroup,
  TurnDescriptor,
  TurnFilter,
} from './utils';
import {
  buildChatExportDocument,
  CHAT_EXPORT_PRESETS,
  ChatExportFormat,
  ChatExportPreset,
} from './export';
import { useChatAutoScroll } from './useAutoScroll';
import { useTranscriptModel } from './useTranscriptModel';
import { ToolDetailPanel } from './ToolDetailPanel';
import { SubagentTranscriptPanel } from './SubagentTranscriptPanel';
import { MessageBubble, ToolsHiddenBadge } from './MessageBubble';
import { ChatControlPill } from './ChatControlPill';
import { FocusMinimap } from './FocusMinimap';
import { agentTintColor } from '../shared/entityOptions';
import { TopBar } from '../shared/TopBar';
import { DeleteSessionDialog } from '../shared/DeleteSessionDialog';
import { SessionGraphView } from './graph/SessionGraphView';
import { QueryError } from '../../QueryError';
import { useSessionTags } from '../../../hooks/useSessionTags';
import { ManagedTagChip } from '../sessions/ManagedTagChip';
import { TagPicker } from '../sessions/TagPicker';
import { useHighlights } from './useHighlights';
import { useHighlightLayer } from './useHighlightLayer';
import { HighlightToolbar } from './HighlightToolbar';

type ViewMode = 'chat' | 'timeline';

export function ChatView({
  project,
  session,
  onBack,
  onOpenSkill,
  onOpenAgent,
  onContinueChat,
  embedded = false,
  jumpToTurnRef,
}: {
  project: { hash: string; realPath: string };
  session: SessionSummary;
  onBack: () => void;
  /** Deep-link to a skill detail view (from an inline skill card or the dock). */
  onOpenSkill?: (skill: Skill) => void;
  /** Deep-link to an agent detail view (from an inline agent card). */
  onOpenAgent?: (agent: Agent) => void;
  /** Opens this session in the live SDK chat (`LiveChatView` in resume mode) so
   *  the conversation continues in-app. Hidden while the session is live in a
   *  terminal — replying there would race the CLI on the same transcript. */
  onContinueChat?: () => void;
  /** Imperative handle exposed to an outside navigator (the v2 Outline column):
   *  set to this view's `jumpToTurn` so a session-outline row can scroll the
   *  embedded transcript to a turn. Null while unmounted / Terminal mode. */
  jumpToTurnRef?: React.MutableRefObject<((n: number) => void) | null>;
  /** Rendered inside the unified Terminal/Lens view: drop the own TopBar (the
   *  unified frame provides chrome + the Terminal↔Lens switch), the right-edge
   *  minimap (the Mission Control rail is the companion surface) and the
   *  composer — this surface is read-only, the live session belongs to the
   *  terminal's PTY. The floating control pill stays — it anchors to the chat
   *  column. */
  embedded?: boolean;
}) {
  const {
    data: messages,
    isLoading,
    isError,
    error,
    refetch,
  } = useChatSession(project.hash, session.filename);
  const { data: subagentMetas } = useSessionSubagents(project.hash, session.filename);
  const { data: globalAgents } = useGlobalAgents();
  const { data: projectAgents } = useProjectAgents(project.realPath);
  const { data: allSkills } = useAllSkills(project.realPath);
  const { data: plugins } = usePlugins();

  // Resolve a dispatched sub-agent's identity color from its definition
  // (`subagent_type` → agent.color). Project agents win over globals on name
  // clash. Returns undefined when the agent is unknown or has no color, so the
  // cards fall back to their default tint.
  const agentColorOf = useMemo(() => {
    const byName = new Map<string, string>();
    for (const a of globalAgents ?? []) if (a.color) byName.set(a.name, a.color);
    for (const a of projectAgents ?? []) if (a.color) byName.set(a.name, a.color);
    return (subagentType: string) => byName.get(subagentType);
  }, [globalAgents, projectAgents]);

  // Resolve a sub-agent's full definition by name (project wins on clash) so an
  // expanded agent card can deep-link to its detail view.
  const agentOf = useMemo(() => {
    const byName = new Map<string, Agent>();
    for (const a of globalAgents ?? []) byName.set(a.name, a);
    for (const a of projectAgents ?? []) byName.set(a.name, a);
    return (subagentType: string) => byName.get(subagentType);
  }, [globalAgents, projectAgents]);

  // Resolve a skill's full definition by name (the slash-command id) — feeds both
  // the inline skill card link and the footer skill dock.
  const skillOf = useMemo(() => {
    const byName = new Map<string, Skill>();
    for (const s of allSkills ?? []) byName.set(s.name, s);
    return (name: string) => byName.get(name);
  }, [allSkills]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [detailsFilter, setDetailsFilter] = useState<ChatDetailsFilter>('minimal');
  const [selectedTool, setSelectedTool] = useState<ToolGroup | null>(null);
  const [transcriptAgent, setTranscriptAgent] = useState<SessionAgent | null>(null);
  const [exportPreset, setExportPreset] = useState<ChatExportPreset>('team');
  const [exporting, setExporting] = useState<ChatExportFormat | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // Selective export: when `selected` is non-empty the export covers only those
  // turns (by message uuid), else the full chat. `selectionMode` shows per-turn
  // checkboxes; the per-turn export button seeds `selected` with a single uuid
  // (without entering selection mode) and calls openExportSheetRef to raise it.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTurns, setSelectedTurns] = useState<Set<string>>(() => new Set());
  // Imperative open of the export sheet, registered by ChatControlPill so the
  // per-turn export button (in the transcript) can raise it from afar.
  const openExportSheetRef = useRef<(() => void) | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  // Session tags, editable from inside the session (mirrors the topic view):
  // assign/create via the picker, manage each chip via the shared menu.
  const {
    tags: allTags,
    tagsForSession,
    toggleTagOnSession,
    removeTagFromSession,
    renameTag,
    deleteTag,
  } = useSessionTags(project.hash);
  const sessionTags = tagsForSession(session.filename);
  const [tagPickerAnchor, setTagPickerAnchor] = useState<DOMRect | null>(null);
  // Read-only, disk-backed viewer: `displayMessages` is whatever the session
  // transcript holds, kept fresh by the file watcher. The live in-app SDK chat is
  // a separate view (`LiveChatView`) that streams without ever reading disk.
  // Memoized so the empty-fallback array stays referentially stable (a fresh `[]`
  // each render would re-run the `processed` memo below).
  const displayMessages = useMemo(() => messages ?? [], [messages]);

  const [turnFilter, setTurnFilter] = useState<TurnFilter>('all');
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const turnRefs = useRef<Record<number, HTMLElement | null>>({});
  // Bottom-pinning scroll: open at the bottom, follow every content growth
  // (stream, tool cards, density, late reflows) while anchored, detach on user
  // scroll-up, re-attach near the bottom — see useAutoScroll.ts.
  const {
    feedRef,
    innerRef: transcriptInnerRef,
    followRef,
    pin,
    onScroll: onFeedScroll,
    onWheel: onFeedWheel,
  } = useChatAutoScroll(session.filename);
  // The transcript column drives two consumers: the auto-scroll callback ref and
  // the highlight layer. The latter needs the element as *state* (not a ref) so
  // its listener effects re-run when the column mounts — it only appears after
  // the messages load, so a ref alone would leave selection capture unwired.
  const [transcriptEl, setTranscriptEl] = useState<HTMLDivElement | null>(null);
  const mergedInnerRef = useCallback(
    (el: HTMLDivElement | null) => {
      setTranscriptEl(el);
      transcriptInnerRef(el);
    },
    [transcriptInnerRef]
  );
  // Ref mirror of activeTurn so the density-change layout effect can read
  // the current turn without listing activeTurn as a dependency (which would
  // cause it to fire on every scroll-spy update, fighting user scrolling).
  const activeTurnRef = useRef<number | null>(null);

  // Heavy: rebuild the processed transcript only when the displayed messages change.
  const processed = useMemo(() => buildProcessedMessages(displayMessages), [displayMessages]);
  const canExport = processed.length > 0 && !isLoading;

  const sessionId = useMemo(() => session.filename.replace(/\.jsonl$/, ''), [session.filename]);

  // Live in a terminal right now? (Active-sessions registry; SDK-spawned
  // sessions — including this view's own composer — are excluded from it.)
  const { data: activeSessions = [] } = useActiveSessions();
  const liveInTerminal = activeSessions.some(a => a.sessionId === sessionId);

  // Sub-agents dispatched in this session, correlated to their internal
  // transcript files. Drives the right-hand activity rail.
  const agents = useMemo(
    () => correlateSessionAgents(processed, subagentMetas ?? []),
    [processed, subagentMetas]
  );

  // Skills invoked in this session, linked to their definitions — drives the
  // footer skill dock (sibling of the agent dock).
  const skills = useMemo(
    () => correlateSessionSkills(processed, allSkills ?? [], plugins ?? []),
    [processed, allSkills, plugins]
  );

  // The Focus transcript model: per-turn descriptors, the visible/minimap items,
  // the collapsed stream rows, and the filter counts — all derived from the
  // processed messages + the detail filter (see useTranscriptModel.ts).
  const resolveAgentTint = useCallback(
    (t: string) => agentTintColor(agentColorOf(t)),
    [agentColorOf]
  );
  const { descriptors, minimapItems, renderItems, filterCounts } = useTranscriptModel({
    processed,
    detailsFilter,
    agentColor: resolveAgentTint,
  });

  // Derived (not stored) so it can never get stuck: the active filter falls back
  // to "All" when it no longer has matching turns — e.g. Thinking in minimal
  // mode, or any chip that just dropped to 0 (and is now hidden) — otherwise the
  // transcript would stay fully dimmed with no way back.
  const activeFilter: TurnFilter =
    turnFilter !== 'all' &&
    ((turnFilter === 'thinking' && detailsFilter === 'minimal') || filterCounts[turnFilter] === 0)
      ? 'all'
      : turnFilter;

  // Per-turn match against the active type filter (non-matching turns are dimmed,
  // never removed, so the conversation thread stays continuous).
  const matchesFilter = useCallback(
    (d: TurnDescriptor) => {
      switch (activeFilter) {
        case 'tools':
          return d.hasTools;
        case 'thinking':
          return d.hasThinking && detailsFilter === 'all';
        case 'questions':
          return d.hasQuestion;
        case 'plan':
          return d.hasPlan;
        default:
          return true;
      }
    },
    [activeFilter, detailsFilter]
  );

  // Stable ref setter (keyed by the turn's data-n) so MessageBubble's memo holds.
  const setTurnRef = useCallback((el: HTMLElement | null) => {
    const n = el?.dataset.n;
    if (el && n) turnRefs.current[Number(n)] = el;
  }, []);

  // Scroll-spy: highlight the turn nearest the viewport centre.
  useEffect(() => {
    const root = feedRef.current;
    if (!root || minimapItems.length === 0) return;
    setActiveTurn(prev => prev ?? minimapItems[0].n);
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) setActiveTurn(Number((e.target as HTMLElement).dataset.n));
        });
      },
      { root, rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    Object.values(turnRefs.current).forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, [minimapItems, viewMode, feedRef]);

  // Keep activeTurnRef in sync so layout effects can read it without deps.
  useEffect(() => {
    activeTurnRef.current = activeTurn;
  }, [activeTurn]);

  // Anchor the feed after a density change: if anchored to the bottom, snap
  // back to bottom; otherwise keep the scroll-spy turn in view. useLayoutEffect
  // fires after DOM mutations but before paint, so the corrected position never
  // flashes.
  useLayoutEffect(() => {
    if (followRef.current) {
      pin();
    } else {
      const turn = activeTurnRef.current;
      if (turn !== null) turnRefs.current[turn]?.scrollIntoView({ block: 'nearest' });
    }
  }, [detailsFilter, followRef, pin]);

  // The feed hides (display:none) behind overlays (tool detail, sub-agent
  // transcript) and in Timeline mode — it stays mounted so the composer keeps
  // the SDK session alive, but a hidden scroller collapses and loses its scroll
  // offset anyway. On return, an anchored view is re-pinned by the resize
  // observer; a detached one gets its active turn back instead of silently
  // restarting at the top.
  useLayoutEffect(() => {
    if (selectedTool || transcriptAgent || viewMode !== 'chat') return;
    if (!followRef.current) {
      const turn = activeTurnRef.current;
      if (turn !== null) turnRefs.current[turn]?.scrollIntoView({ block: 'start' });
    }
  }, [selectedTool, transcriptAgent, viewMode, followRef]);

  const jumpToTurn = useCallback((n: number) => {
    const el = turnRefs.current[n];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveTurn(n);
  }, []);

  // Publish `jumpToTurn` to an outside navigator (the v2 session Outline). The
  // outline lives in the unified Terminal/Lens frame, beside this embedded view;
  // wiring the handle lets an outline row scroll this transcript to its turn.
  useEffect(() => {
    if (!jumpToTurnRef) return;
    jumpToTurnRef.current = jumpToTurn;
    return () => {
      if (jumpToTurnRef.current === jumpToTurn) jumpToTurnRef.current = null;
    };
  }, [jumpToTurnRef, jumpToTurn]);

  // The rail's "active" agent = the latest dispatch at or above the current
  // scroll position. As you scroll past one agent's card toward the next, the
  // highlight advances — the recorded-session echo of Claude Code's live pill.
  const activeAgentKey = useMemo(() => {
    if (agents.length === 0) return null;
    if (activeTurn === null) return agents[0].key;
    let key: string | null = null;
    for (const a of agents) {
      if (a.turnN <= activeTurn) key = a.key;
      else break;
    }
    return key ?? agents[0].key;
  }, [agents, activeTurn]);

  const activeSkillKey = useMemo(() => {
    if (skills.length === 0) return null;
    if (activeTurn === null) return skills[0].key;
    let key: string | null = null;
    for (const s of skills) {
      if (s.turnN <= activeTurn) key = s.key;
      else break;
    }
    return key ?? skills[0].key;
  }, [skills, activeTurn]);

  const title = sessionTitle(session);
  const selectedExportPreset =
    CHAT_EXPORT_PRESETS.find(p => p.value === exportPreset) ?? CHAT_EXPORT_PRESETS[0];
  // Whether an overlay / alternate mode is covering the chat workspace. The
  // workspace is then hidden (display:none) but never unmounted — see the
  // comment at the render site.
  const chatHidden =
    Boolean(selectedTool) ||
    Boolean(transcriptAgent && transcriptAgent.agentId) ||
    isError ||
    viewMode !== 'chat';

  // Persistent text highlights: select text in the reading column to flag it
  // (survives across app restarts and bakes into exports). Capture + paint are
  // suspended while an overlay covers the transcript.
  const highlightsApi = useHighlights(sessionId);
  const highlightLayer = useHighlightLayer({
    container: transcriptEl,
    api: highlightsApi,
    enabled: !chatHidden,
  });

  // Stable callbacks so MessageBubble's memo holds (only selected/mode change).
  const handleToggleSelect = useCallback((uuid: string) => {
    setSelectedTurns(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }, []);

  const handleExportTurn = useCallback((uuid: string) => {
    setSelectedTurns(new Set([uuid]));
    setExportError(null);
    setExportMessage(null);
    openExportSheetRef.current?.();
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTurns(new Set());
    setSelectionMode(false);
  }, []);

  // The turns actually exported: the selected subset, or the whole chat.
  const exportProcessed =
    selectedTurns.size > 0 ? processed.filter(p => selectedTurns.has(p.msg.uuid)) : processed;

  async function handleExport(format: ChatExportFormat) {
    if (!canExport || exportProcessed.length === 0) return;
    setExporting(format);
    setExportError(null);
    setExportMessage(null);

    try {
      const doc = buildChatExportDocument({
        session,
        processed: exportProcessed,
        preset: exportPreset,
        highlights: highlightsApi.highlights,
      });
      const result =
        format === 'markdown'
          ? await saveMarkdownExport(`${doc.defaultBaseName}.md`, doc.markdown)
          : await savePdfExport(`${doc.defaultBaseName}.pdf`, doc.html);

      if (!result.canceled) {
        trackEvent('export_done', { format });
        setExportMessage(
          `Saved ${format === 'markdown' ? 'Markdown' : 'PDF'}${result.filePath ? ` to ${result.filePath}` : ''}`
        );
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  }

  const controlPill = (showTranscriptControls: boolean) => (
    <ChatControlPill
      showTranscriptControls={showTranscriptControls && processed.length > 0}
      filter={activeFilter}
      setFilter={setTurnFilter}
      counts={filterCounts}
      showThinking={detailsFilter === 'all'}
      density={detailsFilter}
      setDensity={setDetailsFilter}
      canExport={canExport}
      exporting={exporting}
      exportPreset={exportPreset}
      exportMessage={exportMessage}
      exportError={exportError}
      selectedExportPreset={selectedExportPreset}
      onOpenSheet={() => {
        setExportError(null);
        setExportMessage(null);
      }}
      openExportRef={openExportSheetRef}
      selectionMode={selectionMode}
      selectedCount={selectedTurns.size}
      onToggleSelectionMode={() => {
        setSelectionMode(on => {
          if (on) setSelectedTurns(new Set());
          return !on;
        });
      }}
      onClearSelection={clearSelection}
      onExportPreset={setExportPreset}
      onExport={handleExport}
      onDelete={() => setShowDelete(true)}
      agents={agents}
      activeAgentKey={activeAgentKey}
      agentColorOf={a => agentTintColor(agentColorOf(a.subagentType))}
      onOpenAgent={setTranscriptAgent}
      onLocateAgent={jumpToTurn}
      skills={skills}
      activeSkillKey={activeSkillKey}
      onOpenSkill={skill => onOpenSkill?.(skill)}
      onOpenSkillOutput={setSelectedTool}
      onLocateSkill={jumpToTurn}
    />
  );

  return (
    <div className="cl-chat">
      {!embedded && (
        <TopBar
          onBack={onBack}
          backLabel="Sessions"
          crumbs={[{ label: title, accent: true }]}
          right={
            <>
              {onContinueChat && !liveInTerminal && !isLoading && (
                <button
                  type="button"
                  className="cl-chat-tag-add"
                  title="Continue this conversation in-app through the Agent SDK — billed to Agent SDK credits, separate from your subscription plan"
                  onClick={onContinueChat}
                >
                  Continue chat
                </button>
              )}
              {liveInTerminal && (
                <span
                  title="This session is running in your terminal right now"
                  className="flex items-center gap-1.5 font-mono uppercase"
                  style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--cl-ok)' }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: 'var(--cl-ok)',
                    }}
                  />
                  Live in terminal
                </span>
              )}
              <div className="cl-chat-tags" onClick={e => e.stopPropagation()}>
                {sessionTags.map(name => (
                  <ManagedTagChip
                    key={name}
                    name={name}
                    onRemoveFromItem={() => removeTagFromSession(session.filename, name)}
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
                    onToggle={name => toggleTagOnSession(session.filename, name)}
                    onClose={() => setTagPickerAnchor(null)}
                  />
                )}
              </div>
              <div className="cl-view-mode" aria-label="View mode">
                {(['chat', 'timeline'] as ViewMode[]).map(v => (
                  <button
                    key={v}
                    type="button"
                    className={viewMode === v ? 'on' : ''}
                    onClick={() => setViewMode(v)}
                    title={
                      v === 'timeline'
                        ? 'Session timeline (swimlanes by file/tool)'
                        : 'Linear transcript'
                    }
                  >
                    {v === 'chat' ? 'Chat' : 'Timeline'}
                  </button>
                ))}
              </div>
            </>
          }
        />
      )}

      {showDelete && (
        <DeleteSessionDialog
          hash={project.hash}
          sessionFilename={session.filename}
          title={title}
          onCancel={() => setShowDelete(false)}
          onDeleted={() => {
            setShowDelete(false);
            onBack();
          }}
        />
      )}

      {/* Overlays and alternate modes visually replace the chat workspace, but
          the workspace below stays MOUNTED (hidden via display:none) so its
          scroll position, highlight layer and scroll-spy state survive being
          covered and don't reset when the overlay closes. */}
      {selectedTool ? (
        <ToolDetailPanel group={selectedTool} onBack={() => setSelectedTool(null)} />
      ) : transcriptAgent && transcriptAgent.agentId ? (
        <SubagentTranscriptPanel
          hash={project.hash}
          sessionFilename={session.filename}
          agentId={transcriptAgent.agentId}
          subagentType={transcriptAgent.subagentType}
          description={transcriptAgent.description}
          onBack={() => setTranscriptAgent(null)}
        />
      ) : isError ? (
        <div className="cl-chat-workspace">
          <QueryError title="Failed to load transcript" error={error} onRetry={() => refetch()} />
        </div>
      ) : viewMode === 'timeline' ? (
        <div className="cl-chat-workspace cl-chat-workspace--tl">
          {isLoading ? (
            <p className="cl-transcript-state">Loading transcript…</p>
          ) : (
            <SessionGraphView processed={processed} onSelectTool={setSelectedTool} />
          )}
          {controlPill(false)}
        </div>
      ) : null}

      <div
        className="cl-chat-workspace cl-chat-workspace--focus"
        style={chatHidden ? { display: 'none' } : undefined}
      >
        <main className="cl-chat-feed" ref={feedRef} onScroll={onFeedScroll} onWheel={onFeedWheel}>
          {isLoading && <p className="cl-transcript-state">Loading transcript…</p>}
          {messages?.length === 0 && !isLoading && (
            <p className="cl-transcript-state">No messages found in this session.</p>
          )}

          {processed.length > 0 && (
            <div className="cl-chat-reading">
              <div className="cl-transcript-inner" ref={mergedInnerRef}>
                {(() => {
                  let prevRole: string | null = null;
                  return renderItems.map(item => {
                    // Fallback only: a run of tool-only turns with no assistant
                    // turn before it (it leads the conversation, or follows a user
                    // turn) renders as a standalone badge at its stream position.
                    // The common case is folded into the preceding turn's header
                    // below — that "tools hidden" chip used to be deferred onto the
                    // *following* message, pinning it to the wrong turn.
                    if (item.kind !== 'turn') {
                      prevRole = null;
                      return (
                        <ToolsHiddenBadge
                          key={item.key}
                          count={item.count}
                          files={item.files}
                          dimmed={activeFilter !== 'all' && activeFilter !== 'tools'}
                        />
                      );
                    }
                    const curRole = processed[item.idx].msg.role;
                    const hasText = processed[item.idx].msg.content.some(b => b.type === 'text');
                    const isContinuation =
                      !hasText && curRole === prevRole && curRole === 'assistant';
                    // A folded tool run breaks the visual grouping — the next turn
                    // shows its orb rather than reading as a continuation.
                    prevRole = item.hiddenCount ? null : curRole;
                    return (
                      <MessageBubble
                        key={`${item.idx}:${processed[item.idx].msg.uuid}`}
                        processed={processed[item.idx]}
                        detailsFilter={detailsFilter}
                        onOpenToolDetail={setSelectedTool}
                        agentColorOf={agentColorOf}
                        skillOf={skillOf}
                        onOpenSkill={onOpenSkill}
                        agentOf={agentOf}
                        onOpenAgent={onOpenAgent}
                        turnIndex={item.idx + 1}
                        dimmed={
                          activeFilter !== 'all' &&
                          descriptors[item.idx]?.visible &&
                          !matchesFilter(descriptors[item.idx]) &&
                          // A turn carrying a folded "tools hidden" chip counts as
                          // a tools turn under the Tools filter — keep it lit.
                          !(activeFilter === 'tools' && !!item.hiddenCount)
                        }
                        isContinuation={isContinuation}
                        innerRef={setTurnRef}
                        hiddenToolCount={item.hiddenCount}
                        hiddenFiles={item.hiddenFiles}
                        selectionMode={selectionMode}
                        selected={selectedTurns.has(processed[item.idx].msg.uuid)}
                        onToggleSelect={handleToggleSelect}
                        onExportTurn={handleExportTurn}
                      />
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </main>

        <HighlightToolbar
          toolbar={highlightLayer.toolbar}
          onPick={highlightLayer.pickColor}
          onRemove={highlightLayer.removeCurrent}
        />

        {!embedded && (
          <FocusMinimap
            items={minimapItems}
            active={activeTurn}
            matches={matchesFilter}
            onJump={jumpToTurn}
          />
        )}

        {controlPill(true)}
      </div>
    </div>
  );
}
