import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { saveMarkdownExport, savePdfExport, useChatSession } from '../../../hooks/useIPC'
import { SessionSummary } from '../../../hooks/useIPC'
import { fmt, fmtDate, fmtModel, modelColor, sessionTitle } from '../utils'
import { buildProcessedMessages, isMemoryFile, ChatDetailsFilter, ToolGroup, TOOL_TINT } from './utils'
import { buildChatExportDocument, CHAT_EXPORT_PRESETS, ChatExportFormat, ChatExportPreset } from './export'
import { ToolDetailPanel } from './ToolDetailPanel'
import { MessageBubble } from './MessageBubble'
import { TopBar } from '../shared/TopBar'

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
  menuRef: RefObject<HTMLDivElement>
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
  detailsFilter: ChatDetailsFilter
  setDetailsFilter: (filter: ChatDetailsFilter) => void
  canExport: boolean
  exportOpen: boolean
  exporting: ChatExportFormat | null
  exportPreset: ChatExportPreset
  exportMessage: string | null
  exportError: string | null
  selectedExportPreset: (typeof CHAT_EXPORT_PRESETS)[number]
  exportMenuRef: RefObject<HTMLDivElement>
  onToggleExport: () => void
  onExportPreset: (preset: ChatExportPreset) => void
  onExport: (format: ChatExportFormat) => void
  onResume: () => void
}) {
  return (
    <>
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

function splitTokens(value: number): { whole: string; decimals: string | null } {
  if (value >= 1000) {
    const k = value / 1000
    const whole = Math.floor(k).toString()
    const dec = k - Math.floor(k)
    return { whole, decimals: dec > 0 ? `.${Math.round(dec * 10)}k` : 'k' }
  }
  return { whole: fmt(value), decimals: null }
}

function splitCost(value: number): { whole: string; decimals: string | null } {
  const fixed = value.toFixed(2)
  const [whole, dec] = fixed.split('.')
  return { whole: `$${whole}`, decimals: `.${dec}` }
}

function ChatSessionHeader({
  title,
  session,
  primaryModel,
  totalMessages,
  totalToolCalls,
  toolSummary,
  memoryToolCalls,
  startedAt,
  endedAt,
  collapsed,
}: {
  title: string
  session: SessionSummary
  primaryModel: string | null
  totalMessages: number
  totalToolCalls: number
  toolSummary: [string, number][]
  memoryToolCalls: number
  startedAt: string | null
  endedAt: string | null
  collapsed: boolean
}) {
  const tokens = splitTokens(session.totalTokens)
  const cost = splitCost(session.estimatedCost)

  return (
    <div className={`cl-chat-collapsible${collapsed ? ' is-collapsed' : ''}`}>
      <section className="cl-chat-hero">
        <div className="cl-chat-hero-text">
          <div className="cl-eyebrow cl-chat-eyebrow">
            <span className="pip" />
            <span>Session · {fmtDate(session.date)}</span>
          </div>
          <h1>
            {title}
            <span className="cl-chat-h1-dot">.</span>
          </h1>
          <div className="cl-chat-submeta">
            <span className="cl-chat-file">{session.filename}</span>
            {primaryModel && (
              <>
                <span className="sep">·</span>
                <span className="cl-chat-model">
                  <span className="led" style={{ background: modelColor(primaryModel) }} />
                  <b>{fmtModel(primaryModel)}</b>
                </span>
              </>
            )}
            {startedAt && (
              <>
                <span className="sep">·</span>
                <span>started <b>{startedAt}</b></span>
              </>
            )}
            {endedAt && endedAt !== startedAt && (
              <>
                <span className="sep">·</span>
                <span>ended <b>{endedAt}</b></span>
              </>
            )}
          </div>
        </div>
        <div className="cl-lens-cluster" aria-hidden>
          <span className="orb-big" />
          <span className="orb-mid" />
          <span className="orb-sm" />
        </div>
      </section>

      <section className="cl-chat-stats">
        <div className="cl-chat-stat">
          <div className="l">Messages</div>
          <div className="n">{fmt(totalMessages)}</div>
        </div>
        <div className="cl-chat-stat">
          <div className="l">Tokens</div>
          <div className="n">{tokens.whole}{tokens.decimals && <small>{tokens.decimals}</small>}</div>
        </div>
        <div className="cl-chat-stat">
          <div className="l">Tools</div>
          <div className="n">{fmt(totalToolCalls)}</div>
        </div>
        <div className="cl-chat-stat is-dark">
          <div className="l">Cost</div>
          <div className="n">{cost.whole}{cost.decimals && <small>{cost.decimals}</small>}</div>
        </div>
      </section>

      <div className="cl-chat-toolstrip">
        <div className="cl-chat-io">
          <span>Input <b>{fmt(session.inputTokens)}</b></span>
          <span className="sep">/</span>
          <span>Output <b>{fmt(session.outputTokens)}</b></span>
          <span className="sep">/</span>
          <span>Cache <b>{fmt(session.cacheReadTokens)}</b></span>
        </div>
        {toolSummary.length > 0 ? (
          <div className="cl-chat-tool-chips">
            {toolSummary.slice(0, 6).map(([name, count]) => (
              <span
                key={name}
                className="cl-tk"
                style={{ '--tk-tint': TOOL_TINT[name] ?? 'var(--cl-ink-3)' } as CSSProperties}
              >
                <span className="d" />
                <b>{count}</b> {name}
              </span>
            ))}
            {memoryToolCalls > 0 && (
              <span className="cl-tk" style={{ '--tk-tint': 'var(--cl-violet)' } as CSSProperties}>
                <span className="d" />
                <b>{memoryToolCalls}</b> Memory
              </span>
            )}
          </div>
        ) : (
          <div className="cl-chat-tool-chips is-empty">No tool calls</div>
        )}
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
  const { data: messages, isLoading } = useChatSession(project.hash, session.filename)
  const projectName = project.realPath.split('/').pop() ?? project.realPath
  const [detailsFilter, setDetailsFilter] = useState<ChatDetailsFilter>('minimal')
  const [selectedTool, setSelectedTool] = useState<ToolGroup | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPreset, setExportPreset] = useState<ChatExportPreset>('team')
  const [exporting, setExporting] = useState<ChatExportFormat | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)

  const processed = messages ? buildProcessedMessages(messages) : []
  const canExport = processed.length > 0 && !isLoading

  const realUserCount = processed.filter(p => p.msg.role === 'user').length
  const realAssistantCount = processed.filter(p => p.msg.role === 'assistant').length
  const totalMessages = realUserCount + realAssistantCount

  const toolCounts = processed.reduce((acc, p) => {
    for (const g of p.toolGroups) {
      acc[g.use.name] = (acc[g.use.name] ?? 0) + 1
      if (isMemoryFile(g.use.input as Record<string, unknown>)) {
        acc['_memory'] = (acc['_memory'] ?? 0) + 1
      }
    }
    return acc
  }, {} as Record<string, number>)
  const toolSummary = Object.entries(toolCounts)
    .filter(([k]) => k !== '_memory')
    .sort((a, b) => b[1] - a[1])
  const totalToolCalls = toolSummary.reduce((s, [, c]) => s + c, 0)
  const memoryToolCalls = toolCounts['_memory'] ?? 0

  const title = sessionTitle(session)
  const primaryModel = session.models ? Object.keys(session.models).filter(k => k !== '<synthetic>')[0] ?? null : null
  const selectedExportPreset = CHAT_EXPORT_PRESETS.find(p => p.value === exportPreset) ?? CHAT_EXPORT_PRESETS[0]

  const fmtTime = (ts: string | undefined) => ts
    ? new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null
  const startedAt = fmtTime(processed[0]?.msg.timestamp)
  const endedAt = fmtTime(processed[processed.length - 1]?.msg.timestamp)

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
      ) : (
        <div className="cl-chat-workspace">
          <main
            className="cl-chat-feed"
            onScroll={e => {
              const top = (e.target as HTMLElement).scrollTop
              // hysteresis: collapse at 220px, expand back only under 80px — evita flicker
              const next = headerCollapsed ? top > 80 : top > 220
              if (next !== headerCollapsed) setHeaderCollapsed(next)
            }}
          >
            <ChatSessionHeader
              title={title}
              session={session}
              primaryModel={primaryModel}
              totalMessages={totalMessages}
              totalToolCalls={totalToolCalls}
              toolSummary={toolSummary}
              memoryToolCalls={memoryToolCalls}
              startedAt={startedAt}
              endedAt={endedAt}
              collapsed={headerCollapsed}
            />

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
              <div className="cl-transcript-inner">
                {processed.map((p, idx) => (
                  <MessageBubble
                    key={p.msg.uuid}
                    processed={p}
                    detailsFilter={detailsFilter}
                    onOpenToolDetail={setSelectedTool}
                    turnIndex={idx + 1}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
