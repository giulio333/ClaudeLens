import {
  useProjectCost,
  useMemoryProject,
  useSessionList,
  useClaudeMdHierarchy,
  useProjectRules,
  useGlobalMcp,
  useAllSkills,
  useGlobalAgents,
  useProjectAgents,
  RuleFile,
} from '../../../hooks/useIPC'
import Markdown from '../../Markdown'
import { fmt } from '../utils'
import { SectionTitle } from '../shared/SectionTitle'
import { Accordion } from '../shared/Accordion'
import { mcpServiceColor } from '../mcp/McpServerCard'
import { NavCard } from './NavCard'
import { View } from '../types'

function RulesSection({ realPath }: { realPath: string }) {
  const { data, isLoading } = useProjectRules(realPath)
  if (isLoading) return <p className="text-sm text-zinc-400">Loading...</p>
  if (!data?.length) return <p className="text-sm text-zinc-400 italic">No conditional rules.</p>
  return (
    <div>
      {data.map((rule: RuleFile, i: number) => (
        <Accordion key={i} title={rule.filename}>
          {rule.paths && rule.paths.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {rule.paths.map(p => (
                <span key={p} className="bg-[#1c2133] text-[#787e98] text-[11px] font-mono px-2 py-0.5 rounded">{p}</span>
              ))}
            </div>
          )}
          <Markdown>{rule.content}</Markdown>
        </Accordion>
      ))}
    </div>
  )
}

export function ProjectOverviewContent({
  project,
  onNavigate,
}: {
  project: { hash: string; realPath: string }
  onNavigate: (v: View) => void
}) {
  const { data: cost } = useProjectCost(project.hash)
  const { data: memory } = useMemoryProject(project.hash)
  const { data: sessions } = useSessionList(project.hash)
  const { data: claudeMd } = useClaudeMdHierarchy(project.realPath)
  const { data: rules } = useProjectRules(project.realPath)
  const { data: mcpData } = useGlobalMcp()
  const { data: allSkills } = useAllSkills(project.realPath)
  const { data: globalAgents } = useGlobalAgents()
  const { data: projectAgents } = useProjectAgents(project.realPath)

  const skillCount = allSkills?.length ?? 0
  const projectAgentCount = projectAgents?.length ?? 0
  const globalAgentCount = (globalAgents ?? []).filter(
    g => !(projectAgents ?? []).some(p => p.name === g.name)
  ).length
  const agentCount = projectAgentCount + globalAgentCount

  const enabledMcp = [
    ...(mcpData?.cloudServers ?? []),
    ...(mcpData?.localServers ?? []),
  ].filter(s => !s.disabledProjectPaths.includes(project.realPath))

  const projectName = project.realPath.split('/').pop() ?? project.realPath
  const hues = [240, 260, 280, 200, 160, 30, 10]
  const hue = hues[project.hash.charCodeAt(0) % hues.length]

  const topicCount = (memory?.index.length ?? 0) + (memory?.projectLevelIndex.length ?? 0)
  const claudeMdLayers = claudeMd?.layers.filter(l => l.scope !== 'global') ?? []
  const lastSession = sessions?.[0]

  return (
    <div className="h-full overflow-y-auto bg-[#0d0f14]">

      {/* Header */}
      <div className="bg-[#0f1117] border-b border-[#1e2130]">
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-[14px] font-bold select-none"
                style={{
                  background: `hsl(${hue},55%,16%)`,
                  color: `hsl(${hue},70%,65%)`,
                  border: `1px solid hsl(${hue},55%,24%)`,
                }}
              >
                {projectName[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="text-[16px] font-bold text-[#e0e2f0] tracking-tight truncate">{projectName}</h1>
                <p className="text-[11px] text-[#3d4460] font-mono mt-0.5 truncate">{project.realPath}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => window.electronAPI.sessions.newInTerminal(project.realPath)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/12 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors text-[11.5px] font-medium text-emerald-400 hover:text-emerald-300"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3l3 3-3 3M6.5 9h3.5"/>
                </svg>
                Open in Claude Code
              </button>
              <button
                onClick={() => onNavigate({ type: 'ai-assistant', project })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-500/12 hover:bg-indigo-500/20 border border-indigo-500/20 transition-colors text-[11.5px] font-medium text-indigo-400 hover:text-indigo-300"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="6" r="4.5"/>
                  <circle cx="6" cy="6" r="1.5" fill="currentColor" stroke="none"/>
                </svg>
                AI Assistant
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[12px] text-[#555c75]">
              <span className="text-[#9096b0] font-semibold tabular-nums">{cost?.sessionsCount ?? '—'}</span> sessions
            </span>
            <div className="h-3 w-px bg-[#1e2130]"/>
            <span className="text-[12px] text-[#555c75]">
              <span className="text-[#9096b0] font-semibold tabular-nums">{cost ? fmt(cost.totalTokens) : '—'}</span> token
            </span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">

        {/* Attività */}
        <div>
          <p className="text-[10px] font-bold text-[#3d4460] uppercase tracking-[0.12em] mb-3">Activity</p>
          <div className="grid grid-cols-3 gap-3">
            <NavCard
              iconBg="bg-blue-500/12 border border-blue-500/20"
              iconColor="#60a5fa"
              iconChildren={<path d="M2 2.5h12v8H9l-3 2.5v-2.5H2v-8z"/>}
              title="Sessions"
              stat={cost ? String(cost.sessionsCount) : '—'}
              sub={lastSession
                ? `Last: ${new Date(lastSession.date).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}`
                : 'No sessions'}
              onClick={() => onNavigate({ type: 'sessions', project })}
            />
            <NavCard
              iconBg="bg-emerald-500/12 border border-emerald-500/20"
              iconColor="#34d399"
              iconChildren={<>
                <path d="M2 13V9.5h3M6.5 13V6H10M11.5 13V2.5H15" strokeWidth="1.4"/>
              </>}
              title="Analytics"
              stat={cost ? fmt(cost.totalTokens) : '—'}
              sub={cost ? `${String(cost.sessionsCount)} sessions` : 'No data'}
              onClick={() => onNavigate({ type: 'analytics', project })}
            />
            <NavCard
              iconBg="bg-cyan-500/12 border border-cyan-500/20"
              iconColor="#22d3ee"
              iconChildren={<>
                <circle cx="8" cy="8" r="6" strokeWidth="1.2"/>
                <circle cx="8" cy="8" r="2.5" fill="#22d3ee" stroke="none"/>
                <path d="M8 2V1M8 15v-1M2 8H1M15 8h-1" strokeWidth="1.2" strokeLinecap="round"/>
              </>}
              title="Live Monitor"
              stat="Live"
              sub="Real-time activity"
              onClick={() => onNavigate({ type: 'live-monitor', project })}
            />
          </div>
        </div>

        {/* Configurazione */}
        <div>
          <p className="text-[10px] font-bold text-[#3d4460] uppercase tracking-[0.12em] mb-3">Configuration</p>
          <div className="rounded-xl border border-[#1e2130] bg-[#0f1117] overflow-hidden divide-y divide-[#1e2130]">

            <button
              onClick={() => {
                const root = claudeMdLayers.find(l => l.scope === 'project') ?? claudeMdLayers[0]
                if (root) onNavigate({ type: 'project-claudemd', project, layer: root })
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#111520] transition-colors group"
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-blue-500/12 border border-blue-500/20">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#60a5fa" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 1.5h6l4 4v9H3v-13z"/>
                  <path d="M9 1.5v4h4"/>
                  <path d="M6 9h4M6 11.5h2.5"/>
                </svg>
              </div>
              <span className="flex-1 text-left text-[12.5px] font-medium text-[#9096b0] group-hover:text-[#c4c8e0] transition-colors">CLAUDE.md</span>
              <span className="text-[11px] text-[#555c75] tabular-nums">
                {claudeMdLayers.length > 0 ? `${claudeMdLayers.length} layer` : 'none'}
              </span>
              <svg className="w-3 h-3 text-[#2a3050] group-hover:text-[#3d4460] transition-colors shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 2.5L9 6l-4.5 3.5"/></svg>
            </button>

            <button
              onClick={() => onNavigate({ type: 'project-skills', project })}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#111520] transition-colors group"
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-indigo-500/12 border border-indigo-500/20">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#818cf8" strokeWidth="1.1" strokeLinejoin="round">
                  <path d="M8 1.5L9.8 6.5H15L10.6 9.5L12.4 14.5L8 11.5L3.6 14.5L5.4 9.5L1 6.5H6.2Z"/>
                </svg>
              </div>
              <span className="flex-1 text-left text-[12.5px] font-medium text-[#9096b0] group-hover:text-[#c4c8e0] transition-colors">Skills</span>
              <span className="text-[11px] text-[#555c75] tabular-nums">
                {skillCount > 0 ? `${skillCount} available` : 'none'}
              </span>
              <svg className="w-3 h-3 text-[#2a3050] group-hover:text-[#3d4460] transition-colors shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 2.5L9 6l-4.5 3.5"/></svg>
            </button>

            <button
              onClick={() => onNavigate({ type: 'project-agents', project })}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#111520] transition-colors group"
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-emerald-500/12 border border-emerald-500/20">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#34d399" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2.5" y="5" width="9" height="7" rx="1.5"/>
                  <path d="M5 5V3.5a2 2 0 014 0V5"/>
                  <circle cx="5" cy="9" r="1" fill="#34d399" stroke="none"/>
                  <circle cx="9" cy="9" r="1" fill="#34d399" stroke="none"/>
                </svg>
              </div>
              <span className="flex-1 text-left text-[12.5px] font-medium text-[#9096b0] group-hover:text-[#c4c8e0] transition-colors">Agents</span>
              <span className="text-[11px] text-[#555c75] tabular-nums">
                {agentCount > 0 ? `${agentCount} available` : 'none'}
              </span>
              <svg className="w-3 h-3 text-[#2a3050] group-hover:text-[#3d4460] transition-colors shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 2.5L9 6l-4.5 3.5"/></svg>
            </button>

            <button
              onClick={() => onNavigate({ type: 'project-memory', project })}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#111520] transition-colors group"
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-violet-500/12 border border-violet-500/20">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#a78bfa" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 4h12M2 8h12M2 12h7"/>
                </svg>
              </div>
              <span className="flex-1 text-left text-[12.5px] font-medium text-[#9096b0] group-hover:text-[#c4c8e0] transition-colors">Memory</span>
              <span className="text-[11px] text-[#555c75] tabular-nums">
                {topicCount > 0 ? `${topicCount} topic` : 'empty'}
              </span>
              <svg className="w-3 h-3 text-[#2a3050] group-hover:text-[#3d4460] transition-colors shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 2.5L9 6l-4.5 3.5"/></svg>
            </button>

          </div>
        </div>

        {/* MCP Servers abilitati */}
        {enabledMcp.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-[#3d4460] uppercase tracking-[0.12em] mb-3">Active MCP Servers</p>
            <div className="flex flex-wrap gap-1.5">
              {enabledMcp.map(s => {
                const displayName = s.name.replace(/^claude\.ai\s*/i, '')
                const color = mcpServiceColor(s.name)
                return (
                  <div
                    key={s.name}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                    style={{ background: `${color}10`, border: `1px solid ${color}20` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[11.5px] font-medium" style={{ color }}>{displayName}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Rules condizionali */}
        {(rules?.length ?? 0) > 0 && (
          <div className="rounded-xl border border-[#1e2130] bg-[#0f1117] px-4 pt-3 pb-2">
            <SectionTitle>Conditional Rules</SectionTitle>
            <RulesSection realPath={project.realPath} />
          </div>
        )}

      </div>
    </div>
  )
}
