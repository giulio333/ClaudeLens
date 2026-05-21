import { useState } from 'react'
import { McpData } from '../../../hooks/useIPC'

export function mcpServiceColor(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('google') || n.includes('calendar') || n.includes('gmail')) return '#4285f4'
  if (n.includes('atlassian') || n.includes('jira') || n.includes('confluence')) return '#0052cc'
  if (n.includes('notion')) return 'var(--cl-ink)'
  if (n.includes('figma')) return 'var(--cl-violet)'
  if (n.includes('canva')) return 'var(--cl-cyan)'
  if (n.includes('mermaid')) return 'var(--cl-danger)'
  if (n.includes('slack')) return '#4a154b'
  if (n.includes('github')) return 'var(--cl-ink)'
  if (n.includes('linear')) return 'var(--cl-accent)'
  return 'var(--cl-cyan)'
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
    <div className="rounded-xl border border-[var(--cl-paper-3)] bg-[var(--cl-paper)] overflow-hidden">
      <div
        className="flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-[var(--cl-paper)] transition-colors"
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
            <p className="text-[13px] font-medium text-[var(--cl-ink-2)] truncate">{displayName}</p>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              fullyEnabled ? 'bg-[var(--cl-ok)]' : fullyDisabled ? 'bg-[var(--cl-danger)]' : 'bg-[var(--cl-warn)]'
            }`} />
          </div>

          {totalProjects > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1 rounded-full bg-[var(--cl-paper-3)] overflow-hidden max-w-[80px]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(server.enabledInProjects / totalProjects) * 100}%`,
                    background: fullyEnabled ? 'var(--cl-ok)' : partial ? 'var(--cl-warn)' : 'var(--cl-danger)',
                  }}
                />
              </div>
              <span className="text-[10px] text-[var(--cl-ink-4)] tabular-nums">
                {server.enabledInProjects}/{totalProjects} projects
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            server.source === 'cloud'
              ? 'bg-[var(--cl-paper-3)] text-[var(--cl-cyan)] ring-1 ring-[var(--cl-cyan)]'
              : 'bg-[var(--cl-warn-soft)] text-[var(--cl-warn)] ring-1 ring-[var(--cl-warn)]'
          }`}>
            {server.source === 'cloud' ? 'cloud' : 'local'}
          </span>
          {hasDisabledProjects && (
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
            >
              <path d="M2 3.5l3 3 3-3" stroke="var(--cl-ink-4)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      </div>

      {expanded && hasDisabledProjects && (
        <div className="border-t border-[var(--cl-paper-3)] px-3 py-2 space-y-1">
          <p className="text-[10px] font-semibold text-[var(--cl-ink-4)] uppercase tracking-wider mb-1.5">Disabled in</p>
          {server.disabledProjectPaths.map(p => (
            <div key={p} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--cl-danger)] shrink-0" />
              <span className="text-[11px] text-[var(--cl-ink-4)] truncate" title={p}>
                {p.split('/').pop() ?? p}
              </span>
            </div>
          ))}
        </div>
      )}

      {server.source === 'local' && server.command && (
        <div className="border-t border-[var(--cl-paper-3)] px-3 py-2">
          <p className="text-[11px] font-mono text-[var(--cl-ink-4)] truncate">
            {server.command}{server.args?.length ? ' ' + server.args.join(' ') : ''}
          </p>
        </div>
      )}
    </div>
  )
}
