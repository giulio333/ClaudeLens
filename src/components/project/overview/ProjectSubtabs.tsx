import { useMemo } from 'react'
import {
  useSessionList,
  useMemoryProject,
  useAllSkills,
  useProjectAgents,
  useGlobalAgents,
  useGlobalMcp,
  useLiveSessions,
  useProjectTasks,
  useProjectPlans,
} from '../../../hooks/useIPC'
import { View } from '../types'
import type { ProjectSection } from './ProjectOverviewContent'

type Project = { hash: string; realPath: string }

export function ProjectSubtabs({
  project,
  active,
  onNavigate,
}: {
  project: Project
  active: ProjectSection
  onNavigate: (v: View) => void
}) {
  const { data: sessions = [] } = useSessionList(project.hash)
  const { data: memory } = useMemoryProject(project.hash)
  const { data: skills = [] } = useAllSkills(project.realPath)
  const { data: projectAgents = [] } = useProjectAgents(project.realPath)
  const { data: globalAgents = [] } = useGlobalAgents()
  const { data: mcpData } = useGlobalMcp()
  const { data: liveSessions = [] } = useLiveSessions()
  const { data: taskGroups = [] } = useProjectTasks(project.hash)
  const { data: planGroups = [] } = useProjectPlans(project.hash)

  const memoryCount = (memory?.index.length ?? 0) + (memory?.projectLevelIndex.length ?? 0)
  const agentCount = useMemo(
    () => new Set([...projectAgents.map(a => a.name), ...globalAgents.map(a => a.name)]).size,
    [projectAgents, globalAgents],
  )
  const mcpCount = useMemo(() => {
    const all = [...(mcpData?.cloudServers ?? []), ...(mcpData?.localServers ?? [])]
    return all.filter(s => !s.disabledProjectPaths.includes(project.realPath)).length
  }, [mcpData, project.realPath])
  const liveCount = useMemo(
    () => liveSessions.filter(s =>
      s.cwd === project.realPath || s.cwd.startsWith(project.realPath + '/'),
    ).length,
    [liveSessions, project.realPath],
  )
  const taskCount = useMemo(
    () => taskGroups.reduce((n, g) => n + g.tasks.length, 0),
    [taskGroups],
  )
  const planCount = useMemo(
    () => planGroups.reduce((n, g) => n + g.plans.length, 0),
    [planGroups],
  )

  const tabs: { key: ProjectSection; label: string; count?: number; view: View }[] = [
    { key: 'overview', label: 'Overview', view: { type: 'overview' } },
    { key: 'sessions', label: 'Sessions', count: sessions.length, view: { type: 'sessions', project } },
    { key: 'memory', label: 'Memory', count: memoryCount, view: { type: 'project-memory', project } },
    { key: 'skills', label: 'Skills', count: skills.length, view: { type: 'project-skills', project } },
    { key: 'agents', label: 'Agents', count: agentCount, view: { type: 'project-agents', project } },
    { key: 'mcp', label: 'MCP', count: mcpCount, view: { type: 'project-mcp', project } },
    { key: 'live-agents', label: 'Agent View', count: liveCount, view: { type: 'agents-live', project } },
    { key: 'tasks', label: 'Tasks', count: taskCount, view: { type: 'project-tasks', project } },
    { key: 'plans', label: 'Plans', count: planCount, view: { type: 'project-plans', project } },
  ]

  return (
    <nav className="cl-subtabs">
      {tabs.map(t => (
        <button
          key={t.key}
          type="button"
          className={`cl-subtab ${active === t.key ? 'on' : ''}`}
          onClick={() => onNavigate(t.view)}
        >
          {t.label}
          {t.count !== undefined && <span className="ct">{t.count}</span>}
        </button>
      ))}
    </nav>
  )
}
