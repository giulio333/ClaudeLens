import { useState } from 'react'
import { useChatSession } from '../../../hooks/useIPC'
import { SessionSummary } from '../../../hooks/useIPC'
import { fmt, fmtDate, fmtModel, modelColor } from '../utils'
import { buildProcessedMessages, isMemoryFile, ChatDetailsFilter, ToolGroup } from './utils'
import { ToolDetailPanel } from './ToolDetailPanel'
import { MessageBubble } from './MessageBubble'

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

  const sessionTitle = session.customTitle || fmtDate(session.date)
  const primaryModel = session.models ? Object.keys(session.models).filter(k => k !== '<synthetic>')[0] ?? null : null

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>

      {/* ── BREADCRUMB BAR ── */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        height: '38px',
        padding: '0 28px',
        background: 'var(--cl-paper-2)',
        borderBottom: '1px solid var(--cl-line)',
        gap: 0,
        flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{
            fontFamily: 'var(--cl-mono)',
            fontSize: '10.5px',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--cl-ink-4)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 14px 0 0',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {projectName} · Sessions
        </button>
        <span style={{
          fontFamily: 'var(--cl-mono)',
          fontSize: '10.5px',
          color: 'var(--cl-ink-4)',
          opacity: 0.4,
          marginRight: '14px',
        }}>/</span>
        <span style={{
          fontFamily: 'var(--cl-mono)',
          fontSize: '10.5px',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--cl-ink)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {sessionTitle}
        </span>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
          {/* Toggle Minimal / Full */}
          <div style={{
            display: 'inline-flex',
            border: '1px solid var(--cl-line)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}>
            {(['minimal', 'all'] as ChatDetailsFilter[]).map(v => (
              <button
                key={v}
                onClick={() => setDetailsFilter(v)}
                style={{
                  background: detailsFilter === v ? 'var(--cl-ink)' : 'transparent',
                  color: detailsFilter === v ? 'var(--cl-paper)' : 'var(--cl-ink-3)',
                  border: 'none',
                  padding: '4px 10px',
                  fontFamily: 'var(--cl-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                {v === 'minimal' ? 'Minimal' : 'Full'}
              </button>
            ))}
          </div>

          {/* Resume button */}
          <button
            onClick={() => window.electronAPI.sessions.openInTerminal(project.realPath, session.filename.replace('.jsonl', ''))}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              background: 'var(--cl-ink)',
              color: 'var(--cl-paper)',
              border: 'none',
              borderRadius: '2px',
              fontFamily: 'var(--cl-sans)',
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.01em',
              cursor: 'pointer',
            }}
          >
            <span style={{
              width: '8px',
              height: '8px',
              background: 'var(--cl-accent)',
              clipPath: 'polygon(0 0, 100% 50%, 0 100%)',
              display: 'inline-block',
              flexShrink: 0,
            }} />
            Resume in Claude
          </button>
        </div>
      </nav>

      {/* ── HERO SECTION ── */}
      <header style={{
        padding: '24px 28px 20px',
        borderBottom: '1.5px solid var(--cl-ink)',
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '32px',
        alignItems: 'end',
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--cl-mono)',
            fontSize: '10px',
            letterSpacing: '0.20em',
            textTransform: 'uppercase',
            color: 'var(--cl-ink-3)',
            marginBottom: '10px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--cl-accent)',
              display: 'inline-block',
            }} />
            Session · {fmtDate(session.date)}
          </div>
          <h1 style={{
            fontSize: '28px',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            lineHeight: 1.1,
            color: 'var(--cl-ink)',
            marginBottom: '10px',
          }}>
            {sessionTitle}
          </h1>
          <div style={{
            fontFamily: 'var(--cl-mono)',
            fontSize: '11px',
            color: 'var(--cl-ink-3)',
          }}>
            {session.filename}
            {primaryModel && (
              <span style={{ color: modelColor(primaryModel), marginLeft: '12px' }}>
                {fmtModel(primaryModel)}
              </span>
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
                fontFamily: 'var(--cl-mono)',
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
            fontFamily: 'var(--cl-mono)',
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
                fontFamily: 'var(--cl-mono)',
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
              fontFamily: 'var(--cl-mono)',
              fontSize: '11px',
              color: 'var(--cl-ink-3)',
              padding: '32px 28px',
            }}>
              Loading transcript…
            </p>
          )}
          {messages?.length === 0 && !isLoading && (
            <p style={{
              fontFamily: 'var(--cl-mono)',
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
