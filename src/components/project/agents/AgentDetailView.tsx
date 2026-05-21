import { useState, useEffect } from 'react'
import { Agent, useWriteMarkdownFile, useGlobalAgents } from '../../../hooks/useIPC'
import { AgentPropertiesPanel } from './AgentPropertiesPanel'
import { MarkdownDocView } from '../shared/MarkdownDocView'

export function AgentDetailView({ agent: initialAgent, onBack }: { agent: Agent; onBack: () => void }) {
  const write = useWriteMarkdownFile(['agents:global', 'agents:project'])
  const { data: globalAgents } = useGlobalAgents()
  const fresh = globalAgents?.find(a => a.path === initialAgent.path)
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
      content={raw}
      onSave={async next => {
        await write.mutateAsync({ filePath: agent.path, content: next })
        setRaw(next)
      }}
      sidebar={<AgentPropertiesPanel agent={agent} />}
    />
  )
}
