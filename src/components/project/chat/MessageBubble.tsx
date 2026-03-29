import { useState } from 'react'
import Markdown from '../../Markdown'
import { ChatContentBlock } from '../../../hooks/useIPC'
import { ProcessedMessage, ToolGroup, ChatDetailsFilter } from './utils'
import { ToolGroupCard } from './ToolGroupCard'

export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false)
  if (!thinking) return null
  return (
    <div className="my-1 rounded-lg border border-violet-700/40 bg-violet-950/20/50 text-[12px] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-violet-950/20 transition-colors text-left"
      >
        <span className="text-violet-500 font-medium">thinking</span>
        <span className="ml-auto text-violet-400 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-violet-700/40">
          <p className="text-[11px] text-violet-400 mt-2 leading-relaxed whitespace-pre-wrap">{thinking}</p>
        </div>
      )}
    </div>
  )
}

export function MessageBubble({ processed, detailsFilter, onOpenToolDetail }: {
  processed: ProcessedMessage
  detailsFilter: ChatDetailsFilter
  onOpenToolDetail: (group: ToolGroup) => void
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

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold mt-0.5 ${
        isUser ? 'bg-indigo-100 text-indigo-400' : 'bg-[#1c2133] text-zinc-500'
      }`}>
        {isUser ? 'U' : 'C'}
      </div>

      <div className={`flex-1 min-w-0 max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1.5`}>
        {showThinking && thinkingBlocks.map((b, i) => (
          <div key={i} className="w-full"><ThinkingBlock thinking={b.thinking} /></div>
        ))}

        {textBlocks.map((b, i) => (
          <div
            key={i}
            className={`w-full rounded-xl px-4 py-3 text-[13px] leading-relaxed ${
              isUser
                ? 'bg-indigo-600 text-white'
                : 'bg-[#161a26] border border-[#252836] text-[#c4c8e0]'
            }`}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{b.text}</p>
            ) : (
              <div className="prose prose-sm prose-zinc prose-lens max-w-none">
                <Markdown>{b.text}</Markdown>
              </div>
            )}
          </div>
        ))}

        {showTools && toolGroups.length > 0 && (
          <div className="w-full space-y-1.5 pl-1">
            {toolGroups.map((group, i) => (
              <ToolGroupCard key={i} group={group} showDetails={showToolDetails} onOpenDetail={() => onOpenToolDetail(group)} />
            ))}
          </div>
        )}

        <span className="text-[10px] text-zinc-400 px-1">
          {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}
