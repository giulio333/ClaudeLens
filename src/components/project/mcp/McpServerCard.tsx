import { useState } from 'react'
import { McpData } from '../../../hooks/useIPC'

export function mcpServiceColor(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('google') || n.includes('calendar') || n.includes('gmail')) return '#4285f4'
  if (n.includes('atlassian') || n.includes('jira') || n.includes('confluence')) return '#0052cc'
  if (n.includes('notion')) return '#e0e0e0'
  if (n.includes('figma')) return '#a259ff'
  if (n.includes('canva')) return '#00c4cc'
  if (n.includes('mermaid')) return '#ff3670'
  if (n.includes('slack')) return '#4a154b'
  if (n.includes('github')) return '#e0e0e0'
  if (n.includes('linear')) return '#5e6ad2'
  return '#22d3ee'
}

export function McpServerCard({
  server,
  totalProjects,
}: {
  server: McpData['cloudServers'][number]
  totalProjects: number
}) {
  const [expanded, setExpanded] = useState(false)
  const displayName = server.name.replace(/^claude\.ai\s*/i, '')
  const color = mcpServiceColor(server.name)
  const initial = displayName.trim()[0]?.toUpperCase() ?? '?'
  const fullyEnabled = server.disabledInProjects === 0
  const fullyDisabled = server.enabledInProjects === 0
  const partial = !fullyEnabled && !fullyDisabled
  const hasDisabledProjects = server.disabledProjectPaths.length > 0

  return (
    <div className="rounded-xl border border-[#1e2336] bg-[#111420] overflow-hidden">
      <div
        className="flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-[#131827] transition-colors"
        onClick={() => hasDisabledProjects && setExpanded(e => !e)}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-bold shrink-0"
          style={{ background: `${color}18`, border: `1px solid ${color}30`, color }}
        >
          {initial}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-[#c4c8e0] truncate">{displayName}</p>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              fullyEnabled ? 'bg-emerald-500' : fullyDisabled ? 'bg-red-500' : 'bg-amber-500'
            }`} />
          </div>

          {totalProjects > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1 rounded-full bg-[#1e2336] overflow-hidden max-w-[80px]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(server.enabledInProjects / totalProjects) * 100}%`,
                    background: fullyEnabled ? '#10b981' : partial ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <span className="text-[10px] text-[#555c75] tabular-nums">
                {server.enabledInProjects}/{totalProjects} projects
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            server.source === 'cloud'
              ? 'bg-cyan-950/40 text-cyan-400 ring-1 ring-cyan-700/30'
              : 'bg-amber-950/40 text-amber-400 ring-1 ring-amber-700/30'
          }`}>
            {server.source === 'cloud' ? 'cloud' : 'local'}
          </span>
          {hasDisabledProjects && (
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
            >
              <path d="M2 3.5l3 3 3-3" stroke="#555c75" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      </div>

      {expanded && hasDisabledProjects && (
        <div className="border-t border-[#1e2336] px-3 py-2 space-y-1">
          <p className="text-[10px] font-semibold text-[#3d4460] uppercase tracking-wider mb-1.5">Disabled in</p>
          {server.disabledProjectPaths.map(p => (
            <div key={p} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500/60 shrink-0" />
              <span className="text-[11px] text-[#555c75] truncate" title={p}>
                {p.split('/').pop() ?? p}
              </span>
            </div>
          ))}
        </div>
      )}

      {server.source === 'local' && server.command && (
        <div className="border-t border-[#1e2336] px-3 py-2">
          <p className="text-[11px] font-mono text-[#3d4460] truncate">
            {server.command}{server.args?.length ? ' ' + server.args.join(' ') : ''}
          </p>
        </div>
      )}
    </div>
  )
}
