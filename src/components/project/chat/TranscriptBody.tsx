import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode, UIEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  saveMarkdownExport,
  savePdfExport,
  useAllSkills,
  useEffectiveConfig,
  useGlobalAgents,
  usePlugins,
  useProjectAgents,
} from '../../../hooks/useIPC';
import type { Agent, ChatMessage, SessionSummary, Skill } from '../../../hooks/useIPC';
import { trackEvent } from '../../../lib/telemetry';
import {
  buildProcessedMessages,
  buildSkillIndex,
  collectModelRuns,
  ChatDetailsFilter,
  RenderRow,
  ToolGroup,
} from './utils';
import { buildChatExportDocument, ChatExportFormat, ChatExportPreset } from './export';
import { useChatAutoScroll } from './useAutoScroll';
import { useTranscriptModel } from './useTranscriptModel';
import type { RemoteTranscript } from '../../remote-origin';
import { DiffsOpenContext } from './diffs-open';
import { AdvisorBadge, MessageBubble, ToolsHiddenBadge } from './MessageBubble';
import { ChatControlPill } from './ChatControlPill';
import { deriveContext } from '../terminal/context-window';
import { findMatchingTurns, stepToHit } from './find';
import { useFindLayer } from './useFindLayer';
import { ContextRail } from './ContextRail';
import { contextFiles, nearestTurn } from './context-files';
import { withBranchMarkers } from './git-state';
import { agentTintColor } from '../shared/entityOptions';
import { useThoughtStream } from './useThoughtStream';
import { useHighlights } from './useHighlights';
import { useHighlightLayer } from './useHighlightLayer';
import { HighlightToolbar } from './HighlightToolbar';
import type { SessionWaiting } from './WaitingLine';

/** First-paint height guess for an unmeasured transcript row. Only the rows in
 *  the window are ever measured, so this is what the scrollbar is made of for
 *  everything the reader hasn't reached yet — it matches the
 *  `contain-intrinsic-size` the non-windowed transcripts use. */
const ESTIMATED_ROW_PX = 240;

/** Rows kept mounted above and below the viewport. Enough that a fast wheel
 *  flick lands on measured content instead of a blank patch. */
const ROW_OVERSCAN = 6;

/**
 * The reading column of a conversation — the one both transcripts draw (#304).
 *
 * `ChatView` feeds it from disk (the Lens), `LiveChatView` from the Agent SDK
 * stream (the SDK chat). Everything that turns messages into what the reader
 * sees lives here once: the processed transcript, MIN folding, the windowed
 * list, the scroll-spy, find, highlights, export, and the control pill. The
 * hosts own the frame — the top bar, the overlays, the composer — and hand the
 * column what it cannot know: where the messages come from, the session row,
 * and what opens a tool, a skill or an agent.
 *
 * Two slots: `tail` is drawn under the windowed list, never as a row of it (the
 * streaming turn of the SDK chat), and `composer` sits in the workspace, which
 * then lifts the pill and pads the column above it (`data-composer`).
 */
export function TranscriptBody({
  project,
  messages,
  placeholder = null,
  scrollKey,
  sessionId,
  summary,
  remote,
  hidden = false,
  onOpenTool,
  onOpenSkill,
  onOpenAgent,
  fileOpenerFor,
  jumpToTurnRef,
  focusMessageUuid,
  waiting,
  narrate = true,
  onDelete,
  contextRail = false,
  tail,
  composer,
}: {
  project: { hash: string; realPath: string };
  /** The conversation. A stable array: a fresh `[]` each render re-runs every
   *  derivation below. */
  messages: ChatMessage[];
  /** Printed in the feed when non-null: loading, empty, or a first-run note. */
  placeholder?: ReactNode;
  /** Re-keys the bottom-pinning scroller: the session filename in the Lens, the
   *  project hash in the SDK chat, whose session id arrives mid-life. */
  scrollKey: string;
  /** Highlights are stored per session id; null turns them off. */
  sessionId: string | null;
  /** The session row: the pill's spend and the export document. Null (a new SDK
   *  chat has none yet) prints `—` and leaves export off. */
  summary: SessionSummary | null;
  /** A session read from another machine (#294): nothing about the project is
   *  read locally, and nothing is exported or highlighted. */
  remote?: RemoteTranscript;
  /** An overlay or another mode covers the column: hidden, never unmounted, so
   *  scroll position, highlights and the scroll-spy survive. */
  hidden?: boolean;
  onOpenTool: (group: ToolGroup) => void;
  /** Deep-link to a skill detail view (from an inline skill card). */
  onOpenSkill?: (skill: Skill) => void;
  /** Deep-link to an agent detail view (from an inline agent card). */
  onOpenAgent?: (agent: Agent) => void;
  /** Opens a file the session read in the frame's Files viewer; undefined for a
   *  path it cannot open. */
  fileOpenerFor?: (path: string) => (() => void) | undefined;
  /** Set to this column's `jumpToTurn` for an outside navigator. */
  jumpToTurnRef?: MutableRefObject<((n: number) => void) | null>;
  /** Open scrolled to the turn holding this message (a search hit), by uuid. */
  focusMessageUuid?: string;
  /** The session waits on the user, as the frame read it off the registry. */
  waiting?: SessionWaiting | null;
  /** The pill's running commentary. Off where the host already prints the
   *  running call's note (the SDK chat's live turn). */
  narrate?: boolean;
  /** Absent, the pill's sheet offers no delete. */
  onDelete?: () => void;
  /** The rail of files the session read (the Lens). */
  contextRail?: boolean;
  /** Drawn after the windowed list, given the number the next turn would take. */
  tail?: (nextTurn: number) => ReactNode;
  /** The composer, and whether it carries the "live in your terminal" lock. */
  composer?: { node: ReactNode; locked: boolean };
}) {
  const localPath = remote ? null : project.realPath;
  const globalAgentsQuery = useGlobalAgents(!remote);
  const globalAgents = remote ? undefined : globalAgentsQuery.data;
  const { data: projectAgents } = useProjectAgents(localPath);
  const { data: allSkills } = useAllSkills(localPath);
  const pluginsQuery = usePlugins(!remote);
  const plugins = remote ? undefined : pluginsQuery.data;

  // Context occupancy for the pill's vitals cell. The raw `model` setting (e.g.
  // `opus[1m]`) carries the 1M marker the transcript's resolved id drops, and it
  // is what sizes the window — the same read Mission Control makes, through the
  // same query, so the two can never disagree about how full the window is.
  const { data: effectiveConfig } = useEffectiveConfig(project.realPath, !remote);
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
  const [detailsFilter, setDetailsFilter] = useState<ChatDetailsFilter>('minimal');
  // The diffs at the foot of the turns: open until the pill folds them.
  const [diffsOpen, setDiffsOpen] = useState(true);
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
  } = useChatAutoScroll(scrollKey);
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
  // The branch markers are added here, not by the main process, so a search or
  // the rail reading the same transcript never meets a row nobody wrote.
  const processed = useMemo(() => buildProcessedMessages(withBranchMarkers(messages)), [messages]);
  const canExport = !remote && summary !== null && processed.length > 0;

  // Running commentary: the note Claude wrote for each action, one at a time,
  // above the control pill. Fed by the same watcher-driven read the transcript
  // uses — nothing extra is fetched — and it narrates only calls that arrive
  // AFTER this view opened, so re-reading a finished session says nothing.
  // On wherever nothing else narrates: off in the SDK chat, whose live turn
  // already prints the running call's note.
  const thought = useThoughtStream(messages, narrate);

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
  const { rows, rowIndexByTurn } = useTranscriptModel({
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

  // The files the session read, for the Lens rail. Only a host that mounts the
  // rail pays for the scan.
  const readFiles = useMemo(
    () => (contextRail ? contextFiles(processed, project.realPath) : []),
    [contextRail, processed, project.realPath]
  );
  const renderedTurns = useMemo(
    () => [...rowIndexByTurn.keys()].sort((a, b) => a - b),
    [rowIndexByTurn]
  );
  // A read's turn is the row that shows it: a tool-only turn MIN folds away
  // belongs to the turn it is folded into.
  const turnOfRead = useCallback(
    (idx: number) => nearestTurn(renderedTurns, idx + 1),
    [renderedTurns]
  );

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
  //
  // Not while hidden: a feed under `display: none` reads 0 for its scroll
  // position, so a turn streamed in under an overlay would re-seed the reader
  // onto the first turn — and closing the overlay would send them there.
  const syncActiveTurn = useCallback(() => {
    const feed = feedRef.current;
    if (hidden || !feed || rows.length === 0) return;
    const hit = rowVirtualizer.getVirtualItemForOffset(feed.scrollTop + feed.clientHeight / 2);
    if (!hit) return;
    // A collapsed tool run carries no turn number of its own: credit it to the
    // nearest message row above it, which is the turn it belongs to.
    let i = Math.min(hit.index, rows.length - 1);
    while (i >= 0 && rows[i].turnN === null) i--;
    const n = i >= 0 ? rows[i].turnN : (rows.find(r => r.turnN !== null)?.turnN ?? null);
    if (n !== null) setActiveTurn(prev => (prev === n ? prev : n));
  }, [hidden, feedRef, rows, rowVirtualizer]);

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

  // The feed hides (display:none) behind an overlay or another mode — it stays
  // mounted (in the SDK chat that keeps the composer and its draft), but a hidden
  // scroller collapses and loses its scroll offset anyway. On return, an
  // anchored view is re-pinned by the resize observer; a detached one gets its
  // active turn back instead of silently restarting at the top.
  useLayoutEffect(() => {
    if (hidden) return;
    if (!followRef.current) {
      const turn = activeTurnRef.current;
      if (turn !== null) scrollToTurn(turn);
    }
  }, [hidden, followRef, scrollToTurn]);

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
    // `useTranscriptModel` gives the row map.
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

  // Persistent text highlights: select text in the reading column to flag it
  // (survives across app restarts and bakes into exports). Capture + paint are
  // suspended while an overlay covers the transcript.
  const highlightsApi = useHighlights(sessionId ?? '');
  const highlightLayer = useHighlightLayer({
    container: transcriptEl,
    api: highlightsApi,
    enabled: !hidden && !remote && sessionId !== null,
  });
  // Paints the find's occurrences over the mounted rows. The active turn is
  // passed as a uuid because that is what the DOM carries (`data-hl-block`).
  useFindLayer({
    container: transcriptEl,
    query: findQuery,
    activeUuid: findCursor !== null ? (processed[findCursor - 1]?.msg.uuid ?? null) : null,
    enabled: !hidden,
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
    if (!canExport || !summary || exportProcessed.length === 0) return;
    setExporting(format);
    setExportError(null);
    setExportMessage(null);

    try {
      const doc = buildChatExportDocument({
        session: summary,
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
      return (
        <ToolsHiddenBadge
          count={item.count}
          files={item.files}
          web={item.web}
          onOpenTool={onOpenTool}
        />
      );
    }
    const p = processed[item.idx];
    return (
      <MessageBubble
        processed={p}
        detailsFilter={detailsFilter}
        onOpenToolDetail={onOpenTool}
        agentColorOf={agentColorOf}
        skillOf={skillOf}
        onOpenSkill={onOpenSkill}
        agentOf={agentOf}
        onOpenAgent={onOpenAgent}
        turnIndex={item.idx + 1}
        isContinuation={row.isContinuation}
        hiddenToolCount={item.hiddenCount}
        hiddenFiles={item.hiddenFiles}
        hiddenWeb={item.hiddenWeb}
        selectionMode={selectionMode}
        selected={selectedTurns.has(p.msg.uuid)}
        onToggleSelect={handleToggleSelect}
        onExportTurn={remote || !summary ? undefined : handleExportTurn}
      />
    );
  };

  const pill = (
    <ChatControlPill
      vitals={{ ctx, session: summary }}
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
      showTranscriptControls={processed.length > 0}
      density={detailsFilter}
      setDensity={setDetailsFilter}
      diffsOpen={diffsOpen}
      onToggleDiffs={() => setDiffsOpen(o => !o)}
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
      onDelete={onDelete}
      exportable={!remote}
      modelRuns={modelRuns}
      onLocateModel={jumpToTurn}
      thought={thought}
      waiting={waiting}
    />
  );

  return (
    <DiffsOpenContext.Provider value={diffsOpen}>
      {focusMissed && !hidden && (
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
      {/* Hidden, never unmounted, while something covers it: its scroll position,
          highlight layer and scroll-spy survive, and so does the composer's draft. */}
      <div
        className="cl-chat-workspace cl-chat-workspace--focus"
        style={hidden ? { display: 'none' } : undefined}
        data-composer={composer ? true : undefined}
        data-composer-lock={composer?.locked ? true : undefined}
      >
        <main
          className="cl-chat-feed"
          ref={feedRef}
          onScroll={handleFeedScroll}
          onWheel={onFeedWheel}
        >
          {placeholder != null && <p className="cl-transcript-state">{placeholder}</p>}

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
                {/* After the list, never a row of it: an ephemeral row would shift
                    the virtualizer's indices on every chunk. Inside the observed
                    column, so the bottom pin follows it as it grows. */}
                {tail?.(processed.length + 1)}
              </div>
            </div>
          )}
        </main>

        <HighlightToolbar
          toolbar={highlightLayer.toolbar}
          onPick={highlightLayer.pickColor}
          onRemove={highlightLayer.removeCurrent}
        />

        {contextRail && (
          <ContextRail
            files={readFiles}
            cwd={project.realPath}
            turnOf={turnOfRead}
            activeTurn={activeTurn}
            onJump={jumpToTurn}
            openerFor={fileOpenerFor}
          />
        )}

        {pill}
        {composer?.node}
      </div>
    </DiffsOpenContext.Provider>
  );
}
