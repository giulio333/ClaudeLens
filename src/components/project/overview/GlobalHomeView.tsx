import { useState, useEffect } from 'react'
import { useGlobalSkills, useGlobalAgents, useGlobalMcp, useMemoryProjects, ClaudeProcess } from '../../../hooks/useIPC'
import { View } from '../types'
import { mcpServiceColor } from '../mcp/McpServerCard'

export function GlobalHomeView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { data: skills } = useGlobalSkills()
  const { data: agents } = useGlobalAgents()
  const { data: mcpData } = useGlobalMcp()

  const { data: allProjects = [] } = useMemoryProjects()

  const [activeProcesses, setActiveProcesses] = useState<ClaudeProcess[]>([])

  useEffect(() => {
    async function load() {
      try {
        const r = await window.electronAPI.live.getProcesses()
        if (r.data) setActiveProcesses(r.data)
      } catch { /* ignore */ }
    }
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const mcpCount = (mcpData?.cloudServers?.length ?? 0) + (mcpData?.localServers?.length ?? 0)
  const allServers = [...(mcpData?.cloudServers ?? []), ...(mcpData?.localServers ?? [])]

  return (
    <div className="h-full overflow-y-auto bg-[#0d0f14]">
      <div className="bg-[#0f1117] border-b border-[#1e2130]">
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-indigo-500/15 border border-indigo-500/25">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" stroke="#818cf8" strokeWidth="1.3"/>
                <circle cx="7" cy="7" r="2.5" fill="#818cf8"/>
              </svg>
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-[#e0e2f0] tracking-tight">Global</h1>
              <p className="text-[11px] text-[#3d4460] mt-0.5">Shared Claude Code configuration</p>
            </div>
          </div>
          <p className="text-[12px] text-[#555c75] leading-relaxed mt-3">
            Your global Claude Code context — instructions, skills, agents and integrations shared across all projects.
          </p>
        </div>
      </div>

      <div className="p-5 space-y-3">
        {/* ── Active Processes panel ── */}
        <div>
          <style>{`
            @keyframes ringPulse { 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:0;transform:scale(2.4)} }
            @keyframes dotPulse  { 0%,100%{opacity:1} 50%{opacity:.3} }
          `}</style>

          <div
            className="rounded-xl overflow-hidden border"
            style={{
              background: '#03040a',
              borderColor: 'rgba(0,229,255,0.1)',
              fontFamily: "'JetBrains Mono','Cascadia Code','Fira Code',monospace",
            }}
          >
            <div className="relative">
              {/* Grid background */}
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: 'linear-gradient(rgba(0,229,255,0.022) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.022) 1px,transparent 1px)',
                backgroundSize: '48px 48px',
              }} />

              {/* Header */}
              <div className="relative flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'rgba(0,229,255,0.08)' }}>
                <div className="relative w-2 h-2 shrink-0">
                  <div className="absolute inset-0 rounded-full" style={{
                    background: activeProcesses.length > 0 ? '#00e5ff' : '#2e3650',
                    animation: activeProcesses.length > 0 ? 'dotPulse 2s ease-in-out infinite' : undefined,
                  }} />
                  {activeProcesses.length > 0 && (
                    <div className="absolute inset-0 rounded-full" style={{
                      background: 'rgba(0,229,255,0.4)',
                      animation: 'ringPulse 2s ease-in-out infinite',
                    }} />
                  )}
                </div>
                <span className="text-[9px] font-bold tracking-[0.2em]" style={{ color: activeProcesses.length > 0 ? '#00e5ff' : '#2e3650' }}>
                  {activeProcesses.length > 0 ? 'LIVE' : 'IDLE'}
                </span>
                <span className="text-[9px] tracking-[0.15em] ml-1" style={{ color: '#2e3650' }}>ACTIVE PROCESSES</span>
                <div className="flex-1" />
                {activeProcesses.length > 0 && (
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: '#00e5ff' }}>{activeProcesses.length}</span>
                )}
              </div>

              {/* Body */}
              <div className="relative px-4 py-3" style={{ minHeight: 60 }}>
                {activeProcesses.length === 0 ? (
                  <div className="flex items-center gap-3 py-1">
                    <div className="w-2.5 h-2.5 rounded-full border shrink-0" style={{ borderColor: 'rgba(74,85,104,0.4)' }}>
                      <div className="w-full h-full rounded-full" style={{ background: 'rgba(74,85,104,0.2)' }} />
                    </div>
                    <span className="text-[10px]" style={{ color: '#2e3650' }}>No Claude processes running</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeProcesses.map(proc => {
                      const projectName = proc.cwd.split('/').filter(Boolean).pop() ?? proc.cwd
                      const shortCwd = '/' + proc.cwd.split('/').filter(Boolean).slice(-2).join('/')
                      const matchedProject = allProjects.find(p => p.realPath === proc.cwd)
                      const cmdSnippet = proc.cmdline.slice(0, 60)

                      const rowContent = (
                        <div className="flex items-start gap-3">
                          <div className="relative shrink-0 mt-1">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#22d858' }} />
                            <div className="absolute inset-0 rounded-full" style={{
                              background: 'rgba(34,216,88,0.4)', animation: 'ringPulse 2.5s ease-in-out infinite',
                            }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="text-[11px] font-bold" style={{ color: '#22d858' }}>PID {proc.pid}</span>
                              <span className="text-[10px] font-bold truncate" style={{ color: '#9096b0' }}>{projectName}</span>
                            </div>
                            <div className="text-[9px] truncate mt-0.5" style={{ color: '#3d4460' }}>{cmdSnippet}</div>
                          </div>
                          <span className="text-[9px] shrink-0 hidden sm:block" style={{ color: '#2e3650' }}>{shortCwd}</span>
                          {matchedProject && (
                            <svg className="w-2.5 h-2.5 shrink-0 mt-0.5" viewBox="0 0 12 12" fill="none" stroke="#2e3650" strokeWidth="1.5" strokeLinecap="round">
                              <path d="M4.5 2.5L9 6l-4.5 3.5"/>
                            </svg>
                          )}
                        </div>
                      )

                      if (matchedProject) {
                        return (
                          <button
                            key={proc.pid}
                            onClick={() => onNavigate({ type: 'live-monitor', project: matchedProject })}
                            className="w-full text-left rounded-lg px-2 py-1.5 transition-colors"
                            style={{ background: 'transparent' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,229,255,0.04)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            {rowContent}
                          </button>
                        )
                      }
                      return <div key={proc.pid} className="px-2 py-1.5">{rowContent}</div>
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="text-[10.5px] font-semibold text-[#3d4460] uppercase tracking-widest px-0.5">Configuration</p>
        <div className="rounded-xl border border-[#1e2130] bg-[#0f1117] overflow-hidden divide-y divide-[#1e2130]">

          {/* CLAUDE.md */}
          <button
            onClick={() => onNavigate({ type: 'global-claudemd' })}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#111520] transition-colors group"
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-blue-500/12 border border-blue-500/20">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#60a5fa" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 1.5h6l4 4v9H3v-13z"/>
                <path d="M9 1.5v4h4"/>
                <path d="M6 9h4M6 11.5h2.5"/>
              </svg>
            </div>
            <span className="flex-1 text-left text-[12.5px] font-medium text-[#9096b0] group-hover:text-[#c4c8e0] transition-colors">CLAUDE.md</span>
            <span className="text-[11px] text-[#555c75] tabular-nums">1 layer</span>
            <svg className="w-3 h-3 text-[#2a3050] group-hover:text-[#3d4460] transition-colors shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 2.5L9 6l-4.5 3.5"/></svg>
          </button>

          {/* Skills */}
          <button
            onClick={() => onNavigate({ type: 'global-skills' })}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#111520] transition-colors group"
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-violet-500/12 border border-violet-500/20">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#a78bfa" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 1.5L9.8 6.5H15L10.6 9.5L12.4 14.5L8 11.5L3.6 14.5L5.4 9.5L1 6.5H6.2Z" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="flex-1 text-left text-[12.5px] font-medium text-[#9096b0] group-hover:text-[#c4c8e0] transition-colors">Skills</span>
            <span className="text-[11px] text-[#555c75] tabular-nums">
              {skills?.length ? `${skills.length} skill${skills.length !== 1 ? 's' : ''}` : 'none'}
            </span>
            <svg className="w-3 h-3 text-[#2a3050] group-hover:text-[#3d4460] transition-colors shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 2.5L9 6l-4.5 3.5"/></svg>
          </button>

          {/* Agents */}
          <button
            onClick={() => onNavigate({ type: 'global-agents' })}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#111520] transition-colors group"
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-emerald-500/12 border border-emerald-500/20">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#34d399" strokeWidth="1.3" strokeLinecap="round">
                <rect x="2.5" y="5" width="9" height="7" rx="1.5"/>
                <path d="M5 5V3.5a2 2 0 014 0V5"/>
                <circle cx="5" cy="9" r="1" fill="#34d399" stroke="none"/>
                <circle cx="9" cy="9" r="1" fill="#34d399" stroke="none"/>
              </svg>
            </div>
            <span className="flex-1 text-left text-[12.5px] font-medium text-[#9096b0] group-hover:text-[#c4c8e0] transition-colors">Agents</span>
            <span className="text-[11px] text-[#555c75] tabular-nums">
              {agents?.length ? `${agents.length} agent${agents.length !== 1 ? 's' : ''}` : 'none'}
            </span>
            <svg className="w-3 h-3 text-[#2a3050] group-hover:text-[#3d4460] transition-colors shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 2.5L9 6l-4.5 3.5"/></svg>
          </button>

          {/* MCP Servers */}
          <button
            onClick={() => onNavigate({ type: 'global-mcp' })}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#111520] transition-colors group"
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-cyan-500/12 border border-cyan-500/20">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#22d3ee" strokeWidth="1.3" strokeLinecap="round">
                <circle cx="8" cy="8" r="6"/>
                <circle cx="8" cy="8" r="2" fill="#22d3ee" stroke="none"/>
                <path d="M8 2V1M8 15v-1M2 8H1M15 8h-1" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="flex-1 text-left text-[12.5px] font-medium text-[#9096b0] group-hover:text-[#c4c8e0] transition-colors">MCP Servers</span>
            <span className="text-[11px] text-[#555c75] tabular-nums">
              {mcpCount > 0 ? `${mcpCount} server${mcpCount !== 1 ? 's' : ''}` : 'none'}
            </span>
            <svg className="w-3 h-3 text-[#2a3050] group-hover:text-[#3d4460] transition-colors shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 2.5L9 6l-4.5 3.5"/></svg>
          </button>

        </div>

        {mcpCount > 0 && (
          <div>
            <p className="text-[10px] font-bold text-[#3d4460] uppercase tracking-[0.12em] mb-3">MCP Servers</p>
            <div className="flex flex-wrap gap-1.5">
              {allServers.map(s => {
                const displayName = s.name.replace(/^claude\.ai\s*/i, '')
                const color = mcpServiceColor(s.name)
                const enabledCount = allProjects.filter(p => !s.disabledProjectPaths.includes(p.realPath)).length
                return (
                  <div
                    key={s.name}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                    style={{ background: `${color}10`, border: `1px solid ${color}20` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[11.5px] font-medium" style={{ color }}>{displayName}</span>
                    {allProjects.length > 0 && (
                      <span className="text-[10.5px] tabular-nums ml-0.5" style={{ color: `${color}99` }}>
                        {enabledCount}/{allProjects.length}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
