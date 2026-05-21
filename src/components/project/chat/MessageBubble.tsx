import { useState } from 'react'
import Markdown from '../../Markdown'
import { ChatContentBlock } from '../../../hooks/useIPC'
import { ProcessedMessage, ToolGroup, ChatDetailsFilter } from './utils'
import { ToolGroupCard } from './ToolGroupCard'

export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false)
  if (!thinking) return null
  return (
    <div style={{
      margin: '4px 0',
      border: '1px solid var(--cl-violet)',
      borderRadius: '2px',
      fontSize: '11px',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 10px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9.5px',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--cl-violet)',
          fontWeight: 500,
        }}>thinking</span>
        <span style={{ marginLeft: 'auto', color: 'var(--cl-violet)', fontSize: '9px' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div style={{
          padding: '8px 10px 10px',
          borderTop: '1px solid var(--cl-violet)',
        }}>
          <p style={{
            fontSize: '11px',
            color: 'var(--cl-violet)',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--font-mono)',
          }}>
            {thinking}
          </p>
        </div>
      )}
    </div>
  )
}

export function MessageBubble({ processed, detailsFilter, onOpenToolDetail, turnIndex }: {
  processed: ProcessedMessage
  detailsFilter: ChatDetailsFilter
  onOpenToolDetail: (group: ToolGroup) => void
  turnIndex?: number
}) {
  const { msg, toolGroups } = processed
  const isUser = msg.role === 'user'

  const textBlocks = msg.content.filter(b => b.type === 'text') as Extract<ChatContentBlock, { type: 'text' }>[]
  const thinkingBlocks = msg.content.filter(b => b.type === 'thinking') as Extract<ChatContentBlock, { type: 'thinking' }>[]

  const showThinking = detailsFilter === 'all'
  const showTools = detailsFilter === 'all'
  const showToolDetails = detailsFilter === 'all'

  const hasVisibleContent =
    textBlocks.length > 0 ||
    (showThinking && thinkingBlocks.some(b => b.thinking)) ||
    (showTools && toolGroups.length > 0)
  if (!hasVisibleContent) return null

  const timestamp = new Date(msg.timestamp).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '64px 1fr',
      gap: '0',
      borderBottom: '1px solid var(--cl-line)',
      alignItems: 'start',
    }}>
      {/* ── Role column ── */}
      <div style={{
        background: isUser ? 'var(--cl-accent)' : 'var(--cl-ink)',
        color: isUser ? 'white' : 'var(--cl-paper)',
        padding: '16px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        alignSelf: 'stretch',
        borderRight: '1px solid var(--cl-line)',
      }}>
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '22px',
          fontWeight: 700,
          letterSpacing: '-0.025em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          opacity: isUser ? 1 : 0.9,
        }}>
          {turnIndex !== undefined ? String(turnIndex).padStart(2, '0') : (isUser ? 'U' : 'C')}
        </div>
        <div style={{
          width: '10px',
          height: '10px',
          border: isUser ? '2px solid rgba(255,255,255,0.5)' : '2px solid rgba(255,255,255,0.25)',
          borderRadius: '2px',
          opacity: 0.45,
        }} />
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          letterSpacing: '0.20em',
          fontWeight: 600,
          opacity: 0.85,
          textTransform: 'uppercase',
        }}>
          {isUser ? 'User' : 'Claude'}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9.5px',
          opacity: 0.65,
          letterSpacing: '0.02em',
          marginTop: '2px',
        }}>
          {timestamp}
        </div>
      </div>

      {/* ── Content column ── */}
      <div style={{ padding: '20px 28px' }}>
        {showThinking && thinkingBlocks.map((b, i) => (
          <ThinkingBlock key={i} thinking={b.thinking} />
        ))}

        {textBlocks.map((b, i) => (
          <div key={i}>
            {isUser ? (
              <p style={{
                fontSize: '15px',
                lineHeight: 1.6,
                color: 'var(--cl-ink)',
                fontWeight: 500,
                whiteSpace: 'pre-wrap',
                paddingLeft: '12px',
                borderLeft: '2px solid var(--cl-accent)',
              }}>
                {b.text}
              </p>
            ) : (
              <div
                className="prose prose-sm prose-zinc prose-lens max-w-none"
                style={{
                  fontSize: '15px',
                  lineHeight: 1.65,
                  color: 'var(--cl-ink-2)',
                  paddingLeft: '12px',
                  borderLeft: '1px solid var(--cl-line)',
                }}
              >
                <Markdown>{b.text}</Markdown>
              </div>
            )}
          </div>
        ))}

        {showTools && toolGroups.length > 0 && (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {toolGroups.map((group, i) => (
              <ToolGroupCard
                key={i}
                group={group}
                showDetails={showToolDetails}
                onOpenDetail={() => onOpenToolDetail(group)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
