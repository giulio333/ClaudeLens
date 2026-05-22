import { useState, useEffect } from 'react'
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
import { CreateSkillPage } from '../components/project/skills/CreateSkillPage'
// ─── Agents
import { GlobalAgentsView } from '../components/project/agents/GlobalAgentsView'
import { AgentDetailView } from '../components/project/agents/AgentDetailView'
import { CreateAgentPage } from '../components/project/agents/CreateAgentPage'
// ─── MCP
import { GlobalMcpView } from '../components/project/mcp/GlobalMcpView'
import { McpServerDetailView } from '../components/project/mcp/McpServerDetailView'
// ─── Agents Live
import { AgentsLiveView } from '../components/project/agents-live/AgentsLiveView'
// ─── Chat
import { ChatView } from '../components/project/chat/ChatView'
// ─── Memory
import { MemoryTopicView } from '../components/project/memory/MemoryTopicView'
// ─── Analytics / AI
import { AnalyticsView } from '../components/project/analytics/AnalyticsView'
import { AiAssistantView } from '../components/project/ai-assistant/AiAssistantView'
// ─── Editorial core
import { ProjectView, type ProjectSection } from '../components/project/overview/ProjectOverviewContent'
import { GlobalHomeView } from '../components/project/overview/GlobalHomeView'
import { ProjectSubtabs } from '../components/project/overview/ProjectSubtabs'

type Project = { hash: string; realPath: string }
type Theme = 'light' | 'dark'

// View types that render inside the editorial chrome (top bar + subtabs)
const CORE_PROJECT_VIEWS = ['overview', 'sessions', 'project-memory', 'project-skills', 'project-agents', 'project-mcp']

function sectionFromView(v: View): ProjectSection {
  switch (v.type) {
    case 'sessions':        return 'sessions'
    case 'project-memory':  return 'memory'
    case 'project-skills':  return 'skills'
    case 'project-agents':  return 'agents'
    case 'project-mcp':     return 'mcp'
    default:                return 'overview'
  }
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.2" /><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  )
}

export default function ProjectOverview() {
  const [selected, setSelected] = useState<Project | null>(null)
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [view, setView] = useState<View>({ type: 'global-home' })
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('cl-theme')) as Theme | null
    return saved === 'dark' ? 'dark' : 'light'
  })

  const { data: projects } = useMemoryProjects()
  const deleteProjectMutation = useDeleteProject()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('cl-theme', theme) } catch { /* ignore */ }
  }, [theme])

  function selectProject(p: Project) {
    setSelected(p)
    setScope('project')
    setView({ type: 'overview' })
  }

  function goGlobal() {
    setScope('global')
    setView({ type: 'global-home' })
  }

  function goProjectScope() {
    if (selected) {
      setScope('project')
      setView({ type: 'overview' })
    } else if (projects && projects.length > 0) {
      selectProject(projects[0])
    }
  }

  async function handleConfirmDelete(p: Project) {
    try {
      await deleteProjectMutation.mutateAsync(p.hash)
      if (selected?.hash === p.hash) {
        setSelected(null)
        goGlobal()
      }
    } finally {
      setProjectToDelete(null)
    }
  }

  const isGlobalHome = view.type === 'global-home'
  const isCoreProject = CORE_PROJECT_VIEWS.includes(view.type)
  const isEditorialCore = isGlobalHome || isCoreProject

  // ─── Deep views (full-screen, not yet migrated to the editorial theme) ───
  function renderDeepView() {
    switch (view.type) {
      case 'global-claudemd':
        return <GlobalClaudeMdView onBack={goGlobal} />
      case 'global-skills':
        return (
          <GlobalSkillsView
            onBack={goGlobal}
            onSelectSkill={skill => setView({ type: 'skill-detail', skill })}
            onCreate={() => setView({ type: 'skill-create' })}
          />
        )
      case 'skill-detail':
        return (
          <SkillDetailView
            skill={view.skill}
            onBack={() => selected ? setView({ type: 'project-skills', project: selected }) : setView({ type: 'global-skills' })}
          />
        )
      case 'skill-create':
        return (
          <CreateSkillPage
            project={view.project}
            onBack={() => view.project ? setView({ type: 'project-skills', project: view.project }) : setView({ type: 'global-skills' })}
            onSaved={() => view.project ? setView({ type: 'project-skills', project: view.project }) : setView({ type: 'global-skills' })}
          />
        )
      case 'global-agents':
        return (
          <GlobalAgentsView
            onBack={goGlobal}
            onSelectAgent={agent => setView({ type: 'agent-detail', agent })}
            onCreate={() => setView({ type: 'agent-create' })}
          />
        )
      case 'agent-detail':
        return (
          <AgentDetailView
            agent={view.agent}
            onBack={() => selected ? setView({ type: 'project-agents', project: selected }) : setView({ type: 'global-agents' })}
          />
        )
      case 'agent-create':
        return (
          <CreateAgentPage
            project={view.project}
            onBack={() => view.project ? setView({ type: 'project-agents', project: view.project }) : setView({ type: 'global-agents' })}
            onSaved={() => view.project ? setView({ type: 'project-agents', project: view.project }) : setView({ type: 'global-agents' })}
          />
        )
      case 'global-mcp':
        return (
          <GlobalMcpView
            onBack={goGlobal}
            onSelectServer={server => setView({ type: 'mcp-detail', server, totalProjects: server.enabledInProjects + server.disabledInProjects })}
          />
        )
      case 'mcp-detail':
        return (
          <McpServerDetailView
            server={view.server}
            totalProjects={view.totalProjects}
            onBack={() => setView({ type: 'global-mcp' })}
          />
        )
      case 'project-claudemd':
        return <ProjectClaudeMdView layer={view.layer} onBack={() => setView({ type: 'overview' })} />
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
              onBack={() => selected ? setView({ type: 'project-memory', project: selected }) : goGlobal()}
            />
          </ErrorBoundary>
        )
      case 'analytics':
        return <AnalyticsView project={view.project} onBack={() => setView({ type: 'overview' })} />
      case 'ai-assistant':
        return <AiAssistantView project={view.project} onBack={() => setView({ type: 'overview' })} />
      case 'live-monitor':
        return <LiveMonitor project={view.project} onBack={() => setView({ type: 'overview' })} />
      case 'agents-live':
        return (
          <AgentsLiveView
            project={view.project}
            onBack={() => view.project ? setView({ type: 'overview' }) : goGlobal()}
            onOpenSession={(project, session) => setView({ type: 'chat', project, session })}
          />
        )
      default:
        return null
    }
  }

  // Deep views take over the full surface (preserve their existing chrome).
  if (!isEditorialCore) {
    return (
      <div className="cl-app">
        <div style={{ flex: 1, overflow: 'hidden' }}>{renderDeepView()}</div>
        {projectToDelete && (
          <DeleteProjectDialog
            project={projectToDelete}
            isLoading={deleteProjectMutation.isLoading}
            onConfirm={() => handleConfirmDelete(projectToDelete)}
            onCancel={() => setProjectToDelete(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="cl-app">
      {/* ─── Top bar ─────────────────────────────────────── */}
      <header className="cl-bar">
        <button
          className="cl-brand"
          type="button"
          onClick={goGlobal}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <span className="cl-brand-mark" />
          <span>Claude<span style={{ opacity: 0.55 }}>Lens</span></span>
        </button>

        <nav className="cl-scope">
          <button className={scope === 'global' ? 'on' : ''} onClick={goGlobal}>Global</button>
          <button className={scope === 'project' ? 'on' : ''} onClick={goProjectScope}>Project</button>
        </nav>

        <div />

        <div className="cl-bar-right">
          <button
            className="cl-theme-toggle"
            type="button"
            onClick={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>
      </header>

      {/* ─── Subtabs (project scope only) ────────────────── */}
      {scope === 'project' && selected && (
        <ProjectSubtabs
          project={selected}
          active={sectionFromView(view)}
          onNavigate={setView}
        />
      )}

      {/* ─── Main ────────────────────────────────────────── */}
      <div className="cl-main">
        {isGlobalHome ? (
          <GlobalHomeView onNavigate={setView} onSelectProject={selectProject} />
        ) : selected ? (
          <ProjectView
            key={selected.hash}
            project={selected}
            section={sectionFromView(view)}
            onNavigate={setView}
            onSelectProject={selectProject}
            onDeleteProject={setProjectToDelete}
          />
        ) : null}
      </div>

      {projectToDelete && (
        <DeleteProjectDialog
          project={projectToDelete}
          isLoading={deleteProjectMutation.isLoading}
          onConfirm={() => handleConfirmDelete(projectToDelete)}
          onCancel={() => setProjectToDelete(null)}
        />
      )}
    </div>
  )
}
