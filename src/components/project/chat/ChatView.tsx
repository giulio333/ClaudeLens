import { useState } from 'react'
import { useChatSession } from '../../../hooks/useIPC'
import { SessionSummary } from '../../../hooks/useIPC'
import { fmt, fmtDate, fmtModel, modelColor, sessionTitle } from '../utils'
import { buildProcessedMessages, isMemoryFile, ChatDetailsFilter, ToolGroup } from './utils'
import { ToolDetailPanel } from './ToolDetailPanel'
import { MessageBubble } from './MessageBubble'
import { TopBar } from '../shared/TopBar'

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

  const processed = messages ? buildProcessedMessages(messages) : []

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

  const title = sessionTitle(session)
  const primaryModel = session.models ? Object.keys(session.models).filter(k => k !== '<synthetic>')[0] ?? null : null

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>

      {/* ── TOP BAR ── */}
      <TopBar
        onBack={onBack}
        backLabel={`${projectName} · Sessions`}
        crumbs={[{ label: title, accent: true }]}
        right={
          <>
            <div className="cl-seg">
              {(['minimal', 'all'] as ChatDetailsFilter[]).map(v => (
                <button
                  key={v}
                  className={detailsFilter === v ? 'on' : ''}
                  onClick={() => setDetailsFilter(v)}
                >
                  {v === 'minimal' ? 'Minimal' : 'Full'}
                </button>
              ))}
            </div>
            <button
              className="cl-resume"
              onClick={() => window.electronAPI.sessions.openInTerminal(project.realPath, session.filename.replace('.jsonl', ''))}
            >
              <span className="play" />
              Resume in Claude
            </button>
          </>
        }
      />

      {/* ── HERO SECTION ── */}
      <header style={{
        padding: '28px 28px 22px',
        borderBottom: '1.5px solid var(--cl-ink)',
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '32px',
        alignItems: 'end',
      }}>
        <div style={{ minWidth: 0 }}>
          <div className="cl-eyebrow" style={{ marginBottom: '14px' }}>
            <span className="pip" />
            <span>Session · {fmtDate(session.date)}</span>
          </div>
          <h1 style={{
            fontSize: '30px',
            fontWeight: 600,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            color: 'var(--cl-ink)',
            marginBottom: '12px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </h1>
          <div className="cl-h-meta" style={{ marginTop: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--cl-ink-3)' }}>{session.filename}</span>
            {primaryModel && (
              <>
                <span className="sep">·</span>
                <span className="tag">
                  <span className="led" style={{ background: modelColor(primaryModel) }} />
                  {fmtModel(primaryModel)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Stat grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0',
          borderTop: '1.5px solid var(--cl-ink)',
          borderBottom: '1px solid var(--cl-line)',
          alignSelf: 'end',
          minWidth: '260px',
        }}>
          {[
            { label: 'Messages', value: String(totalMessages) },
            { label: 'Tokens', value: fmt(session.totalTokens) },
            { label: 'Tools', value: String(totalToolCalls) },
          ].map(({ label, value }, i) => (
            <div key={label} style={{
              padding: '12px 0',
              borderLeft: i > 0 ? '1px solid var(--cl-line)' : 'none',
              paddingLeft: i > 0 ? '14px' : '0',
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9.5px',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--cl-ink-3)',
              }}>
                {label}
              </div>
              <div style={{
                fontSize: '22px',
                fontWeight: 600,
                letterSpacing: '-0.03em',
                lineHeight: 1,
                marginTop: '6px',
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--cl-ink)',
              }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </header>

      {/* ── TOOL ORBIT STRIP ── */}
      {toolSummary.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 28px',
          background: 'var(--cl-paper-2)',
          borderBottom: '1px solid var(--cl-line)',
          gap: '24px',
          overflowX: 'auto',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9.5px',
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: 'var(--cl-ink-3)',
            whiteSpace: 'nowrap',
          }}>
            /// Tools
          </span>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'nowrap' }}>
            {toolSummary.map(([name, count], i) => (
              <span key={name} style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--cl-ink-2)',
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: '6px',
                whiteSpace: 'nowrap',
                position: 'relative',
              }}>
                {i > 0 && (
                  <span style={{
                    position: 'absolute',
                    left: '-12px',
                    top: '6px',
                    width: '3px',
                    height: '3px',
                    background: 'var(--cl-accent)',
                    borderRadius: '50%',
                  }} />
                )}
                <b style={{ fontWeight: 600, fontSize: '13px', color: 'var(--cl-ink)' }}>×{count}</b>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── TRANSCRIPT ── */}
      {selectedTool ? (
        <ToolDetailPanel group={selectedTool} onBack={() => setSelectedTool(null)} />
      ) : (
        <div style={{
          flex: 1,
          overflowY: 'auto',
          background: 'var(--cl-paper)',
        }}>
          {isLoading && (
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--cl-ink-3)',
              padding: '32px 28px',
            }}>
              Loading transcript…
            </p>
          )}
          {messages?.length === 0 && !isLoading && (
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--cl-ink-3)',
              fontStyle: 'italic',
              padding: '32px 28px',
            }}>
              No messages found in this session.
            </p>
          )}

          {processed.length > 0 && (
            <div style={{ maxWidth: '900px', margin: '0 auto' }}>
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
        </div>
      )}
    </div>
  )
}
