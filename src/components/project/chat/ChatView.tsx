import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { saveMarkdownExport, savePdfExport, useChatSession, useSessionSubagents, useGlobalAgents, useProjectAgents } from '../../../hooks/useIPC'
import { SessionSummary } from '../../../hooks/useIPC'
import { sessionTitle } from '../utils'
import { buildProcessedMessages, correlateSessionAgents, describeTurn, ChatDetailsFilter, SessionAgent, ToolGroup, TurnDescriptor } from './utils'
import { buildChatExportDocument, CHAT_EXPORT_PRESETS, ChatExportFormat, ChatExportPreset } from './export'
import { ToolDetailPanel } from './ToolDetailPanel'
import { SubagentTranscriptPanel } from './SubagentTranscriptPanel'
import { MessageBubble } from './MessageBubble'
import { agentTintColor } from '../shared/entityOptions'
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

/** Caret on the agent dock — points up when collapsed (the sheet opens upward),
 *  flips down once the sheet is open. */
function DockCaretGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  )
}

function LocateGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2v9" />
      <path d="M4.5 7.5 8 11l3.5-3.5" />
      <path d="M3 13h10" />
    </svg>
  )
}

function fmtAgentSpan(startedAt?: string, endedAt?: string): string | null {
  if (!startedAt || !endedAt) return null
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

function fmtAgentClock(ts?: string): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })
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

/** Inline style that paints an orb with a sub-agent's identity color, falling
 *  back to the default violet (handled in CSS) when the agent has no color. */
function orbStyle(color?: string): CSSProperties {
  return color ? ({ '--orb-color': color } as CSSProperties) : {}
}

/** Overlapping avatar cluster shown on the footer agent dock — the collapsed
 *  representation of every sub-agent this session spawned. Caps at four orbs and
 *  spills the remainder into a "+N" chip so a busy session stays compact. Each
 *  orb wears its sub-agent's identity color. */
function AgentOrbCluster({
  agents,
  colorOf,
}: {
  agents: SessionAgent[]
  colorOf: (agent: SessionAgent) => string | undefined
}) {
  const shown = agents.slice(0, 4)
  const overflow = agents.length - shown.length
  return (
    <span className="cl-dock-orbs">
      {shown.map((a, i) => (
        <span key={a.key} className="cl-dock-orb" style={{ zIndex: shown.length - i, ...orbStyle(colorOf(a)) }}>{(a.subagentType?.[0] ?? 'A').toUpperCase()}</span>
      ))}
      {overflow > 0 && <span className="cl-dock-orb cl-dock-orb--more" style={{ zIndex: 0 }}>+{overflow}</span>}
    </span>
  )
}

/** The agent dock that lives inside the control pill (Focus layout, variant 4):
 *  an overlapping avatar cluster + count that toggles a sheet listing every
 *  sub-agent. The sheet is rendered by ChatControlPill above the pill; this just
 *  owns the trigger and the row list. Replaces the old right-hand AgentRail so
 *  the transcript keeps the full width. */
function AgentDockSheet({
  agents,
  activeKey,
  colorOf,
  onOpen,
  onLocate,
}: {
  agents: SessionAgent[]
  activeKey: string | null
  colorOf: (agent: SessionAgent) => string | undefined
  onOpen: (agent: SessionAgent) => void
  onLocate: (turnN: number) => void
}) {
  const failed = agents.filter(a => a.isError).length
  return (
    <div className="cl-sheet cl-sheet--agents" role="menu">
      <div className="cl-sheet-head">
        <span className="cl-dock-sheet-label">
          Agents used · {agents.length}
          {failed > 0 && <em className="cl-dock-sheet-fail"> · {failed} failed</em>}
        </span>
      </div>
      <div className="cl-dock-rows">
        {agents.map(a => {
          const span = fmtAgentSpan(a.startedAt, a.endedAt)
          const hasTranscript = a.agentId !== null
          return (
            <div
              key={a.key}
              className="cl-dock-row"
              data-active={activeKey === a.key || undefined}
              data-error={a.isError || undefined}
            >
              <button
                type="button"
                className="cl-dock-row-main"
                onClick={() => (hasTranscript ? onOpen(a) : onLocate(a.turnN))}
                title={hasTranscript ? 'View agent transcript' : 'Locate dispatch in chat'}
              >
                <span className="orb" aria-hidden style={orbStyle(colorOf(a))}>{(a.subagentType?.[0] ?? 'A').toUpperCase()}</span>
                <span className="body">
                  <span className="r1">
                    <span className="name">{a.subagentType}</span>
                    <span className="status">{a.isError ? 'failed' : 'done'}</span>
                  </span>
                  {a.description && <span className="desc">{a.description}</span>}
                  <span className="meta">
                    {a.startedAt && (
                      <span className="time">
                        {fmtAgentClock(a.startedAt)}
                        {span && <> · {span}</>}
                      </span>
                    )}
                    {typeof a.messageCount === 'number' && <span className="steps">{a.messageCount} steps</span>}
                    {!hasTranscript && <span className="steps">no transcript</span>}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="cl-dock-row-locate"
                onClick={() => onLocate(a.turnN)}
                title="Jump to dispatch in chat"
                aria-label="Jump to dispatch in chat"
              >
                <LocateGlyph />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Floating glass control pill (Focus layout) — bottom-centre. Holds the
 *  transcript filters + density toggle (chat mode only), the agent dock, the
 *  Resume action, and a "more" trigger that raises the export / delete sheet
 *  above the pill. Only one sheet (agents or export) is open at a time. */
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
  agents,
  activeAgentKey,
  agentColorOf,
  onOpenAgent,
  onLocateAgent,
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
  agents: SessionAgent[]
  activeAgentKey: string | null
  agentColorOf: (agent: SessionAgent) => string | undefined
  onOpenAgent: (agent: SessionAgent) => void
  onLocateAgent: (turnN: number) => void
}) {
  // Only one sheet is raised above the pill at a time: the agent dock list or
  // the export/delete menu.
  const [sheet, setSheet] = useState<'export' | 'agents' | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!sheet) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setSheet(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [sheet])

  const toggleExport = () => {
    setSheet(s => {
      const next = s === 'export' ? null : 'export'
      if (next === 'export') onOpenSheet()
      return next
    })
  }
  const toggleAgents = () => setSheet(s => (s === 'agents' ? null : 'agents'))

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
      {sheet === 'agents' && agents.length > 0 && (
        <AgentDockSheet
          agents={agents}
          activeKey={activeAgentKey}
          colorOf={agentColorOf}
          onOpen={agent => {
            setSheet(null)
            onOpenAgent(agent)
          }}
          onLocate={turnN => {
            setSheet(null)
            onLocateAgent(turnN)
          }}
        />
      )}
      {sheet === 'export' && (
        <div className="cl-sheet" role="menu">
          <div className="cl-sheet-head">
            <span className="cl-export-label">Export</span>
            <button type="button" className="cl-sheet-close" aria-label="Close" onClick={() => setSheet(null)}>✕</button>
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
              setSheet(null)
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
        {agents.length > 0 && (
          <>
            <button
              type="button"
              className="cl-pill-dock"
              aria-haspopup="menu"
              aria-expanded={sheet === 'agents'}
              data-on={sheet === 'agents' || undefined}
              title={`${agents.length} sub-agent${agents.length > 1 ? 's' : ''} used`}
              onClick={toggleAgents}
            >
              <AgentOrbCluster agents={agents} colorOf={agentColorOf} />
              <span className="cl-dock-count">{agents.length} <span>agents</span></span>
              {agents.some(a => a.isError) && <span className="cl-dock-fail" aria-hidden />}
              <DockCaretGlyph open={sheet === 'agents'} />
            </button>
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
          aria-expanded={sheet === 'export'}
          data-on={sheet === 'export' || undefined}
          title="Export & more"
          onClick={toggleExport}
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
  const { data: globalAgents } = useGlobalAgents()
  const { data: projectAgents } = useProjectAgents(project.realPath)
  const projectName = projectDisplayName(project.realPath)

  // Resolve a dispatched sub-agent's identity color from its definition
  // (`subagent_type` → agent.color). Project agents win over globals on name
  // clash. Returns undefined when the agent is unknown or has no color, so the
  // cards fall back to their default tint.
  const agentColorOf = useMemo(() => {
    const byName = new Map<string, string>()
    for (const a of globalAgents ?? []) if (a.color) byName.set(a.name, a.color)
    for (const a of projectAgents ?? []) if (a.color) byName.set(a.name, a.color)
    return (subagentType: string) => byName.get(subagentType)
  }, [globalAgents, projectAgents])
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
  // Ref mirror of activeTurn so the density-change layout effect can read
  // the current turn without listing activeTurn as a dependency (which would
  // cause it to fire on every scroll-spy update, fighting user scrolling).
  const activeTurnRef = useRef<number | null>(null)

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
    () => processed.map(p => describeTurn(p, detailsFilter, t => agentTintColor(agentColorOf(t)))),
    [processed, detailsFilter, agentColorOf]
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

  // Keep activeTurnRef in sync so layout effects can read it without deps.
  useEffect(() => { activeTurnRef.current = activeTurn }, [activeTurn])

  // Anchor the feed after a density change: if near the bottom, snap back to
  // bottom; otherwise keep the scroll-spy turn in view. useLayoutEffect fires
  // after DOM mutations but before paint, so the corrected position never flashes.
  useLayoutEffect(() => {
    const feed = feedRef.current
    if (!feed) return
    if (wasNearBottomRef.current) {
      feed.scrollTop = feed.scrollHeight - feed.clientHeight
    } else {
      const turn = activeTurnRef.current
      if (turn !== null) turnRefs.current[turn]?.scrollIntoView({ block: 'nearest' })
    }
  }, [detailsFilter])

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
      agents={agents}
      activeAgentKey={activeAgentKey}
      agentColorOf={a => agentTintColor(agentColorOf(a.subagentType))}
      onOpenAgent={setTranscriptAgent}
      onLocateAgent={jumpToTurn}
    />
  )

  return (
    <div className="cl-chat">
      <TopBar
        onBack={onBack}
        backLabel="Sessions"
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
        <div className="cl-chat-workspace cl-chat-workspace--focus">
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
                  {(() => {
                    let prevRole: string | null = null
                    let pendingHidden = 0
                    return renderItems.map(item => {
                      if (item.kind !== 'turn') {
                        prevRole = null
                        pendingHidden = item.count
                        return null
                      }
                      const curRole = processed[item.idx].msg.role
                      const hasText = processed[item.idx].msg.content.some(b => b.type === 'text')
                      const isContinuation = !hasText && curRole === prevRole && curRole === 'assistant'
                      prevRole = curRole
                      const hiddenToolCount = pendingHidden
                      pendingHidden = 0
                      return (
                        <MessageBubble
                          key={processed[item.idx].msg.uuid}
                          processed={processed[item.idx]}
                          detailsFilter={detailsFilter}
                          onOpenToolDetail={setSelectedTool}
                          agentColorOf={agentColorOf}
                          turnIndex={item.idx + 1}
                          dimmed={activeFilter !== 'all' && descriptors[item.idx]?.visible && !matchesFilter(descriptors[item.idx])}
                          isContinuation={isContinuation}
                          innerRef={setTurnRef}
                          hiddenToolCount={hiddenToolCount}
                        />
                      )
                    })
                  })()}
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

          {controlPill(true)}
        </div>
      )}
    </div>
  )
}
