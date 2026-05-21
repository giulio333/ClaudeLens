import { Agent } from '../../../hooks/useIPC'
import { FrontmatterPanel, FrontmatterFieldDef } from '../shared/FrontmatterPanel'

const AGENT_FIELDS: FrontmatterFieldDef<Agent>[] = [
  {
    key: 'model',
    label: 'Model',
    hint: 'Model to use: sonnet, opus, haiku or inherit (default)',
    resolve: a => a.model ?? null,
  },
  {
    key: 'tools',
    label: 'Tools',
    hint: 'Available tools. Inherits all if omitted',
    isArray: true,
    resolve: a => a.allowedTools?.length ? a.allowedTools : null,
  },
  {
    key: 'disallowedTools',
    label: 'Disallowed Tools',
    hint: 'Explicitly disallowed tools',
    isArray: true,
    resolve: a => a.disallowedTools?.length ? a.disallowedTools : null,
  },
  {
    key: 'permissionMode',
    label: 'Permission Mode',
    hint: 'default | acceptEdits | dontAsk | bypassPermissions | plan',
    resolve: a => a.permissionMode ?? null,
  },
  {
    key: 'maxTurns',
    label: 'Max Turns',
    hint: 'Maximum number of agentic turns before stopping',
    resolve: a => a.maxTurns != null ? String(a.maxTurns) : null,
  },
  {
    key: 'isolation',
    label: 'Isolation',
    hint: 'worktree = isolated copy of the repository in a temporary git worktree',
    resolve: a => a.isolation ?? null,
  },
  {
    key: 'memory',
    label: 'Memory',
    hint: 'user | project | local — scope of persistent memory',
    resolve: a => a.memory ?? null,
  },
  {
    key: 'skills',
    label: 'Skills',
    hint: 'Skills loaded in context at startup (full content injected)',
    isArray: true,
    resolve: a => a.skills?.length ? a.skills : null,
  },
  {
    key: 'mcpServers',
    label: 'MCP Servers',
    hint: 'MCP servers available for this subagent',
    isArray: true,
    resolve: a => a.mcpServers?.length ? a.mcpServers : null,
  },
  {
    key: 'background',
    label: 'Background',
    hint: 'If true, always executed as a background task',
    isBool: true,
    resolve: a => a.background ? 'Enabled' : null,
  },
]

export function AgentPropertiesPanel({ agent }: { agent: Agent }) {
  return <FrontmatterPanel entity={agent} fields={AGENT_FIELDS} filenameHint={`${agent.name}.md`} />
}
