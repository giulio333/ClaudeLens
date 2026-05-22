import { useState, useEffect } from 'react'
import { Agent, useWriteMarkdownFile, useGlobalAgents, useProjectAgents } from '../../../hooks/useIPC'
import { AgentPropertiesPanel } from './AgentPropertiesPanel'
import { MarkdownDocView } from '../shared/MarkdownDocView'

function ValidationNotice({ agent }: { agent: Agent }) {
  const warn = 'var(--cl-warn, #d97757)'
  const fields = agent.missingRequired
  return (
    <div
      style={{
        maxWidth: 820,
        paddingLeft: 18,
        borderLeft: `2px solid ${warn}`,
      }}
    >
      <div
        className="font-mono uppercase"
        style={{ fontSize: 10, letterSpacing: '0.18em', color: warn, marginBottom: 6 }}
      >
        Invalid agent definition
      </div>
      {fields.length > 0 && (
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--cl-ink-2)' }}>
          Missing required {fields.length > 1 ? 'fields' : 'field'}{' '}
          {fields.map((f, i) => (
            <span key={f}>
              <code className="font-mono" style={{ fontSize: 12.5, color: warn }}>{f}</code>
              {i < fields.length - 1 ? ', ' : ''}
            </span>
          ))}
          {' — '}this subagent may not be loaded correctly by Claude Code. Edit the file to add {fields.length > 1 ? 'them' : 'it'}.
        </p>
      )}
      {agent.filenameHasSpaces && (
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--cl-ink-2)' }}>
          The file name contains spaces — Claude Code requires agent file names without spaces. Rename the file (e.g.{' '}
          <code className="font-mono" style={{ fontSize: 12.5, color: warn }}>git-committer.md</code>) so this subagent is loaded correctly.
        </p>
      )}
    </div>
  )
}

export function AgentDetailView({ agent: initialAgent, project, onBack }: {
  agent: Agent
  project?: { hash: string; realPath: string }
  onBack: () => void
}) {
  const write = useWriteMarkdownFile(['agents:global', 'agents:project'])
  const { data: globalAgents } = useGlobalAgents()
  const { data: projectAgents } = useProjectAgents(project?.realPath ?? null)
  const fresh =
    globalAgents?.find(a => a.path === initialAgent.path) ??
    projectAgents?.find(a => a.path === initialAgent.path)
  const agent = fresh ?? initialAgent
  const [raw, setRaw] = useState(agent.rawContent)
  useEffect(() => { setRaw(agent.rawContent) }, [agent.rawContent])

  return (
    <MarkdownDocView
      onBack={onBack}
      backLabel="Agents"
      crumb={`${agent.scope} · ${agent.name}`}
      eyebrow={<>{agent.scope} · {agent.path}</>}
      titleLabel={agent.name}
      titleGlyph=".md"
      lead={agent.description || undefined}
      notice={agent.missingRequired.length > 0 || agent.filenameHasSpaces ? <ValidationNotice agent={agent} /> : undefined}
      content={raw}
      onSave={async next => {
        await write.mutateAsync({ filePath: agent.path, content: next })
        setRaw(next)
      }}
      sidebar={<AgentPropertiesPanel agent={agent} />}
    />
  )
}
