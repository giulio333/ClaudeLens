import { useState } from 'react'
import { useChatSession } from '../../../hooks/useIPC'
import { SessionSummary } from '../../../hooks/useIPC'
import { fmt, fmtDate } from '../utils'
import { ModelUsageBadge } from '../shared/ModelChip'
import { StatChip } from '../shared/StatChip'
import { BackButton } from '../shared/BackButton'
import { buildProcessedMessages, isMemoryFile, TOOL_ICON, ChatDetailsFilter, ToolGroup } from './utils'
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

  const toolCounts = processed.reduce((acc, p) => {
    for (const g of p.toolGroups) {
      acc[g.use.name] = (acc[g.use.name] ?? 0) + 1
      if (isMemoryFile(g.use.input as Record<string, unknown>)) {
        acc['_memory'] = (acc['_memory'] ?? 0) + 1
      }
    }
    return acc
  }, {} as Record<string, number>)
  const toolSummary = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])

  const filterOptions: Array<{ value: ChatDetailsFilter; label: string; description: string }> = [
    { value: 'minimal', label: 'Minimal', description: 'Main messages only' },
    { value: 'all', label: 'Full', description: 'Everything: tools, thinking and detail panels' },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 bg-[var(--cl-paper-3)]/95 backdrop-blur-sm border-b border-[var(--cl-line)] px-8 pt-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <BackButton label="Sessions" onClick={onBack} />
            <span className="text-[var(--cl-ink-2)]">·</span>
            <span className="text-[13px] font-medium text-[var(--cl-ink-3)]">{projectName}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.electronAPI.sessions.openInTerminal(project.realPath, session.filename.replace('.jsonl', ''))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--cl-accent)] hover:bg-[var(--cl-accent)] text-white text-[12px] font-medium transition-colors"
              title="Resume this session in Claude"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Resume in Claude
            </button>
            <div className="flex items-center gap-1 bg-[var(--cl-paper-2)] rounded-lg border border-[var(--cl-line)] p-0.5">
            {filterOptions.map(option => (
              <button
                key={option.value}
                onClick={() => setDetailsFilter(option.value)}
                className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                  detailsFilter === option.value
                    ? 'bg-[var(--cl-accent-soft)] text-[var(--cl-accent-ink)]'
                    : 'text-[var(--cl-ink-3)] hover:text-[var(--cl-ink-3)] hover:bg-[var(--cl-paper-3)]'
                }`}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
            </div>
          </div>
        </div>

        <div className="flex items-start justify-between mb-3">
          <div>
            <h1 className="text-[16px] font-semibold text-[var(--cl-ink)] leading-tight">{session.customTitle || fmtDate(session.date)}</h1>
            <span className="text-[11px] text-[var(--cl-ink-3)] font-mono mt-0.5 block">{session.filename}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <StatChip label="Messages" value={String(realUserCount + realAssistantCount)} />
            <StatChip label="Tokens" value={fmt(session.totalTokens)} />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--cl-line)] py-2.5 gap-4">
          <ModelUsageBadge models={session.models} />

          {toolSummary.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto shrink-0">
              {toolSummary.map(([name, count]) => {
                if (name === '_memory') return (
                  <div key={name} className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--cl-paper-3)] border border-[var(--cl-violet)] text-[11px] whitespace-nowrap">
                    <span className="text-[11px]">🧠</span>
                    <span className="font-medium text-[var(--cl-violet)]">Memory</span>
                    <span className="text-[var(--cl-violet)] font-mono text-[10px]">×{count}</span>
                  </div>
                )
                return (
                  <div
                    key={name}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--cl-paper-2)] border border-[var(--cl-line)] text-[11px] whitespace-nowrap hover:border-[var(--cl-line)] transition-colors"
                  >
                    <span className="text-[11px]">{TOOL_ICON[name] ?? '🔧'}</span>
                    <span className="font-medium text-[var(--cl-ink-3)]">{name}</span>
                    <span className="text-[var(--cl-ink-3)] font-mono text-[10px]">×{count}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {selectedTool ? (
        <ToolDetailPanel group={selectedTool} onBack={() => setSelectedTool(null)} />
      ) : (
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading && <p className="text-sm text-[var(--cl-ink-3)]">Loading chat...</p>}
          {messages?.length === 0 && !isLoading && (
            <p className="text-sm text-[var(--cl-ink-3)] italic">No messages found in this session.</p>
          )}
          {processed.length > 0 && (
            <div className="max-w-4xl mx-auto space-y-5">
              {processed.map(p => (
                <MessageBubble
                  key={p.msg.uuid}
                  processed={p}
                  detailsFilter={detailsFilter}
                  onOpenToolDetail={setSelectedTool}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
