import { ReactNode } from 'react'
import {
  Agent,
  useWriteMarkdownFile,
  useDeleteMarkdownFile,
  useGlobalAgents,
  useProjectAgents,
  useDispatchBackgroundAgent,
} from '../../../hooks/useIPC'
import { EntityDetailView, EntityConfig } from '../shared/EntityDetailView'
import {
  AGENT_OPTION_DEFS,
  readOptions,
  serializeAgent,
  initialOf,
} from '../shared/entityOptions'
import { RunAgentDialog } from './RunAgentDialog'

export function AgentDetailView({ agent: initialAgent, project, onBack, onNavigateLive, readOnly = false }: {
  agent: Agent
  project?: { hash: string; realPath: string }
  onBack: () => void
  /** Navigate to Live Agents (project-scoped) after dispatching a run. */
  onNavigateLive?: () => void
  /** Plugin agents are read-only (managed by the plugin manager). */
  readOnly?: boolean
}) {
  const write = useWriteMarkdownFile(['agents:global', 'agents:project'])
  const del = useDeleteMarkdownFile(['agents:global', 'agents:project'])
  const dispatchBg = useDispatchBackgroundAgent()
  const { data: globalAgents } = useGlobalAgents()
  const { data: projectAgents } = useProjectAgents(project?.realPath ?? null)
  const fresh =
    globalAgents?.find(a => a.path === initialAgent.path) ??
    projectAgents?.find(a => a.path === initialAgent.path)
  const agent = fresh ?? initialAgent

  const invalid = agent.missingRequired.length > 0 || agent.filenameHasSpaces
  const scope = agent.scope === 'global' ? 'Global' : agent.scope === 'plugin' ? 'Plugin' : 'Project'
  const canRun = !readOnly && !!project && !!onNavigateLive

  const config: EntityConfig = {
    kind: 'agent',
    name: agent.name,
    titleGlyph: '.md',
    scopeLabel: scope,
    path: agent.path,
    description: agent.description,
    eyebrow: 'Agent · markdown manifest',
    kindLabel: 'agent',
    backLabel: 'Agents',
    crumbs: [{ label: scope }, { label: agent.name, accent: true }],
    color: agent.color,
    initial: initialOf(agent.name),
    tape: [
      { label: 'Scope', value: scope },
      { label: 'Model', value: agent.model || 'inherit', mono: true },
      { label: 'Color', value: agent.color || 'default', colorName: true },
      { label: 'Status', value: invalid ? 'Invalid' : 'Enabled', status: true, warn: invalid },
    ],
    bodyLabel: 'System prompt · markdown body',
    optionDefs: AGENT_OPTION_DEFS,
    initialOptions: readOptions(agent as unknown as Record<string, unknown>, AGENT_OPTION_DEFS),
    body: agent.content,
    hasDescriptionField: true,
    descriptionValue: agent.description ?? '',
    coreRows: [
      { label: 'name', value: agent.name },
      { label: 'scope', value: agent.scope },
    ],
    serialize: ({ body, description, options }) =>
      serializeAgent(agent, body, { description, options }),
    editable: !readOnly,
    deletable: !readOnly,
    duplicable: false,
    runnable: canRun,
    validation: invalid
      ? {
          title: 'Invalid agent definition',
          messages: [
            agent.missingRequired.length > 0 && (
              <>
                Missing required {agent.missingRequired.length > 1 ? 'fields' : 'field'}{' '}
                {agent.missingRequired.map((f, i) => (
                  <span key={f}>
                    <code className="font-mono" style={{ fontSize: 12, color: 'var(--cl-warn)' }}>{f}</code>
                    {i < agent.missingRequired.length - 1 ? ', ' : ''}
                  </span>
                ))}
                {' — '}this subagent may not be loaded correctly by Claude Code.
              </>
            ),
            agent.filenameHasSpaces && (
              <>
                The file name contains spaces — rename the file (e.g.{' '}
                <code className="font-mono" style={{ fontSize: 12, color: 'var(--cl-warn)' }}>{agent.name}.md</code>) so it loads correctly.
              </>
            ),
          ].filter(Boolean) as ReactNode[],
        }
      : undefined,
  }

  return (
    <EntityDetailView
      config={config}
      onBack={onBack}
      onSave={readOnly ? undefined : async raw => { await write.mutateAsync({ filePath: agent.path, content: raw }) }}
      onDelete={readOnly ? undefined : async () => { await del.mutateAsync({ filePath: agent.path }) }}
      renderRunOverlay={
        canRun
          ? ({ onClose }) => (
              <RunAgentDialog
                agent={agent}
                project={project!}
                onClose={onClose}
                onSubmit={async ({ prompt, sessionName }) => {
                  await dispatchBg.mutateAsync({
                    cwd: project!.realPath,
                    prompt,
                    name: sessionName,
                    agent: agent.name,
                  })
                  onNavigateLive!()
                }}
              />
            )
          : undefined
      }
    />
  )
}
