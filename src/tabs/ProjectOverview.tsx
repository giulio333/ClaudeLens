import { useState } from 'react'
import LiveMonitor from './LiveMonitor'
import { useMemoryProjects, useDeleteProject } from '../hooks/useIPC'
import { View } from '../components/project/types'
import { DeleteProjectDialog } from '../components/project/shared/DeleteProjectDialog'

// ─── Shared
import { ErrorBoundary } from '../components/ErrorBoundary'
import { GlobalClaudeMdView, ProjectClaudeMdView } from '../components/project/claudemd/GlobalClaudeMdView'
// ─── Skills
import { GlobalSkillsView } from '../components/project/skills/GlobalSkillsView'
import { SkillDetailView } from '../components/project/skills/SkillDetailView'
// ─── Agents
import { GlobalAgentsView } from '../components/project/agents/GlobalAgentsView'
import { AgentDetailView } from '../components/project/agents/AgentDetailView'
// ─── MCP
import { GlobalMcpView } from '../components/project/mcp/GlobalMcpView'
// ─── Sessions / Chat
import { SessionsDetailView } from '../components/project/sessions/SessionsDetailView'
import { ChatView } from '../components/project/chat/ChatView'
// ─── Memory
import { MemoryFullView } from '../components/project/memory/MemoryFullView'
import { MemoryTopicView } from '../components/project/memory/MemoryTopicView'
// ─── Analytics / AI
import { AnalyticsView } from '../components/project/analytics/AnalyticsView'
import { AiAssistantView } from '../components/project/ai-assistant/AiAssistantView'
// ─── Overview
import { ProjectOverviewContent } from '../components/project/overview/ProjectOverviewContent'
import { GlobalHomeView } from '../components/project/overview/GlobalHomeView'

export default function ProjectOverview() {
  const [selected, setSelected] = useState<{ hash: string; realPath: string } | null>(null)
  const [view, setView] = useState<View>({ type: 'global-home' })
  const [projectToDelete, setProjectToDelete] = useState<{ hash: string; realPath: string } | null>(null)
  const { data: projects, isLoading } = useMemoryProjects()
  const deleteProjectMutation = useDeleteProject()

  function handleSelectProject(p: { hash: string; realPath: string }) {
    setSelected(p)
    setView({ type: 'overview' })
  }

  async function handleConfirmDelete(p: { hash: string; realPath: string }) {
    try {
      await deleteProjectMutation.mutateAsync(p.hash)
      if (selected?.hash === p.hash) {
        setSelected(null)
        setView({ type: 'global-home' })
      }
    } finally {
      setProjectToDelete(null)
    }
  }

  function renderMainView() {
    switch (view.type) {
      case 'global-home':
        return <GlobalHomeView onNavigate={setView} />
      case 'global-claudemd':
        return <GlobalClaudeMdView onBack={() => setView({ type: 'global-home' })} />
      case 'global-skills':
        return (
          <GlobalSkillsView
            onBack={() => setView({ type: 'global-home' })}
            onSelectSkill={skill => setView({ type: 'skill-detail', skill })}
          />
        )
      case 'project-skills':
        return (
          <GlobalSkillsView
            project={view.project}
            onBack={() => setView({ type: 'overview' })}
            onSelectSkill={skill => setView({ type: 'skill-detail', skill })}
            onNavigateGlobalSkills={() => setView({ type: 'global-skills' })}
          />
        )
      case 'skill-detail':
        return (
          <SkillDetailView
            skill={view.skill}
            onBack={() => selected
              ? setView({ type: 'project-skills', project: selected })
              : setView({ type: 'global-skills' })
            }
          />
        )
      case 'global-agents':
        return (
          <GlobalAgentsView
            onBack={() => setView({ type: 'global-home' })}
            onSelectAgent={agent => setView({ type: 'agent-detail', agent })}
          />
        )
      case 'project-agents':
        return (
          <GlobalAgentsView
            project={view.project}
            onBack={() => setView({ type: 'overview' })}
            onSelectAgent={agent => setView({ type: 'agent-detail', agent })}
          />
        )
      case 'agent-detail':
        return (
          <AgentDetailView
            agent={view.agent}
            onBack={() => selected
              ? setView({ type: 'project-agents', project: selected })
              : setView({ type: 'global-agents' })
            }
          />
        )
      case 'global-mcp':
        return <GlobalMcpView onBack={() => setView({ type: 'global-home' })} />
      case 'overview':
        if (!selected) return null
        return <ProjectOverviewContent project={selected} onNavigate={setView} />
      case 'project-memory':
        return (
          <MemoryFullView
            project={view.project}
            onBack={() => setView({ type: 'overview' })}
            onOpenTopic={(topic, content) => setView({ type: 'memory-topic', topic, content, hash: view.project.hash })}
          />
        )
      case 'project-claudemd':
        return (
          <ProjectClaudeMdView
            layer={view.layer}
            onBack={() => setView({ type: 'overview' })}
          />
        )
      case 'sessions':
        return (
          <SessionsDetailView
            project={view.project}
            onBack={() => setView({ type: 'overview' })}
            onOpenChat={session => setView({ type: 'chat', project: view.project, session })}
          />
        )
      case 'analytics':
        return (
          <AnalyticsView
            project={view.project}
            onBack={() => setView({ type: 'overview' })}
          />
        )
      case 'chat':
        return (
          <ErrorBoundary key={view.session.filename}>
            <ChatView
              project={view.project}
              session={view.session}
              onBack={() => setView({ type: 'sessions', project: view.project })}
            />
          </ErrorBoundary>
        )
      case 'memory-topic':
        return (
          <ErrorBoundary key={view.topic.filename}>
            <MemoryTopicView
              topic={view.topic}
              content={view.content}
              hash={view.hash}
              onBack={() => setView({ type: 'overview' })}
            />
          </ErrorBoundary>
        )
      case 'ai-assistant':
        return (
          <AiAssistantView
            project={view.project}
            onBack={() => setView({ type: 'overview' })}
          />
        )
      case 'live-monitor':
        return (
          <LiveMonitor
            project={view.project}
            onBack={() => setView({ type: 'overview' })}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-[200px] shrink-0 bg-[#0f1117] border-r border-[#1e2130] overflow-hidden flex flex-col">

        {/* Drag region (titlebar area, no visible content) */}
        <div
          className="h-[22px] shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />

        {/* Globale button */}
        <div className="px-2 pb-2 shrink-0">
          {(() => {
            const isGlobal = selected === null
            return (
              <button
                onClick={() => { setSelected(null); setView({ type: 'global-home' }) }}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all ${
                  isGlobal ? 'bg-[#1c2235]' : 'hover:bg-[#161b26]'
                }`}
              >
                <div className={`w-[26px] h-[26px] rounded-md flex items-center justify-center shrink-0 ${
                  isGlobal
                    ? 'bg-indigo-500/20 border border-indigo-500/30'
                    : 'bg-[#161b26] border border-[#1e2130]'
                }`}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke={isGlobal ? '#818cf8' : '#555c75'} strokeWidth="1.3"/>
                    <circle cx="6" cy="6" r="2" fill={isGlobal ? '#818cf8' : '#555c75'}/>
                  </svg>
                </div>
                <span className={`text-[12.5px] font-medium tracking-tight ${
                  isGlobal ? 'text-[#c4c8e0]' : 'text-[#555c75]'
                }`}>Global</span>
              </button>
            )
          })()}
        </div>

        {/* Divider */}
        <div className="mx-3 h-px bg-[#1e2130] shrink-0" />

        {/* Projects section */}
        <div className="flex flex-col flex-1 overflow-hidden pt-2">
          <p className="px-4 pb-1.5 text-[10px] font-bold text-[#3d4460] uppercase tracking-[0.12em] shrink-0">Projects</p>
          <ul className="overflow-y-auto flex-1 px-2 pb-2 space-y-0.5">
            {isLoading && (
              <li className="px-3 py-2 text-[#3d4460] text-[12px]">Loading...</li>
            )}
            {projects?.map(p => {
              const name = p.realPath.split('/').pop() ?? p.realPath
              const initial = name[0]?.toUpperCase() ?? '?'
              const isActive = selected?.hash === p.hash
              const hues = [240, 260, 280, 200, 160, 30, 10]
              const hue = hues[p.hash.charCodeAt(0) % hues.length]
              return (
                <li key={p.hash}>
                  <div className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all group cursor-pointer ${
                    isActive ? 'bg-[#1c2235]' : 'hover:bg-[#161b26]'
                  }`}>
                    <div
                      className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 select-none"
                      style={{
                        background: `hsl(${hue}, 60%, 18%)`,
                        color: `hsl(${hue}, 70%, 65%)`,
                        border: isActive ? `1px solid hsl(${hue}, 60%, 30%)` : `1px solid hsl(${hue}, 60%, 14%)`,
                      }}
                    >
                      {initial}
                    </div>
                    <button
                      onClick={() => handleSelectProject(p)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className={`text-[12.5px] font-medium truncate tracking-tight transition-colors ${
                        isActive ? 'text-[#c4c8e0]' : 'text-[#555c75] group-hover:text-[#9096b0]'
                      }`}>{name}</div>
                    </button>
                    <button
                      onClick={() => setProjectToDelete(p)}
                      className="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-900/25 text-[#3d4460] hover:text-red-400"
                      title="Delete project"
                    >
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1.5 3h9M4.5 3V2h3v1M3 3l.5 7h5L9 3"/>
                      </svg>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>

      {/* Delete confirmation dialog */}
      {projectToDelete && (
        <DeleteProjectDialog
          project={projectToDelete}
          isLoading={deleteProjectMutation.isLoading}
          onConfirm={() => handleConfirmDelete(projectToDelete)}
          onCancel={() => setProjectToDelete(null)}
        />
      )}

      {/* Main */}
      <div className="flex-1 overflow-hidden bg-[#0d0f14]">
        {renderMainView()}
      </div>
    </div>
  )
}
