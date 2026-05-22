import { Agent } from '../../../hooks/useIPC'
import { FrontmatterPanel, FrontmatterFieldDef } from '../shared/FrontmatterPanel'

const AGENT_FIELDS: FrontmatterFieldDef<Agent>[] = [
  {
    key: 'model',
    label: 'Model',
    hint: 'Model to use: sonnet, opus, haiku, a full model ID (e.g. claude-opus-4-7), or inherit. Defaults to inherit.',
    resolve: a => a.model ?? null,
  },
  {
    key: 'tools',
    label: 'Tools',
    hint: 'Tools the subagent can use. Inherits all tools if omitted. To preload Skills, use the skills field rather than listing Skill here.',
    isArray: true,
    resolve: a => a.allowedTools?.length ? a.allowedTools : null,
  },
  {
    key: 'disallowedTools',
    label: 'Disallowed Tools',
    hint: 'Tools to deny, removed from the inherited or specified list.',
    isArray: true,
    resolve: a => a.disallowedTools?.length ? a.disallowedTools : null,
  },
  {
    key: 'permissionMode',
    label: 'Permission Mode',
    hint: 'Permission mode: default, acceptEdits, auto, dontAsk, bypassPermissions, or plan. Ignored for plugin subagents.',
    resolve: a => a.permissionMode ?? null,
  },
  {
    key: 'maxTurns',
    label: 'Max Turns',
    hint: 'Maximum number of agentic turns before the subagent stops.',
    resolve: a => a.maxTurns != null ? String(a.maxTurns) : null,
  },
  {
    key: 'isolation',
    label: 'Isolation',
    hint: 'Set to worktree to run the subagent in a temporary git worktree with an isolated copy of the repository. Auto-cleaned if no changes are made.',
    resolve: a => a.isolation ?? null,
  },
  {
    key: 'memory',
    label: 'Memory',
    hint: 'Persistent memory scope: user, project, or local. Enables cross-session learning.',
    resolve: a => a.memory ?? null,
  },
  {
    key: 'skills',
    label: 'Skills',
    hint: 'Skills to preload into the subagent’s context at startup. The full skill content is injected, not just the description.',
    isArray: true,
    resolve: a => a.skills?.length ? a.skills : null,
  },
  {
    key: 'mcpServers',
    label: 'MCP Servers',
    hint: 'MCP servers available to this subagent. Each entry references an already-configured server (e.g. slack) or an inline definition. Ignored for plugin subagents.',
    isArray: true,
    resolve: a => a.mcpServers?.length ? a.mcpServers : null,
  },
  {
    key: 'effort',
    label: 'Effort',
    hint: 'Effort level when this subagent is active. Overrides the session effort level. Options: low, medium, high, xhigh, max (availability depends on the model). Defaults to inherit.',
    resolve: a => a.effort ?? null,
  },
  {
    key: 'color',
    label: 'Color',
    hint: 'Display color for the subagent in the task list and transcript: red, blue, green, yellow, purple, orange, pink, or cyan.',
    resolve: a => a.color ?? null,
  },
  {
    key: 'background',
    label: 'Background',
    hint: 'Set to true to always run this subagent as a background task. Default: false.',
    isBool: true,
    resolve: a => a.background ? 'Enabled' : null,
  },
]

export function AgentPropertiesPanel({ agent }: { agent: Agent }) {
  return <FrontmatterPanel entity={agent} fields={AGENT_FIELDS} filenameHint={`${agent.name}.md`} />
}
