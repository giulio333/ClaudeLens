import { useState, useEffect, useRef, useMemo } from 'react'
import LiveMonitor from './LiveMonitor'
import {
  useAllSkills,
  useCostSummary,
  useDeleteProject,
  useGlobalAgents,
  useGlobalMcp,
  useGlobalSkills,
  useMemoryProjects,
  useProjectAgents,
} from '../hooks/useIPC'
import { usePinnedProjects } from '../hooks/usePinnedProjects'
import { usePinnedSessions } from '../hooks/usePinnedSessions'
import { View } from '../components/project/types'
import { DeleteProjectDialog } from '../components/project/shared/DeleteProjectDialog'
import {
  SearchPopover,
  LensTriggerIcon,
  type SearchAnchorAlign,
  type SearchMode,
  type SearchSession,
} from '../components/project/shared/SearchPopover'
import type { ProjectCost } from '../types'

// ─── Shared
import { ErrorBoundary } from '../components/ErrorBoundary'
import { GlobalClaudeMdView, ProjectClaudeMdView } from '../components/project/claudemd/GlobalClaudeMdView'
// ─── Skills
import { GlobalSkillsView } from '../components/project/skills/GlobalSkillsView'
import { SkillDetailView } from '../components/project/skills/SkillDetailView'
import { CreateSkillPage } from '../components/project/skills/CreateSkillPage'
// ─── Agents
import { AgentDetailView } from '../components/project/agents/AgentDetailView'
import { CreateAgentPage } from '../components/project/agents/CreateAgentPage'
// ─── MCP
import { GlobalMcpView } from '../components/project/mcp/GlobalMcpView'
import { McpServerDetailView } from '../components/project/mcp/McpServerDetailView'
// ─── Plugins
import { PluginsView } from '../components/project/plugins/PluginsView'
import { PluginDetailView } from '../components/project/plugins/PluginDetailView'
// ─── Agents Live
import { AgentsLiveView } from '../components/project/agents-live/AgentsLiveView'
// ─── Chat
import { ChatView } from '../components/project/chat/ChatView'
import { NewChatView } from '../components/project/chat/NewChatView'
import { TerminalMissionControl } from '../components/project/terminal/TerminalMissionControl'
// ─── Memory
import { MemoryTopicView } from '../components/project/memory/MemoryTopicView'
import { PlanDetailView } from '../components/project/plans/PlanDetailView'
// ─── Analytics / AI
import { AnalyticsView } from '../components/project/analytics/AnalyticsView'
import { AiAssistantView } from '../components/project/ai-assistant/AiAssistantView'
// ─── Editorial core
import { ProjectView, type ProjectSection } from '../components/project/overview/ProjectOverviewContent'
import { GlobalHomeView } from '../components/project/overview/GlobalHomeView'
import { DuplicateProjectsView } from '../components/project/overview/DuplicateProjectsNotice'
import { ProjectSubtabs } from '../components/project/overview/ProjectSubtabs'
import { SettingsView, SettingsGearIcon } from '../components/project/settings/SettingsView'

type Project = { hash: string; realPath: string }

// View types that render inside the editorial chrome (top bar + subtabs)
const CORE_PROJECT_VIEWS = ['overview', 'sessions', 'project-memory', 'project-skills', 'project-agents', 'project-mcp', 'agents-live', 'project-tasks', 'project-plans', 'project-config']

function sectionFromView(v: View): ProjectSection {
  switch (v.type) {
    case 'sessions':        return 'sessions'
    case 'project-memory':  return 'memory'
    case 'project-skills':  return 'skills'
    case 'project-agents':  return 'agents'
    case 'project-mcp':     return 'mcp'
    case 'agents-live':     return 'live-agents'
    case 'project-tasks':   return 'tasks'
    case 'project-plans':   return 'plans'
    case 'project-config':  return 'config'
    default:                return 'overview'
  }
}

function viewForSection(section: ProjectSection, project: Project): View {
  switch (section) {
    case 'sessions':     return { type: 'sessions', project }
    case 'memory':       return { type: 'project-memory', project }
    case 'skills':       return { type: 'project-skills', project }
    case 'agents':       return { type: 'project-agents', project }
    case 'mcp':          return { type: 'project-mcp', project }
    case 'live-agents':  return { type: 'agents-live', project }
    case 'tasks':        return { type: 'project-tasks', project }
    case 'plans':        return { type: 'project-plans', project }
    case 'config':       return { type: 'project-config', project }
    default:             return { type: 'overview' }
  }
}

export default function ProjectOverview() {
  const [selected, setSelected] = useState<Project | null>(null)
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [view, setView] = useState<View>({ type: 'global-home' })
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)

  const { data: projects } = useMemoryProjects()
  const { data: costSummary } = useCostSummary()
  const { data: globalSkills = [] } = useGlobalSkills()
  const { data: scopedSkills = [] } = useAllSkills(selected?.realPath ?? null)
  const { data: globalAgents = [] } = useGlobalAgents()
  const { data: projectAgents = [] } = useProjectAgents(selected?.realPath ?? null)
  const { data: mcpData } = useGlobalMcp()
  const deleteProjectMutation = useDeleteProject()
  const { pinned, togglePin } = usePinnedProjects()
  const { isPinned: isSessionPinned, togglePin: toggleSessionPin } = usePinnedSessions()

  // ─── Unified search popover ───
  const lensBtnRef = useRef<HTMLButtonElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('global')
  const [searchAnchorAlign, setSearchAnchorAlign] = useState<SearchAnchorAlign>('right')
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const [searchSessions, setSearchSessions] = useState<SearchSession[]>([])
  const [searchSessionsLoading, setSearchSessionsLoading] = useState(false)
  function openSearch(mode: SearchMode, rect: DOMRect | null, align: SearchAnchorAlign) {
    setSearchMode(mode)
    setSearchAnchorAlign(align)
    setAnchorRect(rect)
    setSearchOpen(true)
  }
  function openGlobalSearch() {
    openSearch('global', lensBtnRef.current?.getBoundingClientRect() ?? null, 'right')
  }
  function openProjectSearch(rect: DOMRect) {
    openSearch('projects', rect, 'left')
  }
  function closeSearch() { setSearchOpen(false) }

  const costByHash = useMemo(() => {
    const m = new Map<string, ProjectCost>()
    for (const c of (costSummary as ProjectCost[] | undefined) ?? []) m.set(c.project, c)
    return m
  }, [costSummary])

  const searchSkills = selected ? scopedSkills : globalSkills
  const searchAgents = useMemo(() => {
    if (!selected) return globalAgents
    const seen = new Map<string, typeof globalAgents[number]>()
    for (const agent of [...projectAgents, ...globalAgents]) {
      if (!seen.has(agent.name)) seen.set(agent.name, agent)
    }
    return [...seen.values()]
  }, [globalAgents, projectAgents, selected])
  const searchMcpServers = useMemo(
    () => [...(mcpData?.cloudServers ?? []), ...(mcpData?.localServers ?? [])],
    [mcpData],
  )

  // Clear the loading flag whenever the global search is closed (render-time
  // adjustment; the async loader below owns the flag while it's open).
  if (!searchOpen && searchSessionsLoading) setSearchSessionsLoading(false)

  useEffect(() => {
    const projectsForSearch = projects ?? []
    if (!searchOpen || searchMode !== 'global' || projectsForSearch.length === 0) {
      return
    }

    let cancelled = false
    async function loadSessions() {
      setSearchSessionsLoading(true)
      try {
        const rows = await Promise.all(projectsForSearch.map(async project => {
          try {
            const result = await window.electronAPI.sessions.listByProject(project.hash)
            if (result.error || !result.data) return [] as SearchSession[]
            return result.data.map(session => ({ project, session }))
          } catch {
            return [] as SearchSession[]
          }
        }))
        if (!cancelled) {
          setSearchSessions(
            rows.flat().sort((a, b) => new Date(b.session.date).getTime() - new Date(a.session.date).getTime()),
          )
        }
      } finally {
        if (!cancelled) setSearchSessionsLoading(false)
      }
    }

    loadSessions()
    return () => { cancelled = true }
  }, [projects, searchMode, searchOpen])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (searchOpen && searchMode === 'global') closeSearch()
        else openGlobalSearch()
      } else if (meta && e.key.toLowerCase() === 'p' && selected) {
        e.preventDefault()
        togglePin(selected.hash)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchMode, searchOpen, selected, togglePin])

  function selectProject(p: Project) {
    setSelected(p)
    setScope('project')
    // Preserve the current section when switching project from within a core
    // project view (e.g. agents → agents of the newly selected project).
    setView(prev =>
      CORE_PROJECT_VIEWS.includes(prev.type)
        ? viewForSection(sectionFromView(prev), p)
        : { type: 'overview' }
    )
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

  function goLiveAgents() {
    setScope('global')
    setView({ type: 'agents-live' })
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
  const isGlobalLiveAgents = view.type === 'agents-live' && !view.project
  const isEditorialCore = isGlobalHome || isCoreProject || isGlobalLiveAgents

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
            project={selected ?? undefined}
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
        if (selected) setView({ type: 'project-agents', project: selected })
        else goGlobal()
        return null
      case 'agent-detail':
        return (
          <AgentDetailView
            agent={view.agent}
            project={selected ?? undefined}
            onBack={() => selected ? setView({ type: 'project-agents', project: selected }) : goGlobal()}
            onNavigateLive={selected ? () => setView({ type: 'agents-live', project: selected }) : undefined}
          />
        )
      case 'agent-create':
        return (
          <CreateAgentPage
            project={view.project}
            onBack={() => view.project ? setView({ type: 'project-agents', project: view.project }) : goGlobal()}
            onSaved={() => view.project ? setView({ type: 'project-agents', project: view.project }) : goGlobal()}
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
            onSelectProject={selectProject}
          />
        )
      case 'plugins':
        return (
          <PluginsView
            onBack={goGlobal}
            onSelectPlugin={plugin => setView({ type: 'plugin-detail', plugin })}
          />
        )
      case 'plugin-detail':
        return <PluginDetailView plugin={view.plugin} onBack={() => setView({ type: 'plugins' })} />
      case 'project-claudemd':
        return <ProjectClaudeMdView layer={view.layer} onBack={() => setView({ type: 'overview' })} />
      case 'chat':
        return (
          <ChatView
            project={view.project}
            session={view.session}
            onBack={() => view.from === 'agents-live'
              ? setView({ type: 'agents-live', project: view.project })
              : setView({ type: 'sessions', project: view.project })
            }
            onOpenSkill={skill => setView({ type: 'skill-detail', skill })}
            onOpenAgent={agent => setView({ type: 'agent-detail', agent })}
          />
        )
      case 'new-chat':
        return (
          <NewChatView
            project={view.project}
            onBack={() => setView({ type: 'sessions', project: view.project })}
            onCreated={session =>
              setView({ type: 'chat', project: view.project, session, from: 'sessions' })
            }
          />
        )
      case 'terminal':
        return (
          <TerminalMissionControl
            project={view.project}
            resumeSessionId={view.resumeSessionId}
            onBack={() => setView({ type: 'sessions', project: view.project })}
          />
        )
      case 'memory-topic':
        return (
          <MemoryTopicView
            topic={view.topic}
            content={view.content}
            hash={view.hash}
            onBack={() => selected ? setView({ type: 'project-memory', project: selected }) : goGlobal()}
            onOpenSession={selected
              ? session => setView({ type: 'chat', project: selected, session, from: 'sessions' })
              : undefined}
          />
        )
      case 'plan-detail':
        return (
          <PlanDetailView
            plan={view.plan}
            project={view.project}
            onBack={() => setView({ type: 'project-plans', project: view.project })}
          />
        )
      case 'analytics':
        return <AnalyticsView project={view.project} onBack={() => setView({ type: 'overview' })} />
      case 'ai-assistant':
        return <AiAssistantView project={view.project} onBack={() => setView({ type: 'overview' })} />
      case 'live-monitor':
        return <LiveMonitor project={view.project} onBack={() => setView({ type: 'overview' })} />
      // `agents-live` (project & global) is rendered inside the editorial chrome below.
      case 'duplicates':
        return <DuplicateProjectsView onBack={goGlobal} />
      case 'settings':
        return <SettingsView onBack={goGlobal} />
      default:
        return null
    }
  }

  // Deep views take over the full surface (preserve their existing chrome).
  // A boundary keyed by the view isolates a sub-view crash and auto-clears it on
  // navigation, instead of bubbling to the app-level boundary and resetting all state.
  if (!isEditorialCore) {
    return (
      <div className="cl-app">
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ErrorBoundary key={JSON.stringify(view)}>{renderDeepView()}</ErrorBoundary>
        </div>
        {projectToDelete && (
          <DeleteProjectDialog
            project={projectToDelete}
            isLoading={deleteProjectMutation.isPending}
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
          <button className={isGlobalHome ? 'on' : ''} onClick={goGlobal}>Global</button>
          <button className={scope === 'project' && !isGlobalLiveAgents ? 'on' : ''} onClick={goProjectScope}>Project</button>
          <button className={view.type === 'agents-live' && !view.project ? 'on' : ''} onClick={goLiveAgents}>Agent View</button>
        </nav>

        <div />

        <div className="cl-bar-right">
          <button
            ref={lensBtnRef}
            type="button"
            className={`cl-lens-btn${searchOpen && searchMode === 'global' ? ' on' : ''}`}
            onClick={() => searchOpen && searchMode === 'global' ? closeSearch() : openGlobalSearch()}
            aria-label="Search"
            title="Search"
          >
            <LensTriggerIcon />
          </button>
          <button
            className="cl-theme-toggle"
            type="button"
            onClick={() => setView({ type: 'settings' })}
            title="Settings"
            aria-label="Settings"
          >
            <SettingsGearIcon />
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
        <ErrorBoundary key={scope === 'project' ? `project:${selected?.hash ?? 'none'}` : view.type}>
          {isGlobalHome ? (
            <GlobalHomeView onNavigate={setView} onSelectProject={selectProject} />
          ) : isGlobalLiveAgents ? (
            <AgentsLiveView
              embedded
              onBack={goGlobal}
              onOpenSession={(project, session) => setView({ type: 'chat', project, session, from: 'agents-live' })}
            />
          ) : selected ? (
            <ProjectView
              key={selected.hash}
              project={selected}
              section={sectionFromView(view)}
              onNavigate={setView}
              onOpenProjectSearch={openProjectSearch}
            />
          ) : null}
        </ErrorBoundary>
      </div>

      {projectToDelete && (
        <DeleteProjectDialog
          project={projectToDelete}
          isLoading={deleteProjectMutation.isPending}
          onConfirm={() => handleConfirmDelete(projectToDelete)}
          onCancel={() => setProjectToDelete(null)}
        />
      )}

      <SearchPopover
        open={searchOpen}
        mode={searchMode}
        anchorRect={anchorRect}
        anchorAlign={searchAnchorAlign}
        projects={projects ?? []}
        costByHash={costByHash}
        currentHash={selected?.hash ?? null}
        pinned={pinned}
        skills={searchSkills}
        agents={searchAgents}
        mcpServers={searchMcpServers}
        mcpTotalProjects={mcpData?.totalProjects ?? projects?.length ?? 0}
        sessions={searchSessions}
        sessionsLoading={searchSessionsLoading}
        pinnedSessions={isSessionPinned}
        onTogglePin={togglePin}
        onToggleSessionPin={toggleSessionPin}
        onSelectProject={selectProject}
        onSelectSkill={skill => setView({ type: 'skill-detail', skill })}
        onSelectAgent={agent => setView({ type: 'agent-detail', agent })}
        onSelectMcp={server => setView({ type: 'mcp-detail', server, totalProjects: server.enabledInProjects + server.disabledInProjects })}
        onSelectSession={(project, session) => {
          setSelected(project)
          setScope('project')
          setView({ type: 'terminal', project, resumeSessionId: session.filename.replace(/\.jsonl$/, '') })
        }}
        onDeleteCurrent={setProjectToDelete}
        onClose={closeSearch}
      />
    </div>
  )
}
