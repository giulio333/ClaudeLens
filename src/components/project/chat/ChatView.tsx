import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { saveMarkdownExport, savePdfExport, useChatSession, useSessionSubagents } from '../../../hooks/useIPC'
import { SessionSummary } from '../../../hooks/useIPC'
import { sessionTitle } from '../utils'
import { buildProcessedMessages, correlateSessionAgents, describeTurn, ChatDetailsFilter, SessionAgent, ToolGroup, TurnDescriptor } from './utils'
import { buildChatExportDocument, CHAT_EXPORT_PRESETS, ChatExportFormat, ChatExportPreset } from './export'
import { ToolDetailPanel } from './ToolDetailPanel'
import { AgentRail } from './AgentRail'
import { SubagentTranscriptPanel } from './SubagentTranscriptPanel'
import { MessageBubble, ToolsHiddenBadge } from './MessageBubble'
import { TopBar } from '../shared/TopBar'
import { DeleteSessionDialog } from '../shared/DeleteSessionDialog'
import { SessionGraphView } from './graph/SessionGraphView'
import { QueryError } from '../../QueryError'
import { projectDisplayName } from '../shared/projectName'

type ViewMode = 'chat' | 'timeline'

function PlayGlyph() {
  return <span className="cl-resume-play" aria-hidden />
}

function TrashGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  )
}

function ChevronUpGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 15l6-6 6 6" />
    </svg>
  )
}

type TurnFilter = 'all' | 'tools' | 'thinking' | 'questions' | 'plan'

type MinimapItem = TurnDescriptor & { n: number; time: string }

/** One row in the transcript stream: either a real message turn, or a run of
 *  consecutive tool-only turns collapsed into a single "tools hidden" badge. */
type RenderItem =
  | { kind: 'turn'; idx: number }
  | { kind: 'tools'; key: string; count: number }

/** Right-edge timeline minimap (Focus layout). A hairline vertical track with
 *  one proportionally-placed dot per message turn — accent-coloured & larger for
 *  Claude/agent turns, muted & small for user turns. Labels surface on hover only
 *  so the chrome stays out of the way; click jumps, active dot is emphasised.
 *
 *  Adaptive ruler: the track height is measured live, so when a session has many
 *  turns the per-dot spacing shrinks. Dot diameters and accent/active rings scale
 *  with that spacing (one dot per turn is always kept) — at high density the rail
 *  reads as a fine, evenly-gapped ruler instead of a crowded blob; at low density
 *  the dots stay full-size. */
function FocusMinimap({
  items,
  active,
  matches,
  onJump,
}: {
  items: MinimapItem[]
  active: number | null
  matches: (d: TurnDescriptor) => boolean
  onJump: (n: number) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [trackH, setTrackH] = useState(0)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setTrackH(entries[0].contentRect.height))
    ro.observe(el)
    setTrackH(el.getBoundingClientRect().height)
    return () => ro.disconnect()
  }, [])

  if (items.length === 0) return null

  // Density factor t: 0 = cramped, 1 = roomy. The threshold is the *effective*
  // dot width including its ring — a full accent dot is 9px + 3px ring/side = 15px,
  // so we only reach full size once the gap clears ~18px; below that, dots and
  // rings shrink so a visible gap always remains. Until the track is measured we
  // assume roomy so dots never flash tiny on first paint.
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
  const spacing = trackH > 0 && items.length > 1 ? trackH / (items.length - 1) : Infinity
  const t = clamp01((spacing - 3) / (18 - 3))
  const lerp = (a: number, b: number, f = t) => +(a + (b - a) * f).toFixed(2)
  // Rings are the main source of the "solid blob": only fade them in once the
  // track is genuinely roomy (t > 0.5), so dense views stay ring-free dots.
  const tr = clamp01((t - 0.5) * 2)
  const railVars = {
    '--dot': `${lerp(2, 7)}px`,
    '--dot-accent': `${lerp(2.5, 9)}px`,
    '--dot-active': `${lerp(7, 11)}px`, // floored at 7px so the cursor stays legible
    '--ring': `${lerp(0, 3, tr)}px`,
    '--ring-active': `${lerp(1, 3, tr)}px`,
  } as CSSProperties

  return (
    <nav className="cl-focus-rail" aria-label="Turn index">
      <div ref={trackRef} className="cl-focus-rail-track" style={railVars}>
        {items.map((it, i) => {
          const top = items.length <= 1 ? 50 : (i / (items.length - 1)) * 100
          return (
            <button
              key={it.n}
              type="button"
              className="cl-focus-dot"
              style={{ top: `${top}%`, '--c': it.color } as CSSProperties}
              data-accent={it.variant !== 'user' || undefined}
              data-active={active === it.n || undefined}
              data-dim={!matches(it) || undefined}
              onClick={() => onJump(it.n)}
              title={`${String(it.n).padStart(2, '0')} · ${it.label} · ${it.time}`}
              aria-label={`Jump to turn ${it.n}, ${it.label}`}
            >
              <span className="lbl">{String(it.n).padStart(2, '0')} {it.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** Floating glass control pill (Focus layout) — bottom-centre. Holds the
 *  transcript filters + density toggle (chat mode only), the Resume action, and
 *  a "more" trigger that raises the export / delete sheet above the pill. */
function ChatControlPill({
  showTranscriptControls,
  filter,
  setFilter,
  counts,
  showThinking,
  density,
  setDensity,
  onResume,
  canExport,
  exporting,
  exportPreset,
  exportMessage,
  exportError,
  selectedExportPreset,
  onOpenSheet,
  onExportPreset,
  onExport,
  onDelete,
}: {
  showTranscriptControls: boolean
  filter: TurnFilter
  setFilter: (f: TurnFilter) => void
  counts: { all: number; tools: number; thinking: number; questions: number; plan: number }
  showThinking: boolean
  density: ChatDetailsFilter
  setDensity: (d: ChatDetailsFilter) => void
  onResume: () => void
  canExport: boolean
  exporting: ChatExportFormat | null
  exportPreset: ChatExportPreset
  exportMessage: string | null
  exportError: string | null
  selectedExportPreset: (typeof CHAT_EXPORT_PRESETS)[number]
  onOpenSheet: () => void
  onExportPreset: (preset: ChatExportPreset) => void
  onExport: (format: ChatExportFormat) => void
  onDelete: () => void
}) {
  const [sheet, setSheet] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!sheet) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setSheet(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [sheet])

  const toggleSheet = () => {
    setSheet(s => {
      if (!s) onOpenSheet()
      return !s
    })
  }

  const chip = (id: TurnFilter, label: string, c: number) => (
    <button
      key={id}
      type="button"
      className="cl-pill-filter"
      data-on={filter === id || undefined}
      onClick={() => setFilter(filter === id ? 'all' : id)}
    >
      {label}
      <b>{c}</b>
    </button>
  )

  return (
    <div className="cl-pill-wrap" ref={rootRef}>
      {sheet && (
        <div className="cl-sheet" role="menu">
          <div className="cl-sheet-head">
            <span className="cl-export-label">Export</span>
            <button type="button" className="cl-sheet-close" aria-label="Close" onClick={() => setSheet(false)}>✕</button>
          </div>
          <div className="cl-export-presets">
            {CHAT_EXPORT_PRESETS.map(preset => (
              <button
                key={preset.value}
                type="button"
                className={exportPreset === preset.value ? 'is-active' : ''}
                onClick={() => onExportPreset(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="cl-export-desc">{selectedExportPreset.description}</p>
          <div className="cl-export-actions">
            <button type="button" disabled={!canExport || exporting !== null} onClick={() => onExport('markdown')}>
              {exporting === 'markdown' ? 'Saving...' : 'Markdown'}
            </button>
            <button type="button" disabled={!canExport || exporting !== null} onClick={() => onExport('pdf')}>
              {exporting === 'pdf' ? 'Saving...' : 'PDF'}
            </button>
          </div>
          {exportMessage && <p className="cl-export-status is-ok">{exportMessage}</p>}
          {exportError && <p className="cl-export-status is-error">{exportError}</p>}
          <div className="cl-sheet-sep" />
          <button
            type="button"
            role="menuitem"
            className="cl-sheet-item is-danger"
            onClick={() => {
              setSheet(false)
              onDelete()
            }}
          >
            <TrashGlyph />
            <span>Delete session</span>
          </button>
        </div>
      )}

      <div className="cl-pill" role="toolbar" aria-label="Transcript controls">
        {showTranscriptControls && (
          <>
            <div className="cl-pill-filters" role="group" aria-label="Filter turns by type">
              {chip('all', 'All', counts.all)}
              {counts.tools > 0 && chip('tools', 'Tools', counts.tools)}
              {showThinking && counts.thinking > 0 && chip('thinking', 'Thinking', counts.thinking)}
              {counts.questions > 0 && chip('questions', 'Questions', counts.questions)}
              {counts.plan > 0 && chip('plan', 'Plan', counts.plan)}
            </div>
            <span className="cl-pill-div" />
            <div className="cl-seg" aria-label="Transcript detail">
              {(['minimal', 'all'] as ChatDetailsFilter[]).map(v => (
                <button key={v} type="button" className={density === v ? 'on' : ''} onClick={() => setDensity(v)}>
                  {v === 'minimal' ? 'Min' : 'Full'}
                </button>
              ))}
            </div>
            <span className="cl-pill-div" />
          </>
        )}
        <button className="cl-resume" type="button" onClick={onResume}>
          <PlayGlyph />
          <span>Resume</span>
        </button>
        <button
          type="button"
          className="cl-pill-more"
          aria-haspopup="menu"
          aria-expanded={sheet}
          data-on={sheet || undefined}
          title="Export & more"
          onClick={toggleSheet}
        >
          <ChevronUpGlyph />
        </button>
      </div>
    </div>
  )
}

export function ChatView({
  project,
  session,
  onBack,
}: {
  project: { hash: string; realPath: string }
  session: SessionSummary
  onBack: () => void
}) {
  const { data: messages, isLoading, isError, error, refetch } = useChatSession(project.hash, session.filename)
  const { data: subagentMetas } = useSessionSubagents(project.hash, session.filename)
  const projectName = projectDisplayName(project.realPath)
  const [viewMode, setViewMode] = useState<ViewMode>('chat')
  const [detailsFilter, setDetailsFilter] = useState<ChatDetailsFilter>('minimal')
  const [selectedTool, setSelectedTool] = useState<ToolGroup | null>(null)
  const [transcriptAgent, setTranscriptAgent] = useState<SessionAgent | null>(null)
  const [exportPreset, setExportPreset] = useState<ChatExportPreset>('team')
  const [exporting, setExporting] = useState<ChatExportFormat | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [turnFilter, setTurnFilter] = useState<TurnFilter>('all')
  const [activeTurn, setActiveTurn] = useState<number | null>(null)
  const feedRef = useRef<HTMLElement | null>(null)
  const turnRefs = useRef<Record<number, HTMLElement | null>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)
  // Tracks whether the feed was anchored near the bottom *before* the latest
  // re-render. Captured in onScroll (pre-update scrollHeight) so the auto-scroll
  // effect doesn't mistake a tall incoming message for the user scrolling away.
  const wasNearBottomRef = useRef(true)

  // Heavy: rebuild the processed transcript only when the raw messages change.
  const processed = useMemo(() => (messages ? buildProcessedMessages(messages) : []), [messages])
  const canExport = processed.length > 0 && !isLoading

  // Sub-agents dispatched in this session, correlated to their internal
  // transcript files. Drives the right-hand activity rail.
  const agents = useMemo(
    () => correlateSessionAgents(processed, subagentMetas ?? []),
    [processed, subagentMetas]
  )

  // The detail filter (Minimal/Full) drives which turns are visible — Minimal
  // hides thinking/tools — so the navigation descriptors depend on it too.
  const descriptors = useMemo(
    () => processed.map(p => describeTurn(p, detailsFilter)),
    [processed, detailsFilter]
  )
  const fmtTurnTime = useCallback(
    (ts: string | undefined) => (ts
      ? new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : ''),
    []
  )
  // Every turn that renders something — drives the type-filter counts so
  // "Tools" still reflects the collapsed tool-only turns.
  const visibleItems = useMemo<MinimapItem[]>(
    () => descriptors
      .map((d, i) => ({ ...d, n: i + 1, time: fmtTurnTime(processed[i]?.msg.timestamp) }))
      .filter(d => d.visible),
    [descriptors, processed, fmtTurnTime]
  )
  // The navigation rail shows one dot per *message* turn: tool-only turns
  // collapse into a single in-stream badge, so they don't earn a dot.
  const minimapItems = useMemo(() => visibleItems.filter(d => !d.toolsOnly), [visibleItems])
  // Collapse runs of consecutive tool-only turns into one badge. Non-rendering
  // turns are skipped without breaking a run (nothing shows between them).
  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = []
    let run: { count: number; firstIdx: number } | null = null
    const flush = () => {
      if (run) {
        items.push({ kind: 'tools', key: `tools-${run.firstIdx}`, count: run.count })
        run = null
      }
    }
    descriptors.forEach((d, idx) => {
      if (d.toolsOnly) {
        // toolsOnly guarantees the turn holds only standard tools (no question/agent).
        const n = processed[idx].toolGroups.length
        if (run) run.count += n
        else run = { count: n, firstIdx: idx }
      } else if (d.visible) {
        flush()
        items.push({ kind: 'turn', idx })
      }
    })
    flush()
    return items
  }, [processed, descriptors])

  const filterCounts = useMemo(
    () => ({
      all: visibleItems.length,
      tools: visibleItems.filter(d => d.hasTools).length,
      thinking: visibleItems.filter(d => d.hasThinking).length,
      questions: visibleItems.filter(d => d.hasQuestion).length,
      plan: visibleItems.filter(d => d.hasPlan).length,
    }),
    [visibleItems]
  )

  // Derived (not stored) so it can never get stuck: the active filter falls back
  // to "All" when it no longer has matching turns — e.g. Thinking in minimal
  // mode, or any chip that just dropped to 0 (and is now hidden) — otherwise the
  // transcript would stay fully dimmed with no way back.
  const activeFilter: TurnFilter =
    turnFilter !== 'all' &&
    ((turnFilter === 'thinking' && detailsFilter === 'minimal') || filterCounts[turnFilter] === 0)
      ? 'all'
      : turnFilter

  // Per-turn match against the active type filter (non-matching turns are dimmed,
  // never removed, so the conversation thread stays continuous).
  const matchesFilter = useCallback(
    (d: TurnDescriptor) => {
      switch (activeFilter) {
        case 'tools': return d.hasTools
        case 'thinking': return d.hasThinking && detailsFilter === 'all'
        case 'questions': return d.hasQuestion
        case 'plan': return d.hasPlan
        default: return true
      }
    },
    [activeFilter, detailsFilter]
  )

  // Stable ref setter (keyed by the turn's data-n) so MessageBubble's memo holds.
  const setTurnRef = useCallback((el: HTMLElement | null) => {
    const n = el?.dataset.n
    if (el && n) turnRefs.current[Number(n)] = el
  }, [])

  // Scroll-spy: highlight the turn nearest the viewport centre.
  useEffect(() => {
    const root = feedRef.current
    if (!root || minimapItems.length === 0) return
    setActiveTurn(prev => prev ?? minimapItems[0].n)
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) setActiveTurn(Number((e.target as HTMLElement).dataset.n))
        })
      },
      { root, rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    )
    Object.values(turnRefs.current).forEach(el => el && io.observe(el))
    return () => io.disconnect()
  }, [minimapItems, viewMode])

  const jumpToTurn = useCallback((n: number) => {
    const el = turnRefs.current[n]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveTurn(n)
  }, [])

  // The rail's "active" agent = the latest dispatch at or above the current
  // scroll position. As you scroll past one agent's card toward the next, the
  // highlight advances — the recorded-session echo of Claude Code's live pill.
  const activeAgentKey = useMemo(() => {
    if (agents.length === 0) return null
    if (activeTurn === null) return agents[0].key
    let key: string | null = null
    for (const a of agents) {
      if (a.turnN <= activeTurn) key = a.key
      else break
    }
    return key ?? agents[0].key
  }, [agents, activeTurn])

  const title = sessionTitle(session)
  const selectedExportPreset = CHAT_EXPORT_PRESETS.find(p => p.value === exportPreset) ?? CHAT_EXPORT_PRESETS[0]

  // Scroll to bottom when new messages arrive, but only when already near the bottom
  // so manual scrolling up isn't interrupted.
  useEffect(() => {
    if (wasNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [renderItems.length])

  async function handleExport(format: ChatExportFormat) {
    if (!canExport) return
    setExporting(format)
    setExportError(null)
    setExportMessage(null)

    try {
      const doc = buildChatExportDocument({
        projectPath: project.realPath,
        session,
        processed,
        preset: exportPreset,
      })
      const result = format === 'markdown'
        ? await saveMarkdownExport(`${doc.defaultBaseName}.md`, doc.markdown)
        : await savePdfExport(`${doc.defaultBaseName}.pdf`, doc.html)

      if (!result.canceled) {
        setExportMessage(`Saved ${format === 'markdown' ? 'Markdown' : 'PDF'}${result.filePath ? ` to ${result.filePath}` : ''}`)
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(null)
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
      onResume={() => window.electronAPI.sessions.openInTerminal(project.realPath, session.filename.replace('.jsonl', ''))}
      canExport={canExport}
      exporting={exporting}
      exportPreset={exportPreset}
      exportMessage={exportMessage}
      exportError={exportError}
      selectedExportPreset={selectedExportPreset}
      onOpenSheet={() => {
        setExportError(null)
        setExportMessage(null)
      }}
      onExportPreset={setExportPreset}
      onExport={handleExport}
      onDelete={() => setShowDelete(true)}
    />
  )

  return (
    <div className="cl-chat">
      <TopBar
        onBack={onBack}
        backLabel={`${projectName} · Sessions`}
        crumbs={[{ label: title, accent: true }]}
        right={
          <div className="cl-view-mode" aria-label="View mode">
            {(['chat', 'timeline'] as ViewMode[]).map(v => (
              <button
                key={v}
                type="button"
                className={viewMode === v ? 'on' : ''}
                onClick={() => setViewMode(v)}
                title={v === 'timeline' ? 'Session timeline (swimlanes by file/tool)' : 'Linear transcript'}
              >
                {v === 'chat' ? 'Chat' : 'Timeline'}
              </button>
            ))}
          </div>
        }
      />

      {showDelete && (
        <DeleteSessionDialog
          hash={project.hash}
          sessionFilename={session.filename}
          title={title}
          onCancel={() => setShowDelete(false)}
          onDeleted={() => {
            setShowDelete(false)
            onBack()
          }}
        />
      )}

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
      ) : (
        <div className={`cl-chat-workspace cl-chat-workspace--focus${agents.length > 0 ? ' cl-chat-workspace--with-rail' : ''}`}>
          <main
            className="cl-chat-feed"
            ref={feedRef}
            onScroll={e => {
              const el = e.target as HTMLElement
              // Capture anchoring with the current (pre-render) scrollHeight so the
              // auto-scroll effect knows the user was at the bottom even when the
              // next message is taller than the 200px threshold.
              wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 200
            }}
          >
            {isLoading && (
              <p className="cl-transcript-state">Loading transcript…</p>
            )}
            {messages?.length === 0 && !isLoading && (
              <p className="cl-transcript-state">No messages found in this session.</p>
            )}

            {processed.length > 0 && (
              <div className="cl-chat-reading">
                <div className="cl-transcript-inner">
                  {renderItems.map(item =>
                    item.kind === 'turn' ? (
                      <MessageBubble
                        key={processed[item.idx].msg.uuid}
                        processed={processed[item.idx]}
                        detailsFilter={detailsFilter}
                        onOpenToolDetail={setSelectedTool}
                        turnIndex={item.idx + 1}
                        dimmed={activeFilter !== 'all' && descriptors[item.idx]?.visible && !matchesFilter(descriptors[item.idx])}
                        innerRef={setTurnRef}
                      />
                    ) : (
                      <ToolsHiddenBadge
                        key={item.key}
                        count={item.count}
                        dimmed={activeFilter !== 'all' && activeFilter !== 'tools'}
                      />
                    )
                  )}
                  <div ref={bottomRef} />
                </div>
              </div>
            )}
          </main>

          <FocusMinimap
            items={minimapItems}
            active={activeTurn}
            matches={matchesFilter}
            onJump={jumpToTurn}
          />

          {agents.length > 0 && (
            <AgentRail
              agents={agents}
              activeKey={activeAgentKey}
              onOpen={setTranscriptAgent}
              onLocate={jumpToTurn}
            />
          )}

          {controlPill(true)}
        </div>
      )}
    </div>
  )
}
