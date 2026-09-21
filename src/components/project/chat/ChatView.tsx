import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  saveMarkdownExport,
  savePdfExport,
  useActiveSessions,
  useChatSession,
  useGlobalAgents,
  useProjectAgents,
  useAllSkills,
  usePlugins,
  useEffectiveConfig,
} from '../../../hooks/useIPC';
import { SessionSummary, Skill, Agent } from '../../../hooks/useIPC';
import { sessionTitle } from '../utils';
import { useThoughtStream } from './useThoughtStream';
import { trackEvent } from '../../../lib/telemetry';
import {
  AGENT_TOOLS,
  isMemoryFile,
  buildProcessedMessages,
  buildSkillIndex,
  collectModelRuns,
  ChatDetailsFilter,
  RenderRow,
  ToolGroup,
  resolveToolIcon,
  toolRunStatus,
} from './utils';
import { LiveInTerminalBadge } from './atoms';
import { buildChatExportDocument, ChatExportFormat, ChatExportPreset } from './export';
import { useChatAutoScroll } from './useAutoScroll';
import { useTranscriptModel } from './useTranscriptModel';
import { ToolDetailPanel } from './ToolDetailPanel';
import { VaultLinksProvider } from '../../VaultLinks';
import { AdvisorBadge, MessageBubble, ToolsHiddenBadge } from './MessageBubble';
import { ChatControlPill } from './ChatControlPill';
import { deriveContext } from '../terminal/context-window';
import { buildFileChanges } from '../terminal/mission-feed';
import { findMatchingTurns, stepToHit } from './find';
import { useFindLayer } from './useFindLayer';
import { FocusMinimap } from './FocusMinimap';
import { agentTintColor } from '../shared/entityOptions';
import { TopBar } from '../shared/TopBar';
import { CloseOverlayButton } from '../shared/CloseOverlayButton';
import { DeleteSessionDialog } from '../shared/DeleteSessionDialog';
import { SessionColorIdentity } from '../shared/SessionColorIdentity';
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
  /** Open the exchange an inbound message belongs to (#280): this session is
   *  the receiver, `msgId` the join key the bubble carries. */
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
  const { data: globalAgents } = useGlobalAgents();
  const { data: projectAgents } = useProjectAgents(project.realPath);
  const { data: allSkills } = useAllSkills(project.realPath);
  const { data: plugins } = usePlugins();
  // Context occupancy for the pill's vitals cell. The raw `model` setting (e.g.
  // `opus[1m]`) carries the 1M marker the transcript's resolved id drops, and it
  // is what sizes the window — the same read Mission Control makes, through the
  // same query, so the two can never disagree about how full the window is.
  const { data: effectiveConfig } = useEffectiveConfig(project.realPath);
  const rawModel =
    typeof effectiveConfig?.effective?.model === 'string'
      ? (effectiveConfig.effective.model as string)
      : undefined;
  const ctx = useMemo(() => deriveContext(messages, rawModel), [messages, rawModel]);

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
  // the inline skill card link and the footer skill dock, through the same index
  // the dock uses, so a plugin skill (`plugin:leaf`) resolves on both surfaces.
  const skillOf = useMemo(() => {
    const resolve = buildSkillIndex(allSkills, plugins);
    return (name: string) => resolve(name) ?? undefined;
  }, [allSkills, plugins]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [detailsFilter, setDetailsFilter] = useState<ChatDetailsFilter>('minimal');
  const [selectedTool, setSelectedTool] = useState<ToolGroup | null>(null);
  // One entry point for every "open this tool" in the view — inline card, session
  // graph, skill output. The host frame takes it when it owns the chrome.
  const openTool = useMemo(() => onOpenTool ?? setSelectedTool, [onOpenTool]);
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
  // Always on: the line costs no layout and says nothing when there is nothing
  // to say, so a toggle for it was a control for nothing.
  const thought = useThoughtStream(displayMessages, true);

  // Which model(s) this chat ran on, and at what effort — the footer chip. A
  // `/model` mid-chat makes this a list rather than a value, and the chip prints
  // the last entry, i.e. the one the conversation is actually on.
  const modelRuns = useMemo(() => collectModelRuns(processed), [processed]);

  // The Focus transcript model: per-turn descriptors, the visible/minimap items,
  // the collapsed stream rows, and the filter counts — all derived from the
  // processed messages + the detail filter (see useTranscriptModel.ts).
  const resolveAgentTint = useCallback(
    (t: string) => agentTintColor(agentColorOf(t)),
    [agentColorOf]
  );
  const { minimapItems, rows, rowIndexByTurn } = useTranscriptModel({
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
  // What this session did to the working tree, for the pill's diff cell. Same
  // derivation Mission Control's band used — the memory files are excluded
  // because they are a topic each, not a diff, and counting them would
  // double-count the session's line totals.
  const changes = useMemo(() => {
    const ownTools = processed
      .flatMap(p => p.toolGroups)
      .filter(g => !AGENT_TOOLS.has(g.use.name))
      .filter(g => !isMemoryFile(g.use.input as Record<string, unknown>));
    const files = buildFileChanges(ownTools);
    return files.reduce(
      (acc, c) => ({
        added: acc.added + c.added,
        removed: acc.removed + c.removed,
        files: acc.files + 1,
      }),
      { added: 0, removed: 0, files: 0 }
    );
  }, [processed]);

  // ── Find in transcript ────────────────────────────────────────────────
  // The list is windowed, so the browser's own Ctrl+F only ever sees the rows
  // around the viewport. `findMatchingTurns` scans the DATA (all of it) for the
  // turns that match; `useFindLayer` paints the occurrences in whatever rows are
  // mounted. Hits are filtered to turns the stream actually has a row for — a
  // turn the current density folds away cannot be scrolled to, and offering it
  // as a destination would be a step that does nothing.
  const [findQuery, setFindQuery] = useState('');
  // Where the find last SENT the reader. Deliberately not `activeTurn`: the
  // scroll-spy writes that on every scroll, so the counter would drop from
  // "3/12 turns" to "12 turns" the moment the reader scrolled off the hit, and
  // look broken. Stepping still starts from `activeTurn` — "next" means next
  // after where I am reading — which is the half that should follow the scroll.
  const [findCursor, setFindCursor] = useState<number | null>(null);
  const findHits = useMemo(() => {
    const matched = findMatchingTurns(processed, findQuery, detailsFilter);
    return matched.filter(n => rowIndexByTurn.has(n));
  }, [processed, findQuery, detailsFilter, rowIndexByTurn]);

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

  // The feed hides (display:none) behind the tool-detail overlay and in Timeline
  // mode — it stays mounted so the composer keeps
  // the SDK session alive, but a hidden scroller collapses and loses its scroll
  // offset anyway. On return, an anchored view is re-pinned by the resize
  // observer; a detached one gets its active turn back instead of silently
  // restarting at the top.
  useLayoutEffect(() => {
    if (selectedTool || viewMode !== 'chat') return;
    if (!followRef.current) {
      const turn = activeTurnRef.current;
      if (turn !== null) scrollToTurn(turn);
    }
  }, [selectedTool, viewMode, followRef, scrollToTurn]);

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, selectedTool]);

  const title = sessionTitle(session);
  // The detail covering the transcript, if any, and the one step back out of it.
  // The top bar's arrow, the session crumb and Esc all walk this — the panels
  // themselves draw no back button when this view owns the chrome.
  const detailBack = selectedTool ? () => setSelectedTool(null) : null;
  // Whether an overlay / alternate mode is covering the chat workspace. The
  // workspace is then hidden (display:none) but never unmounted — see the
  // comment at the render site.
  const chatHidden = Boolean(selectedTool) || isError || viewMode !== 'chat';

  // Persistent text highlights: select text in the reading column to flag it
  // (survives across app restarts and bakes into exports). Capture + paint are
  // suspended while an overlay covers the transcript.
  const highlightsApi = useHighlights(sessionId);
  const highlightLayer = useHighlightLayer({
    container: transcriptEl,
    api: highlightsApi,
    enabled: !chatHidden,
  });
  // Paints the find's occurrences over the mounted rows. The active turn is
  // passed as a uuid because that is what the DOM carries (`data-hl-block`).
  useFindLayer({
    container: transcriptEl,
    query: findQuery,
    activeUuid: findCursor !== null ? (processed[findCursor - 1]?.msg.uuid ?? null) : null,
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
    // The advisor marker is a stream event, not a turn: it renders the same in
    // both density modes (the consult itself is the whole content).
    if (item.kind === 'advisor') {
      return <AdvisorBadge consult={item.consult} />;
    }
    if (item.kind !== 'turn') {
      return <ToolsHiddenBadge count={item.count} files={item.files} />;
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
      vitals={{ ctx, session }}
      changes={changes}
      find={{
        query: findQuery,
        setQuery: q => {
          setFindQuery(q);
          // A new query invalidates where the old one had got to.
          setFindCursor(null);
        },
        hits: findHits.length,
        // Which hit the find is on, 1-based, or 0 before the first step.
        position: findCursor === null ? 0 : findHits.indexOf(findCursor) + 1,
        onStep: direction => {
          const next = stepToHit(findHits, activeTurn, direction);
          if (next === null) return;
          setFindCursor(next);
          jumpToTurn(next);
        },
      }}
      showTranscriptControls={showTranscriptControls && processed.length > 0}
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
      modelRuns={modelRuns}
      onLocateModel={jumpToTurn}
      thought={thought}
    />
  );

  return (
    // The `[[wikilinks]]` in this transcript resolve against THIS project's
    // files. Mounted here rather than higher up on purpose: the memory views
    // carry wikilinks of their own that point at topics under `~/.claude`, and
    // resolving those against the project tree would mark every one missing.
    <VaultLinksProvider root={project.realPath}>
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
            That match is in this session's history but not in the transcript this view can load —
            it sits before a <code>/compact</code>, which the reader stops at.{' '}
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
                // The session's `/color` dot rides the crumb, so the colour the
                // user set to tell two runs apart is on screen while reading one
                // of them — not only in the list they picked it from.
                // `flex`, not `inline-flex`: the crumb button truncates, and an
                // inline box sized to its own content would be clipped mid-word
                // instead of ellipsised. A block-level flex row takes the
                // button's width and hands the truncation to the title span.
                label: <SessionColorIdentity color={session.agentColor} title={title} />,
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

          <FocusMinimap items={minimapItems} active={activeTurn} onJump={jumpToTurn} />

          {controlPill(true)}
        </div>
      </div>
    </VaultLinksProvider>
  );
}
