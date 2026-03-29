import { useState } from 'react'
import { useGlobalAgents, useProjectAgents, Agent } from '../../../hooks/useIPC'
import { CreateAgentModal } from './CreateAgentModal'

function AgentRow({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative w-full text-left group flex items-start gap-6 px-6 py-4 transition-all duration-200 border-b border-white/[0.035] last:border-0"
    >
      {/* Gradient sweep on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-r from-violet-600/[0.07] via-violet-600/[0.02] to-transparent pointer-events-none" />

      {/* Left accent */}
      <div className={`absolute left-0 top-3 bottom-3 w-[2px] rounded-full transition-all duration-200 ${
        agent.scope === 'project'
          ? 'bg-emerald-500/30 group-hover:bg-emerald-400/80'
          : 'bg-blue-500/20 group-hover:bg-blue-400/60'
      }`} />

      {/* Nome */}
      <div className="relative w-44 shrink-0 flex items-center gap-2">
        <span className="text-[13px] shrink-0">🤖</span>
        <span className="text-[13px] font-mono font-semibold tracking-tight text-zinc-300 group-hover:text-white transition-colors duration-150 truncate">
          {agent.name}
        </span>
      </div>

      {/* Descrizione + model */}
      <div className="relative flex-1 min-w-0">
        {agent.description ? (
          <p className="text-[12px] leading-snug text-zinc-500 group-hover:text-zinc-300 transition-colors duration-150 line-clamp-2">
            {agent.description}
          </p>
        ) : (
          <p className="text-[12px] text-zinc-700 italic">—</p>
        )}
        {agent.model && (
          <code className="mt-1.5 block text-[10px] font-mono text-zinc-600 group-hover:text-zinc-500 transition-colors">
            {agent.model}
          </code>
        )}
      </div>

      {/* Tools + scope badge + chevron */}
      <div className="relative flex items-start gap-2 shrink-0 pt-0.5">
        {agent.allowedTools && agent.allowedTools.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {agent.allowedTools.slice(0, 3).map(t => (
              <span
                key={t}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-violet-950/30 text-violet-400/60 ring-1 ring-violet-700/15 group-hover:text-violet-400/90 group-hover:ring-violet-700/30 transition-colors"
              >
                {t}
              </span>
            ))}
            {agent.allowedTools.length > 3 && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-zinc-900 text-zinc-600">
                +{agent.allowedTools.length - 3}
              </span>
            )}
          </div>
        )}
        <span className="text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all duration-150 text-[14px] leading-none mt-px">›</span>
      </div>
    </button>
  )
}

/* Chip compatta per agent globali nella vista progetto */
function GlobalAgentChip({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111318] border border-white/[0.05] hover:border-violet-500/25 hover:bg-[#14172280] transition-all duration-150"
    >
      <span className="text-[10px]">🤖</span>
      <span className="text-[11px] font-mono text-zinc-600 group-hover:text-zinc-300 transition-colors duration-150">
        {agent.name}
      </span>
      {agent.allowedTools && agent.allowedTools.length > 0 && (
        <span className="text-[9px] text-zinc-700 group-hover:text-zinc-500 transition-colors">
          · {agent.allowedTools.length}
        </span>
      )}
    </button>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 px-6 pt-5 pb-3">
      <span className="text-[9px] font-bold tracking-[0.16em] uppercase text-zinc-500">{label}</span>
      <span className="text-[9px] font-semibold tabular-nums text-zinc-600 bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
        {count}
      </span>
      <div className="flex-1 h-px bg-white/[0.04]" />
    </div>
  )
}

export function GlobalAgentsView({
  onBack,
  onSelectAgent,
  project,
}: {
  onBack: () => void
  onSelectAgent: (agent: Agent) => void
  project?: { hash: string; realPath: string }
}) {
  const projectName = project?.realPath.split('/').pop()
  const { data: globalAgents, isLoading: loadingGlobal } = useGlobalAgents()
  const { data: projectAgents, isLoading: loadingProject } = useProjectAgents(project?.realPath ?? null)

  const isLoading = project ? loadingGlobal || loadingProject : loadingGlobal

  const projectAgentList = projectAgents ?? []
  const globalAgentList = project
    ? (globalAgents ?? []).filter(g => !projectAgentList.some(p => p.name === g.name))
    : (globalAgents ?? [])
  const agents = project ? [...projectAgentList, ...globalAgentList] : globalAgentList

  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="h-full bg-[#0d0f14] flex flex-col">
      {showCreate && <CreateAgentModal onClose={() => setShowCreate(false)} onCreated={() => setShowCreate(false)} />}

      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.04] px-6 py-3.5 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          <span className="text-[10px]">←</span>
          Back
        </button>
        <span className="text-zinc-800 text-[11px]">/</span>
        <h1 className="text-[13px] font-semibold text-zinc-200">
          {project ? `Agents — ${projectName}` : 'Global Agents'}
        </h1>

        <div className="ml-auto flex items-center gap-3">
          {agents.length > 0 && (
            <span className="text-[11px] tabular-nums text-zinc-600">
              {agents.length} agent{agents.length !== 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-violet-600/90 text-white hover:bg-violet-500 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            New Agent
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="px-6 py-8 text-[12px] text-zinc-600">Loading...</div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <p className="text-[13px] text-zinc-500">No agents found</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Add agents in <code className="font-mono text-zinc-500">~/.claude/agents/</code>
            </p>
          </div>
        ) : project ? (
          /* ── Vista progetto: righe per agent di progetto, chips per globali ── */
          <div>
            {projectAgentList.length > 0 && (
              <div>
                <SectionHeader label="This project" count={projectAgentList.length} />
                <div>
                  {projectAgentList.map(agent => (
                    <AgentRow key={agent.name} agent={agent} onClick={() => onSelectAgent(agent)} />
                  ))}
                </div>
              </div>
            )}

            {globalAgentList.length > 0 && (
              <div className="mt-4 mb-6">
                <div className="flex items-center gap-3 px-6 pt-4 pb-3">
                  <span className="text-[9px] font-bold tracking-[0.16em] uppercase text-zinc-700">Global</span>
                  <span className="text-[9px] font-semibold tabular-nums text-zinc-700 bg-zinc-900 px-1.5 py-0.5 rounded-full">
                    {globalAgentList.length}
                  </span>
                  <div className="flex-1 h-px bg-white/[0.03]" />
                </div>
                <div className="px-6 flex flex-wrap gap-2">
                  {globalAgentList.map(agent => (
                    <GlobalAgentChip
                      key={agent.name}
                      agent={agent}
                      onClick={() => onSelectAgent(agent)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Vista globale: lista righe piena ── */
          <div className="pt-1">
            {agents.map(agent => (
              <AgentRow key={agent.name} agent={agent} onClick={() => onSelectAgent(agent)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
