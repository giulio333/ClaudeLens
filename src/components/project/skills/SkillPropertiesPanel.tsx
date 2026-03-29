import { useState } from 'react'
import { Skill } from '../../../hooks/useIPC'

type SkillFieldDef = {
  key: string
  label: string
  hint: string
  isArray?: boolean
  isBool?: boolean
  resolve: (s: Skill) => string | string[] | null
}

const SKILL_FIELDS: SkillFieldDef[] = [
  {
    key: 'argument-hint',
    label: 'Argument Hint',
    hint: 'Hint shown in autocomplete — e.g. [filename] [format]',
    resolve: s => s.argumentHint ?? null,
  },
  {
    key: 'allowed-tools',
    label: 'Allowed Tools',
    hint: 'Tools Claude can use without requesting permission when the skill is active',
    isArray: true,
    resolve: s => s.allowedTools?.length ? s.allowedTools : null,
  },
  {
    key: 'model',
    label: 'Model',
    hint: 'Model to use when the skill is active — e.g. claude-sonnet-4-6',
    resolve: s => s.model ?? null,
  },
  {
    key: 'context',
    label: 'Context',
    hint: 'Set to "fork" to run in an isolated forked subagent',
    resolve: s => s.context ?? null,
  },
  {
    key: 'agent',
    label: 'Agent',
    hint: 'Type of subagent to use when context: fork is set',
    resolve: s => s.agent ?? null,
  },
  {
    key: 'disable-model-invocation',
    label: 'Model Invocation',
    hint: 'If true, Claude does not load the skill automatically — must be invoked with /name',
    isBool: true,
    resolve: s => s.disableModelInvocation ? 'Manual only' : null,
  },
  {
    key: 'user-invocable',
    label: 'User Invocable',
    hint: 'If false, the skill is hidden from the / menu — used only as background knowledge',
    isBool: true,
    resolve: s => s.userInvocable === false ? 'Hidden' : null,
  },
]

export function SkillPropertiesPanel({ skill }: { skill: Skill }) {
  const [showEmpty, setShowEmpty] = useState(false)
  const filled = SKILL_FIELDS.filter(f => f.resolve(skill) !== null)
  const empty  = SKILL_FIELDS.filter(f => f.resolve(skill) === null)

  const renderValue = (field: SkillFieldDef) => {
    const val = field.resolve(skill)
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
            {filled.length}/{SKILL_FIELDS.length}
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
          <code className="font-mono text-zinc-500">SKILL.md</code>{' '}
          to configure fields
        </p>
      </div>
    </aside>
  )
}
