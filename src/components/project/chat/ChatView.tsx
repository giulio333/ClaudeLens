import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
import { useThoughtsShown } from '../../../hooks/useThoughtsShown';
import { useThoughtStream } from './useThoughtStream';
import { trackEvent } from '../../../lib/telemetry';
import {
  buildProcessedMessages,
  correlateSessionAgents,
  correlateSessionSkills,
  ChatDetailsFilter,
  RenderRow,
  SessionAgent,
  ToolGroup,
  TurnDescriptor,
  TurnFilter,
  resolveToolIcon,
  toolRunStatus,
} from './utils';
import { LiveInTerminalBadge } from './atoms';
import { buildChatExportDocument, ChatExportFormat, ChatExportPreset } from './export';
import { useChatAutoScroll } from './useAutoScroll';
import { useTranscriptModel } from './useTranscriptModel';
import { ToolDetailPanel } from './ToolDetailPanel';
import { SubagentTranscriptPanel } from './SubagentTranscriptPanel';
import { MessageBubble, ToolsHiddenBadge } from './MessageBubble';
import { ChatControlPill } from './ChatControlPill';
import { FocusMinimap } from './FocusMinimap';
import { agentTintColor } from '../shared/entityOptions';
import { TopBar } from '../shared/TopBar';
import { CloseOverlayButton } from '../shared/CloseOverlayButton';
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

/** First-paint height guess for an unmeasured transcript row. Only the rows in
 *  the window are ever measured, so this is what the scrollbar is made of for
 *  everything the reader hasn't reached yet — it matches the
 *  `contain-intrinsic-size` the non-windowed transcripts use. */
const ESTIMATED_ROW_PX = 240;

/** Rows kept mounted above and below the viewport. Enough that a fast wheel
 *  flick lands on measured content instead of a blank patch. */
const ROW_OVERSCAN = 6;

export function ChatView({
  project,
  session,
  onBack,
  onOpenSkill,
  onOpenAgent,
  onOpenTool,
  embedded = false,
  jumpToTurnRef,
  focusMessageUuid,
}: {
  project: { hash: string; realPath: string };
  session: SessionSummary;
  onBack: () => void;
  /** Deep-link to a skill detail view (from an inline skill card or the dock). */
  onOpenSkill?: (skill: Skill) => void;
  /** Deep-link to an agent detail view (from an inline agent card). */
  onOpenAgent?: (agent: Agent) => void;
  /** Hand a tool detail to the host frame instead of opening it here. Set by the
   *  unified Terminal/Lens view, whose own top bar carries the crumb and the way
   *  back: opened locally, the panel would sit under a bar that doesn't know it
   *  exists. Unset (standalone ChatView) the panel opens in place. */
  onOpenTool?: (group: ToolGroup) => void;
  /** Imperative handle exposed to an outside navigator (the v2 Outline column):
   *  set to this view's `jumpToTurn` so a session-outline row can scroll the
   *  embedded transcript to a turn. Null while unmounted / Terminal mode. */
  jumpToTurnRef?: React.MutableRefObject<((n: number) => void) | null>;
  /** Rendered inside the unified Terminal/Lens view: drop the own TopBar (the
   *  unified frame provides chrome + the Terminal↔Lens switch) and the composer
   *  — this surface is read-only, the live session belongs to the terminal's
   *  PTY. The floating control pill and the left TURNS capsule stay — they
   *  anchor to the chat column. */
  embedded?: boolean;
  /** Open scrolled to the turn holding this message (a search hit). Matched by
   *  uuid, not by index: this view loads through the SDK, which truncates at the
   *  compaction boundary, so the message may simply not be here — and then the
   *  view says so instead of landing on whatever turn an index happened to hit. */
  focusMessageUuid?: string;
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
  // One entry point for every "open this tool" in the view — inline card, session
  // graph, skill output. The host frame takes it when it owns the chrome.
  const openTool = useMemo(() => onOpenTool ?? setSelectedTool, [onOpenTool]);
  const [transcriptAgent, setTranscriptAgent] = useState<SessionAgent | null>(null);
  const [exportPreset, setExportPreset] = useState<ChatExportPreset>('message');
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

  // Running commentary: the note Claude wrote for each action, one at a time,
  // above the control pill. Fed by the same watcher-driven read the transcript
  // uses — nothing extra is fetched — and it narrates only calls that arrive
  // AFTER this view opened, so re-reading a finished session says nothing.
  // The toggle is offered only while the session is live, because that is the
  // only state in which there is anything to narrate.
  const { shown: thoughtsShown, toggle: toggleThoughts } = useThoughtsShown();
  const thought = useThoughtStream(displayMessages, thoughtsShown);

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
  const { descriptors, minimapItems, rows, rowIndexByTurn, filterCounts } = useTranscriptModel({
    processed,
    detailsFilter,
    agentColor: resolveAgentTint,
  });

  // Windowed transcript: only the rows near the viewport are mounted. A long
  // session used to mount every MessageBubble at once — tool cards, diffs and a
  // markdown parse each — which is what made big transcripts slow to open and
  // to scroll. Heights are content-dependent, so rows are measured as they
  // mount (`measureElement`) rather than estimated once.
  //
  // The virtualizer hands back live getters (`getVirtualItems`, `getTotalSize`)
  // that must not be memoized, so React Compiler would skip this component. That
  // costs nothing today — the compiler isn't in the build (no babel plugin in
  // vite.config.ts) — and the alternative is mounting every turn again.
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => feedRef.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    getItemKey: i => rows[i]?.key ?? i,
    overscan: ROW_OVERSCAN,
    // Deliberately NOT `anchorTo: 'end'`. It looks like the right way to hold
    // the bottom while measurements land, but this feed already has an end
    // anchor — useAutoScroll's ResizeObserver pin — and the two chase the
    // bottom in different coordinate spaces: `pin()` targets the DOM bottom,
    // which includes the 140px of padding under the list, while the virtualizer
    // only knows `getTotalSize()`. They settle ~170px apart, so each correction
    // provokes the other, remounting rows and re-measuring on every pass. The
    // renderer never goes idle, and the terminal slab mounted beside this view
    // (TerminalMissionControl keeps both alive) stops responding with it.
  });

  // Ref mirror so the layout effects below can look up a row without listing the
  // map as a dependency — it changes on every transcript append, and they must
  // only fire on the event they anchor (density change, overlay close).
  // Synced in a *layout* effect, declared above them: a density change rebuilds
  // the rows, and an anchoring effect reading last render's map would scroll to
  // the row a turn used to occupy.
  const rowIndexByTurnRef = useRef(rowIndexByTurn);
  useLayoutEffect(() => {
    rowIndexByTurnRef.current = rowIndexByTurn;
  }, [rowIndexByTurn]);

  // `align` mirrors what `scrollIntoView` used to be handed: 'auto' only moves
  // when the turn isn't already on screen (the old `block: 'nearest'`), 'start'
  // brings it to the top (the old `block: 'start'`).
  const scrollToTurn = useCallback(
    (n: number, align: 'auto' | 'start' = 'start') => {
      const row = rowIndexByTurnRef.current.get(n);
      if (row === undefined) return false;
      rowVirtualizer.scrollToIndex(row, { align });
      return true;
    },
    [rowVirtualizer]
  );

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

  // Scroll-spy: highlight the turn nearest the viewport centre. Read off the
  // virtualizer's own geometry rather than an IntersectionObserver over mounted
  // turns — with a windowed list most turns have no node to observe, and the
  // ones that do come and go on every scroll.
  const syncActiveTurn = useCallback(() => {
    const feed = feedRef.current;
    if (!feed || rows.length === 0) return;
    const hit = rowVirtualizer.getVirtualItemForOffset(feed.scrollTop + feed.clientHeight / 2);
    if (!hit) return;
    // A collapsed tool run carries no turn number of its own: credit it to the
    // nearest message row above it, which is the turn it belongs to.
    let i = Math.min(hit.index, rows.length - 1);
    while (i >= 0 && rows[i].turnN === null) i--;
    const n = i >= 0 ? rows[i].turnN : (rows.find(r => r.turnN !== null)?.turnN ?? null);
    if (n !== null) setActiveTurn(prev => (prev === n ? prev : n));
  }, [feedRef, rows, rowVirtualizer]);

  // Seed / re-seed the active turn: on open, and whenever the row list changes
  // under it (density toggle, transcript append).
  useEffect(() => {
    syncActiveTurn();
  }, [syncActiveTurn]);

  const handleFeedScroll = useCallback(
    (e: UIEvent<HTMLElement>) => {
      onFeedScroll(e);
      syncActiveTurn();
    },
    [onFeedScroll, syncActiveTurn]
  );

  // Keep activeTurnRef in sync so layout effects can read it without deps.
  useEffect(() => {
    activeTurnRef.current = activeTurn;
  }, [activeTurn]);

  // Anchor the feed after a density change: if anchored to the bottom, snap
  // back to bottom; otherwise keep the scroll-spy turn in view. useLayoutEffect
  // fires after DOM mutations but before paint, so the corrected position never
  // flashes.
  //
  // The measurement cache is deliberately NOT dropped here. Rows that are
  // mounted re-measure themselves (measureElement observes each one), and the
  // rows *above* the viewport keeping their previous size is what holds the
  // reading position still: their offsets don't move, so neither does the turn
  // being read. Resetting instead collapsed the whole list back to estimates,
  // and the anchor was then computed against a layout that no longer existed —
  // which is what sent the position wandering on every toggle. The stale sizes
  // are corrected the moment a row is scrolled into view.
  useLayoutEffect(() => {
    if (followRef.current) {
      pin();
    } else {
      const turn = activeTurnRef.current;
      if (turn !== null) scrollToTurn(turn, 'auto');
    }
  }, [detailsFilter, followRef, pin, scrollToTurn]);

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
      if (turn !== null) scrollToTurn(turn);
    }
  }, [selectedTool, transcriptAgent, viewMode, followRef, scrollToTurn]);

  const jumpToTurn = useCallback(
    (n: number) => {
      if (!scrollToTurn(n)) return;
      // A deliberate jump detaches bottom-pinning, or the next content
      // measurement would yank the view straight back down to the last turn.
      followRef.current = false;
      setActiveTurn(n);
    },
    [scrollToTurn, followRef]
  );

  // Land on the turn a search hit points at.
  //
  // Runs once per uuid, gated on the transcript having loaded (`processed`
  // starts empty and fills on the first read), and it may legitimately find
  // nothing: `sessions:getChat` reads through the Agent SDK, which truncates at
  // the compaction boundary, while the search reads the file. A hit in
  // pre-`/compact` history is real and unreachable here — so the miss is
  // reported rather than swallowed, and never approximated by scrolling
  // somewhere plausible.
  const focusedRef = useRef<string | null>(null);
  const [focusMissed, setFocusMissed] = useState(false);
  useEffect(() => {
    if (!focusMessageUuid || processed.length === 0) return;
    if (focusedRef.current === focusMessageUuid) return;
    focusedRef.current = focusMessageUuid;
    const idx = processed.findIndex(p => p.msg.uuid === focusMessageUuid);
    if (idx < 0) {
      setFocusMissed(true);
      return;
    }
    setFocusMissed(false);
    // Turn numbers are 1-based indices into `processed` — the same numbering
    // `useTranscriptModel` gives the minimap and the row map.
    jumpToTurn(idx + 1);
  }, [focusMessageUuid, processed, jumpToTurn]);

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

  // Esc closes whatever covers the transcript — the keyboard half of the crumb
  // and the ✕ in the top bar, now that the panels carry no back button of their
  // own. Embedded, the frame owns both the panels and its Esc: stay out of it.
  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedTool) setSelectedTool(null);
      else if (transcriptAgent?.agentId) setTranscriptAgent(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, selectedTool, transcriptAgent]);

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
  // The detail covering the transcript, if any, and the one step back out of it.
  // The top bar's arrow, the session crumb and Esc all walk this — the panels
  // themselves draw no back button when this view owns the chrome.
  const detailBack = selectedTool
    ? () => setSelectedTool(null)
    : transcriptAgent?.agentId
      ? () => setTranscriptAgent(null)
      : null;
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

  // One transcript row, drawn from its resolved `RenderRow` alone — no lookahead
  // at its neighbours, since a windowed list has none to look at.
  const renderRow = (row: RenderRow | undefined) => {
    // A virtual item can outlive the row list it was computed from by a render
    // (the transcript shrinks on a density toggle or a watcher refetch). This
    // view is mounted inside TerminalMissionControl alongside the terminal
    // slab, so throwing here would take the whole Mission Control down with it.
    if (!row) return null;
    const item = row.item;
    // Fallback only: a run of tool-only turns with no assistant turn before it
    // (it leads the conversation, or follows a user turn) renders as a
    // standalone badge at its stream position. The common case is folded into
    // the preceding turn's header — that "tools hidden" chip used to be
    // deferred onto the *following* message, pinning it to the wrong turn.
    if (item.kind !== 'turn') {
      return (
        <ToolsHiddenBadge
          count={item.count}
          files={item.files}
          dimmed={activeFilter !== 'all' && activeFilter !== 'tools'}
        />
      );
    }
    const p = processed[item.idx];
    return (
      <MessageBubble
        processed={p}
        detailsFilter={detailsFilter}
        onOpenToolDetail={openTool}
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
          // A turn carrying a folded "tools hidden" chip counts as a tools turn
          // under the Tools filter — keep it lit.
          !(activeFilter === 'tools' && !!item.hiddenCount)
        }
        isContinuation={row.isContinuation}
        hiddenToolCount={item.hiddenCount}
        hiddenFiles={item.hiddenFiles}
        selectionMode={selectionMode}
        selected={selectedTurns.has(p.msg.uuid)}
        onToggleSelect={handleToggleSelect}
        onExportTurn={handleExportTurn}
      />
    );
  };

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
      onOpenSkillOutput={openTool}
      onLocateSkill={jumpToTurn}
      thought={thought}
      thoughtsShown={thoughtsShown}
      onToggleThoughts={liveInTerminal ? toggleThoughts : undefined}
    />
  );

  return (
    <div className="cl-chat">
      {focusMissed && (
        <div
          role="status"
          style={{
            padding: '8px 28px',
            fontSize: 12.5,
            color: 'var(--cl-ink-2)',
            background: 'var(--cl-paper-2)',
            borderBottom: '1px solid var(--cl-line)',
          }}
        >
          That match is in this session's history but not in the transcript this view can load — it
          sits before a <code>/compact</code>, which the reader stops at.{' '}
          <button
            onClick={() => setFocusMissed(false)}
            style={{ color: 'var(--cl-accent)', textDecoration: 'underline' }}
          >
            Dismiss
          </button>
        </div>
      )}
      {!embedded && (
        <TopBar
          // Same stack rule as the unified frame: with a detail open the arrow
          // returns to the transcript, and only from the transcript does it go
          // back to Sessions — a lone back arrow has to go back one step.
          onBack={detailBack ?? onBack}
          backLabel={detailBack ? 'Back to chat' : 'Sessions'}
          crumbs={[
            // The session title is the same step back for the hand already up
            // here; the detail takes the "you are here" accent.
            {
              label: title,
              accent: !detailBack,
              onClick: detailBack ?? undefined,
              title: detailBack ? 'Back to chat (Esc)' : undefined,
            },
            ...(selectedTool
              ? [
                  {
                    accent: true,
                    label: (
                      <span className="inline-flex items-center" style={{ gap: 6 }}>
                        <span aria-hidden>
                          {resolveToolIcon(
                            selectedTool.use.name,
                            selectedTool.use.input as Record<string, unknown>
                          )}
                        </span>
                        <span style={{ letterSpacing: '0.1em' }}>
                          {selectedTool.use.name.toUpperCase()}
                        </span>
                      </span>
                    ),
                  },
                ]
              : transcriptAgent?.agentId
                ? [
                    {
                      accent: true,
                      label: (
                        <span style={{ letterSpacing: '0.1em' }}>
                          <span style={{ color: 'var(--cl-ink-4)' }}>AGENT · </span>
                          {transcriptAgent.subagentType}
                        </span>
                      ),
                    },
                  ]
                : []),
          ]}
          right={
            detailBack ? (
              // The detail owns the bar while it is open: the session's own
              // controls (tags, Chat/Timeline) act on what is behind it.
              <>
                {selectedTool && (
                  <span className={`cl-tool-status ${toolRunStatus(selectedTool.result).tone}`}>
                    {toolRunStatus(selectedTool.result).label}
                  </span>
                )}
                <CloseOverlayButton label="Back to chat" onClose={detailBack} />
              </>
            ) : (
              <>
                {liveInTerminal && <LiveInTerminalBadge />}
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
            )
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
        // Chromeless when this view draws its own bar (the crumb + ✕ up there are
        // the way back); embedded, the frame above owns the chrome instead — and
        // there `openTool` has already handed the tool to it, so this branch is
        // only reached standalone.
        <ToolDetailPanel
          group={selectedTool}
          onBack={() => setSelectedTool(null)}
          chromeless={!embedded}
        />
      ) : transcriptAgent && transcriptAgent.agentId ? (
        <SubagentTranscriptPanel
          hash={project.hash}
          sessionFilename={session.filename}
          agentId={transcriptAgent.agentId}
          subagentType={transcriptAgent.subagentType}
          description={transcriptAgent.description}
          onBack={() => setTranscriptAgent(null)}
          // Same rule as the tool panel: chromeless while this view's own bar
          // carries the crumb and the way back. Embedded it keeps its button —
          // an agent transcript opened from the embedded transcript is NOT
          // hoisted to the frame (only tools are), so nothing above knows it.
          chromeless={!embedded}
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
            <SessionGraphView processed={processed} onSelectTool={openTool} />
          )}
          {controlPill(false)}
        </div>
      ) : null}

      <div
        className="cl-chat-workspace cl-chat-workspace--focus"
        style={chatHidden ? { display: 'none' } : undefined}
      >
        <main
          className="cl-chat-feed"
          ref={feedRef}
          onScroll={handleFeedScroll}
          onWheel={onFeedWheel}
        >
          {isLoading && <p className="cl-transcript-state">Loading transcript…</p>}
          {messages?.length === 0 && !isLoading && (
            <p className="cl-transcript-state">No messages found in this session.</p>
          )}

          {processed.length > 0 && (
            <div className="cl-chat-reading">
              <div className="cl-transcript-inner" ref={mergedInnerRef}>
                {/* The sizer carries the full measured height of the list, so the
                    scrollbar, the bottom-pinning ResizeObserver and the minimap
                    all see the whole session even though only the rows around the
                    viewport are mounted. */}
                <div className="cl-vlist" style={{ height: rowVirtualizer.getTotalSize() }}>
                  {rowVirtualizer.getVirtualItems().map(v => (
                    <div
                      key={v.key}
                      data-index={v.index}
                      ref={rowVirtualizer.measureElement}
                      className="cl-vrow"
                      style={{ top: v.start }}
                    >
                      {renderRow(rows[v.index])}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>

        <HighlightToolbar
          toolbar={highlightLayer.toolbar}
          onPick={highlightLayer.pickColor}
          onRemove={highlightLayer.removeCurrent}
        />

        <FocusMinimap
          items={minimapItems}
          active={activeTurn}
          matches={matchesFilter}
          onJump={jumpToTurn}
        />

        {controlPill(true)}
      </div>
    </div>
  );
}
