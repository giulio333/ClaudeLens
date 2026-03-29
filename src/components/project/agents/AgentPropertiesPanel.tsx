import { useState } from 'react'
import { Agent } from '../../../hooks/useIPC'

type AgentFieldDef = {
  key: string
  label: string
  hint: string
  isArray?: boolean
  isBool?: boolean
  resolve: (a: Agent) => string | string[] | null
}

const AGENT_FIELDS: AgentFieldDef[] = [
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
  const [showEmpty, setShowEmpty] = useState(false)
  const filled = AGENT_FIELDS.filter(f => f.resolve(agent) !== null)
  const empty  = AGENT_FIELDS.filter(f => f.resolve(agent) === null)

  const renderValue = (field: AgentFieldDef) => {
    const val = field.resolve(agent)
    if (val === null) return null

    if (field.isArray && Array.isArray(val)) {
      return (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {val.map(item => (
            <code key={item} className="px-1.5 py-0.5 rounded-md bg-violet-950/20 text-violet-400 text-[10px] font-mono font-medium ring-1 ring-violet-700/30">
              {item}
            </code>
          ))}
        </div>
      )
    }

    if (field.isBool) {
      return (
        <div className="mt-1.5">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-950/20 text-amber-400 text-[10px] font-semibold ring-1 ring-amber-700/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            {val}
          </span>
        </div>
      )
    }

    return (
      <code className="mt-1.5 block text-[11px] font-mono text-[#9096b0] bg-[#0d0f14] px-2 py-1 rounded-md ring-1 ring-[#252836]">
        {val}
      </code>
    )
  }

  return (
    <aside className="w-56 shrink-0 border-l border-[#252836] bg-[#0d0f14]/60 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[#252836]/70 flex items-center justify-between">
        <span className="text-[9px] font-bold tracking-[0.14em] uppercase text-zinc-400">
          Frontmatter
        </span>
        {filled.length > 0 && (
          <span className="text-[9px] font-semibold text-zinc-400 bg-zinc-200 px-1.5 py-0.5 rounded-full">
            {filled.length}/{AGENT_FIELDS.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filled.length === 0 ? (
          <div className="px-4 py-5 text-center">
            <p className="text-[11px] text-zinc-400 leading-snug">
              No fields configured in frontmatter
            </p>
          </div>
        ) : (
          <div className="py-2">
            {filled.map(field => (
              <div key={field.key} className="px-4 py-2.5">
                <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                  {field.label}
                </div>
                {renderValue(field)}
              </div>
            ))}
          </div>
        )}

        {empty.length > 0 && (
          <>
            <div className="mx-4 border-t border-[#252836]/70" />
            <button
              onClick={() => setShowEmpty(v => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-[#1c2133]/60 transition-colors"
            >
              <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
                Available options
              </span>
              <span className="text-[9px] text-zinc-400">{showEmpty ? '▲' : '▼'}</span>
            </button>
            {showEmpty && (
              <div className="pb-2">
                {empty.map(field => (
                  <div key={field.key} className="px-4 py-2">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400 mb-0.5">
                      {field.label}
                    </div>
                    <p className="text-[10px] text-zinc-400 leading-snug">{field.hint}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-[#252836]/70 px-4 py-2.5">
        <p className="text-[9px] text-zinc-400 leading-snug">
          Edit{' '}
          <code className="font-mono text-zinc-500">{agent.name}.md</code>{' '}
          to configure fields
        </p>
      </div>
    </aside>
  )
}
