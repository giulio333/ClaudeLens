import {
  Agent,
  useWriteMarkdownFile,
  useGlobalAgents,
  useProjectAgents,
  useDispatchBackgroundAgent,
} from '../../../hooks/useIPC'
import { AgentDetailViewV2 } from './AgentDetailViewV2'

export function AgentDetailView({ agent: initialAgent, project, onBack, onNavigateLive }: {
  agent: Agent
  project?: { hash: string; realPath: string }
  onBack: () => void
  /** Navigate to Live Agents (project-scoped) after dispatching a run. Only passed when in a project context. */
  onNavigateLive?: () => void
}) {
  const write = useWriteMarkdownFile(['agents:global', 'agents:project'])
  const dispatchBg = useDispatchBackgroundAgent()
  const { data: globalAgents } = useGlobalAgents()
  const { data: projectAgents } = useProjectAgents(project?.realPath ?? null)
  const fresh =
    globalAgents?.find(a => a.path === initialAgent.path) ??
    projectAgents?.find(a => a.path === initialAgent.path)
  const agent = fresh ?? initialAgent

  return (
    <AgentDetailViewV2
      agent={agent}
      project={project}
      onBack={onBack}
      onSave={async raw => {
        await write.mutateAsync({ filePath: agent.path, content: raw })
      }}
      onDispatchRun={
        project && onNavigateLive
          ? async ({ prompt, sessionName }) => {
              await dispatchBg.mutateAsync({
                cwd: project.realPath,
                prompt,
                name: sessionName,
                agent: agent.name,
              })
              onNavigateLive()
            }
          : undefined
      }
    />
  )
}
