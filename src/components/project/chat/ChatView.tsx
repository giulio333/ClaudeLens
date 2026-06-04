import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, RefObject, MouseEvent as ReactMouseEvent } from 'react'
import { saveMarkdownExport, savePdfExport, useChatSession, useSessionSubagents } from '../../../hooks/useIPC'
import { SessionSummary } from '../../../hooks/useIPC'
import { fmt, fmtModel, modelColor, sessionTitle } from '../utils'
import { buildProcessedMessages, correlateSessionAgents, describeTurn, isMemoryFile, ChatDetailsFilter, SessionAgent, ToolGroup, TurnDescriptor } from './utils'
import { buildChatExportDocument, CHAT_EXPORT_PRESETS, ChatExportFormat, ChatExportPreset } from './export'
import { ToolDetailPanel } from './ToolDetailPanel'
import { AgentRail } from './AgentRail'
import { SubagentTranscriptPanel } from './SubagentTranscriptPanel'
import { MessageBubble, ToolsHiddenBadge } from './MessageBubble'
import { TopBar } from '../shared/TopBar'
import { SessionGraphView } from './graph/SessionGraphView'
import { QueryError } from '../../QueryError'
import { projectDisplayName } from '../shared/projectName'

type ViewMode = 'chat' | 'timeline'

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2v7" />
      <path d="M5.5 6.5 8 9l2.5-2.5" />
      <path d="M3 10.5V13h10v-2.5" />
    </svg>
  )
}

function PlayGlyph() {
  return <span className="cl-resume-play" aria-hidden />
}

function ChatExportMenu({
  canExport,
  exportOpen,
  exporting,
  exportPreset,
  exportMessage,
  exportError,
  selectedExportPreset,
  menuRef,
  onToggle,
  onPreset,
  onExport,
}: {
  canExport: boolean
  exportOpen: boolean
  exporting: ChatExportFormat | null
  exportPreset: ChatExportPreset
  exportMessage: string | null
  exportError: string | null
  selectedExportPreset: (typeof CHAT_EXPORT_PRESETS)[number]
  menuRef: RefObject<HTMLDivElement | null>
  onToggle: () => void
  onPreset: (preset: ChatExportPreset) => void
  onExport: (format: ChatExportFormat) => void
}) {
  return (
    <div className="cl-export" ref={menuRef}>
      <button
        type="button"
        className="cl-export-trigger"
        disabled={!canExport || exporting !== null}
        aria-expanded={exportOpen}
        onClick={onToggle}
      >
        <ExportIcon />
        <span>{exporting ? 'Exporting' : 'Export'}</span>
      </button>
      {exportOpen && (
        <div className="cl-export-panel">
          <div className="cl-export-label">Preset</div>
          <div className="cl-export-presets">
            {CHAT_EXPORT_PRESETS.map(preset => (
              <button
                key={preset.value}
                type="button"
                className={exportPreset === preset.value ? 'is-active' : ''}
                onClick={() => onPreset(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="cl-export-desc">{selectedExportPreset.description}</p>
          <div className="cl-export-actions">
            <button
              type="button"
              disabled={!canExport || exporting !== null}
              onClick={() => onExport('markdown')}
            >
              {exporting === 'markdown' ? 'Saving...' : 'Markdown'}
            </button>
            <button
              type="button"
              disabled={!canExport || exporting !== null}
              onClick={() => onExport('pdf')}
            >
              {exporting === 'pdf' ? 'Saving...' : 'PDF'}
            </button>
          </div>
          {exportMessage && <p className="cl-export-status is-ok">{exportMessage}</p>}
          {exportError && <p className="cl-export-status is-error">{exportError}</p>}
        </div>
      )}
    </div>
  )
}

function ChatTopActions({
  viewMode,
  setViewMode,
  detailsFilter,
  setDetailsFilter,
  canExport,
  exportOpen,
  exporting,
  exportPreset,
  exportMessage,
  exportError,
  selectedExportPreset,
  exportMenuRef,
  onToggleExport,
  onExportPreset,
  onExport,
  onResume,
}: {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  detailsFilter: ChatDetailsFilter
  setDetailsFilter: (filter: ChatDetailsFilter) => void
  canExport: boolean
  exportOpen: boolean
  exporting: ChatExportFormat | null
  exportPreset: ChatExportPreset
  exportMessage: string | null
  exportError: string | null
  selectedExportPreset: (typeof CHAT_EXPORT_PRESETS)[number]
  exportMenuRef: RefObject<HTMLDivElement | null>
  onToggleExport: () => void
  onExportPreset: (preset: ChatExportPreset) => void
  onExport: (format: ChatExportFormat) => void
  onResume: () => void
}) {
  return (
    <>
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
      {viewMode === 'chat' && (
        <div className="cl-seg" aria-label="Transcript detail">
          {(['minimal', 'all'] as ChatDetailsFilter[]).map(v => (
            <button
              key={v}
              type="button"
              className={detailsFilter === v ? 'on' : ''}
              onClick={() => setDetailsFilter(v)}
            >
              {v === 'minimal' ? 'Minimal' : 'Full'}
            </button>
          ))}
        </div>
      )}
      <ChatExportMenu
        canExport={canExport}
        exportOpen={exportOpen}
        exporting={exporting}
        exportPreset={exportPreset}
        exportMessage={exportMessage}
        exportError={exportError}
        selectedExportPreset={selectedExportPreset}
        menuRef={exportMenuRef}
        onToggle={onToggleExport}
        onPreset={onExportPreset}
        onExport={onExport}
      />
      <button className="cl-resume" type="button" onClick={onResume}>
        <PlayGlyph />
        <span>Resume</span>
      </button>
    </>
  )
}

function splitCost(value: number): { whole: string; decimals: string | null } {
  const fixed = value.toFixed(2)
  const [whole, dec] = fixed.split('.')
  return { whole: `$${whole}`, decimals: `.${dec}` }
}

function ChatSessionHeader({
  title,
  session,
  projectName,
  totalMessages,
  totalToolCalls,
  duration,
  collapsed,
}: {
  title: string
  session: SessionSummary
  projectName: string
  totalMessages: number
  totalToolCalls: number
  duration: string | null
  collapsed: boolean
}) {
  const cost = splitCost(session.estimatedCost)

  return (
    <div className={`cl-chat-collapsible${collapsed ? ' is-collapsed' : ''}`}>
      <div className="cl-chat-collapsible-inner">
      <section className="cl-chat-hero">
        <div className="cl-chat-hero-text">
          <div className="cl-eyebrow cl-chat-eyebrow">
            <span className="pip" />
            <span>Session · {projectName}</span>
          </div>
          <h1>
            {title}
            <span className="cl-chat-h1-dot">.</span>
          </h1>
          <div className="cl-chat-submeta">
            <span className="cl-chat-file">{session.filename}</span>
            {session.template && session.template !== 'claude' && (
              <>
                <span className="sep">·</span>
                <span style={{ textTransform: 'uppercase' }}>{session.template}</span>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="cl-chat-stats">
        <div className="cl-chat-stat">
          <div className="l">Turns</div>
          <div className="n">{fmt(totalMessages)}</div>
        </div>
        <div className="cl-chat-stat">
          <div className="l">Tool calls</div>
          <div className="n">{fmt(totalToolCalls)}</div>
        </div>
        {duration && (
          <div className="cl-chat-stat">
            <div className="l">Duration</div>
            <div className="n cl-chat-duration">{duration}</div>
          </div>
        )}
        <div className="cl-chat-stat is-dark">
          <div className="l">Cost</div>
          <div className="n">{cost.whole}{cost.decimals && <small>{cost.decimals}</small>}</div>
        </div>
      </section>
      </div>
    </div>
  )
}

type TurnFilter = 'all' | 'tools' | 'thinking' | 'questions' | 'plan'

function fmtK(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm'
  if (n >= 1e3) return Math.round(n / 1e3) + 'k'
  return String(n)
}

/** Per-model token distribution — a single stacked bar + legend (prototype's da-models). */
function ChatModelBar({ models }: { models: [string, number][] }) {
  const total = models.reduce((s, [, t]) => s + t, 0)
  if (total <= 0) return null
  return (
    <div className="cl-chat-models">
      <div className="cl-chat-mbar" role="img" aria-label="Token distribution by model">
        {models.map(([name, tokens]) => (
          <span
            key={name}
            style={{ width: `${(tokens / total) * 100}%`, background: modelColor(name) }}
            title={`${fmtModel(name)} · ${fmtK(tokens)} tok`}
          />
        ))}
      </div>
      {models.map(([name, tokens]) => (
        <span key={name} className="cl-chat-mkey">
          <i style={{ background: modelColor(name) }} />
          {fmtModel(name)}
          <span className="t">{fmtK(tokens)}</span>
        </span>
      ))}
    </div>
  )
}

type MinimapItem = TurnDescriptor & { n: number; time: string }

/** One row in the transcript stream: either a real message turn, or a run of
 *  consecutive tool-only turns collapsed into a single "tools hidden" badge. */
type RenderItem =
  | { kind: 'turn'; idx: number }
  | { kind: 'tools'; key: string; count: number }

/** Navigable turn-index rail with scroll-spy. One colour-coded dot per turn,
 *  hover label, click to jump, active dot enlarged. The dots are deliberately
 *  tiny so long sessions fit; a Dock-style fisheye lens swells the dots near
 *  the pointer so they stay easy to read and click. The lens writes a `--mag`
 *  CSS var per dot straight to the DOM (inside rAF) — no React re-render. */
function TurnMinimap({
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
  const navRef = useRef<HTMLElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const pointerY = useRef(0)

  // Falloff of the lens, in viewport px around the pointer. Dots sit on a fixed
  // row pitch, so we read one rect (the first button) and extrapolate the rest —
  // cheap and reflow-free (one read, then only --mag writes).
  // BOOST is capped so the peak dot's visual diameter (8px × (1+BOOST) ≈ 15px,
  // plus its ring) stays under the 20px row pitch — that's what keeps swollen
  // neighbours from ever overlapping, no matter how many the lens catches.
  const LENS_RADIUS = 50
  const LENS_BOOST = 0.85

  const applyLens = useCallback(() => {
    rafRef.current = null
    const nav = navRef.current
    const first = nav?.firstElementChild as HTMLElement | null
    if (!nav || !first) return
    const rect = first.getBoundingClientRect()
    const firstCenter = rect.top + rect.height / 2
    const rowH = rect.height || 16
    const y = pointerY.current
    const dots = nav.children
    for (let i = 0; i < dots.length; i++) {
      const dist = Math.abs(firstCenter + i * rowH - y)
      const t = Math.max(0, 1 - dist / LENS_RADIUS)
      const scale = 1 + LENS_BOOST * t * t
      ;(dots[i] as HTMLElement).style.setProperty('--mag', scale.toFixed(3))
    }
  }, [])

  const handleMove = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    pointerY.current = e.clientY
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(applyLens)
  }, [applyLens])

  const resetLens = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const nav = navRef.current
    if (!nav) return
    const dots = nav.children
    for (let i = 0; i < dots.length; i++) (dots[i] as HTMLElement).style.setProperty('--mag', '1')
  }, [])

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  return (
    <nav
      className="cl-minimap"
      ref={navRef}
      aria-label="Turn index"
      onMouseMove={handleMove}
      onMouseLeave={resetLens}
    >
      {items.map(it => (
        <button
          key={it.n}
          type="button"
          className="cl-minimap-item"
          style={{ '--c': it.color } as CSSProperties}
          data-active={active === it.n || undefined}
          data-dim={!matches(it) || undefined}
          onClick={() => onJump(it.n)}
          title={`${String(it.n).padStart(2, '0')} · ${it.label} · ${it.time}`}
          aria-label={`Jump to turn ${it.n}, ${it.label}`}
        >
          <span className="d" />
          <span className="n">{String(it.n).padStart(2, '0')} {it.label}</span>
        </button>
      ))}
    </nav>
  )
}

function ChatTypeFilters({
  filter,
  setFilter,
  counts,
  showThinking,
}: {
  filter: TurnFilter
  setFilter: (f: TurnFilter) => void
  counts: { all: number; tools: number; thinking: number; questions: number; plan: number }
  showThinking: boolean
}) {
  const Chip = ({ id, label, c }: { id: TurnFilter; label: string; c: number }) => (
    <button
      type="button"
      className="cl-filter"
      data-on={filter === id || undefined}
      onClick={() => setFilter(filter === id ? 'all' : id)}
    >
      {label}
      <span className="c">{c}</span>
    </button>
  )
  return (
    <div className="cl-chat-filters" role="group" aria-label="Filter turns by type">
      <Chip id="all" label="All" c={counts.all} />
      {counts.tools > 0 && <Chip id="tools" label="Tools" c={counts.tools} />}
      {showThinking && counts.thinking > 0 && <Chip id="thinking" label="Thinking" c={counts.thinking} />}
      {counts.questions > 0 && <Chip id="questions" label="Questions" c={counts.questions} />}
      {counts.plan > 0 && <Chip id="plan" label="Plan" c={counts.plan} />}
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
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPreset, setExportPreset] = useState<ChatExportPreset>('team')
  const [exporting, setExporting] = useState<ChatExportFormat | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  const [turnFilter, setTurnFilter] = useState<TurnFilter>('all')
  const [activeTurn, setActiveTurn] = useState<number | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const feedRef = useRef<HTMLElement | null>(null)
  const turnRefs = useRef<Record<number, HTMLElement | null>>({})

  // Heavy: rebuild the processed transcript only when the raw messages change,
  // not on every render (e.g. header collapse toggles fired during scroll).
  const processed = useMemo(() => (messages ? buildProcessedMessages(messages) : []), [messages])
  const canExport = processed.length > 0 && !isLoading

  // Sub-agents dispatched in this session, correlated to their internal
  // transcript files. Drives the right-hand activity rail.
  const agents = useMemo(
    () => correlateSessionAgents(processed, subagentMetas ?? []),
    [processed, subagentMetas]
  )

  // Derived session stats — also O(n), so memoize on the processed list.
  const stats = useMemo(() => {
    const realUserCount = processed.filter(p => p.msg.role === 'user').length
    const realAssistantCount = processed.filter(p => p.msg.role === 'assistant').length

    const toolCounts = processed.reduce(
      (acc, p) => {
        for (const g of p.toolGroups) {
          acc[g.use.name] = (acc[g.use.name] ?? 0) + 1
          if (isMemoryFile(g.use.input as Record<string, unknown>)) {
            acc['_memory'] = (acc['_memory'] ?? 0) + 1
          }
        }
        return acc
      },
      {} as Record<string, number>
    )
    const toolEntries = Object.entries(toolCounts).filter(([k]) => k !== '_memory')
    return {
      totalMessages: realUserCount + realAssistantCount,
      totalToolCalls: toolEntries.reduce((s, [, c]) => s + c, 0),
    }
  }, [processed])
  const { totalMessages, totalToolCalls } = stats

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

  // Per-turn match against the active type filter (non-matching turns are dimmed,
  // never removed, so the conversation thread stays continuous).
  const matchesFilter = useCallback(
    (d: TurnDescriptor) => {
      switch (turnFilter) {
        case 'tools': return d.hasTools
        case 'thinking': return d.hasThinking && detailsFilter === 'all'
        case 'questions': return d.hasQuestion
        case 'plan': return d.hasPlan
        default: return true
      }
    },
    [turnFilter, detailsFilter]
  )
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
  // Model token distribution (descending), excluding the synthetic bucket.
  const modelEntries = useMemo<[string, number][]>(
    () => Object.entries(session.models ?? {})
      .filter(([k, v]) => k !== '<synthetic>' && v > 0)
      .sort((a, b) => b[1] - a[1]),
    [session.models]
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

  // Reset to "All" when the active filter no longer has matching turns — e.g.
  // Thinking in minimal mode, or any chip that just dropped to 0 (and is now
  // hidden), so the transcript never gets stuck fully dimmed with no way back.
  useEffect(() => {
    if (turnFilter === 'all') return
    if (turnFilter === 'thinking' && detailsFilter === 'minimal') { setTurnFilter('all'); return }
    if (filterCounts[turnFilter] === 0) setTurnFilter('all')
  }, [detailsFilter, turnFilter, filterCounts])

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

  const duration = useMemo(() => {
    const t0 = processed[0]?.msg.timestamp
    const t1 = processed[processed.length - 1]?.msg.timestamp
    if (!t0 || !t1) return null
    const ms = new Date(t1).getTime() - new Date(t0).getTime()
    if (ms <= 0) return null
    const s = Math.round(ms / 1000)
    const m = Math.floor(s / 60)
    return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
  }, [processed])

  useEffect(() => {
    if (!exportOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (exportMenuRef.current?.contains(event.target as Node)) return
      setExportOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [exportOpen])

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

  return (
    <div className="cl-chat">
      <TopBar
        onBack={onBack}
        backLabel={`${projectName} · Sessions`}
        crumbs={[{ label: title, accent: true }]}
        right={
          <ChatTopActions
            viewMode={viewMode}
            setViewMode={setViewMode}
            detailsFilter={detailsFilter}
            setDetailsFilter={setDetailsFilter}
            canExport={canExport}
            exportOpen={exportOpen}
            exporting={exporting}
            exportPreset={exportPreset}
            exportMessage={exportMessage}
            exportError={exportError}
            selectedExportPreset={selectedExportPreset}
            exportMenuRef={exportMenuRef}
            onToggleExport={() => {
              setExportOpen(open => !open)
              setExportError(null)
              setExportMessage(null)
            }}
            onExportPreset={setExportPreset}
            onExport={handleExport}
            onResume={() => window.electronAPI.sessions.openInTerminal(project.realPath, session.filename.replace('.jsonl', ''))}
          />
        }
      />

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
        </div>
      ) : (
        <div className={`cl-chat-workspace${agents.length > 0 ? ' cl-chat-workspace--with-rail' : ''}`}>
          <main
            className="cl-chat-feed"
            ref={feedRef}
            onScroll={e => {
              const el = e.target as HTMLElement
              const top = el.scrollTop
              // hysteresis: collapse at 220px, expand back only under 80px — evita flicker
              if (headerCollapsed) {
                if (top <= 80) setHeaderCollapsed(false)
                return
              }
              // Collassare l'header riduce lo scrollHeight di tutta la sua altezza.
              // Su chat corte ciò forzerebbe il browser a clampare scrollTop verso
              // l'alto (la scrollbar "salta" da sola) e l'isteresi rimbalzerebbe in
              // un loop collapse↔expand. Collassa solo se, tolto l'header, il
              // contenuto resta scrollabile almeno fino alla posizione corrente:
              // così scrollTop non viene mai clampato → niente salto, niente loop.
              if (top <= 220) return
              let collapsibleH = 0
              el.querySelectorAll('.cl-chat-collapsible').forEach(c => {
                collapsibleH += (c as HTMLElement).offsetHeight
              })
              const maxScrollAfter = el.scrollHeight - el.clientHeight - collapsibleH
              if (maxScrollAfter >= top) setHeaderCollapsed(true)
            }}
          >
            <ChatSessionHeader
              title={title}
              session={session}
              projectName={projectName}
              totalMessages={totalMessages}
              totalToolCalls={totalToolCalls}
              duration={duration}
              collapsed={headerCollapsed}
            />

            {modelEntries.length > 0 && (
              <div className={`cl-chat-collapsible${headerCollapsed ? ' is-collapsed' : ''}`}>
                <div className="cl-chat-collapsible-inner">
                  <ChatModelBar models={modelEntries} />
                </div>
              </div>
            )}

            {processed.length > 0 && (
              <ChatTypeFilters
                filter={turnFilter}
                setFilter={setTurnFilter}
                counts={filterCounts}
                showThinking={detailsFilter === 'all'}
              />
            )}

            {isLoading && (
              <p className="cl-transcript-state">
                Loading transcript…
              </p>
            )}
            {messages?.length === 0 && !isLoading && (
              <p className="cl-transcript-state">
                No messages found in this session.
              </p>
            )}

            {processed.length > 0 && (
              <div className="cl-chat-main">
                <TurnMinimap
                  items={minimapItems}
                  active={activeTurn}
                  matches={matchesFilter}
                  onJump={jumpToTurn}
                />
                <div className="cl-transcript-inner">
                  {renderItems.map(item =>
                    item.kind === 'turn' ? (
                      <MessageBubble
                        key={processed[item.idx].msg.uuid}
                        processed={processed[item.idx]}
                        detailsFilter={detailsFilter}
                        onOpenToolDetail={setSelectedTool}
                        turnIndex={item.idx + 1}
                        dimmed={turnFilter !== 'all' && descriptors[item.idx]?.visible && !matchesFilter(descriptors[item.idx])}
                        innerRef={setTurnRef}
                      />
                    ) : (
                      <ToolsHiddenBadge
                        key={item.key}
                        count={item.count}
                        dimmed={turnFilter !== 'all' && turnFilter !== 'tools'}
                      />
                    )
                  )}
                </div>
              </div>
            )}
          </main>
          {agents.length > 0 && (
            <AgentRail
              agents={agents}
              activeKey={activeAgentKey}
              onOpen={setTranscriptAgent}
              onLocate={jumpToTurn}
            />
          )}
        </div>
      )}
    </div>
  )
}
