// claudelens-app/src/tabs/live/ProjectContextPanel.tsx
import type { ReactNode } from 'react'
import { UsedItem } from './types'

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[7px] font-bold tracking-[0.22em] uppercase mb-1.5 mt-3 first:mt-0" style={{ color: '#2e3650' }}>
      {children}
    </div>
  )
}

function UsedItemRow({ item }: { item: UsedItem }) {
  const isRunning = item.status === 'running'
  const color = item.category === 'mcp'
    ? (isRunning ? '#22d858' : 'rgba(34,216,88,0.4)')
    : (isRunning ? '#a855f7' : 'rgba(168,85,247,0.4)')
  const icon = item.category === 'mcp' ? '⬢' : '⬡'

  return (
    <div
      className="flex items-start gap-2 py-1.5 border-b"
      style={{ borderColor: 'rgba(255,255,255,0.04)' }}
    >
      <span className="text-[10px] shrink-0 mt-px" style={{ color, animation: isRunning ? 'dotPulse 1.5s ease-in-out infinite' : undefined }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[9.5px] font-bold truncate" style={{ color }}>{item.label}</span>
          {item.duration !== undefined && (
            <span className="text-[7.5px] tabular-nums shrink-0" style={{ color: '#2e3650' }}>{item.duration}ms</span>
          )}
        </div>
        {item.server && (
          <div className="text-[7.5px] truncate mt-0.5" style={{ color: '#3d4460' }}>{item.server}</div>
        )}
      </div>
    </div>
  )
}

export function ProjectContextPanel({ usedItems }: { usedItems: UsedItem[] }) {
  const mcpItems   = usedItems.filter(i => i.category === 'mcp')
  const agentItems = usedItems.filter(i => i.category === 'agent')

  if (usedItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
        <span className="text-[10px]" style={{ color: '#2e3650' }}>No agents or MCP</span>
        <span className="text-[8.5px]" style={{ color: '#2e3650', opacity: 0.6 }}>will appear here when Claude uses one</span>
      </div>
    )
  }

  return (
    <div className="px-3 py-3 text-[9.5px]">
      {agentItems.length > 0 && (
        <>
          <SectionLabel>Agents</SectionLabel>
          {agentItems.map(item => <UsedItemRow key={item.id} item={item} />)}
        </>
      )}
      {mcpItems.length > 0 && (
        <>
          <SectionLabel>MCP Calls</SectionLabel>
          {mcpItems.map(item => <UsedItemRow key={item.id} item={item} />)}
        </>
      )}
    </div>
  )
}
