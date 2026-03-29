import { useState } from 'react'
import { useGlobalSkills, useAllSkills, Skill } from '../../../hooks/useIPC'
import { CreateSkillModal } from './CreateSkillModal'

function SkillRow({ skill, onClick }: { skill: Skill; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative w-full text-left group flex items-start gap-6 px-6 py-4 transition-all duration-200 border-b border-white/[0.035] last:border-0"
    >
      {/* Gradient sweep on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-r from-indigo-600/[0.07] via-indigo-600/[0.02] to-transparent pointer-events-none" />

      {/* Left accent — sempre visibile, si intensifica al hover */}
      <div className={`absolute left-0 top-3 bottom-3 w-[2px] rounded-full transition-all duration-200 ${
        skill.scope === 'project'
          ? 'bg-indigo-500/30 group-hover:bg-indigo-400/80'
          : 'bg-blue-500/20 group-hover:bg-blue-400/60'
      }`} />

      {/* Nome — elemento primario */}
      <div className="relative w-44 shrink-0">
        <span className="text-[13px] font-mono font-semibold tracking-tight text-zinc-300 group-hover:text-white transition-colors duration-150">
          /{skill.name}
        </span>
      </div>

      {/* Descrizione + argumentHint */}
      <div className="relative flex-1 min-w-0">
        {skill.description ? (
          <p className="text-[12px] leading-snug text-zinc-500 group-hover:text-zinc-300 transition-colors duration-150 line-clamp-2">
            {skill.description}
          </p>
        ) : (
          <p className="text-[12px] text-zinc-700 italic">—</p>
        )}
        {skill.argumentHint && (
          <code className="mt-1.5 block text-[10px] font-mono text-zinc-600 group-hover:text-zinc-500 transition-colors">
            {skill.argumentHint}
          </code>
        )}
      </div>

      {/* Tools + chevron */}
      <div className="relative flex items-start gap-2 shrink-0 pt-0.5">
        {skill.allowedTools && skill.allowedTools.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {skill.allowedTools.slice(0, 3).map(t => (
              <span
                key={t}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-violet-950/30 text-violet-400/60 ring-1 ring-violet-700/15 group-hover:text-violet-400/90 group-hover:ring-violet-700/30 transition-colors"
              >
                {t}
              </span>
            ))}
            {skill.allowedTools.length > 3 && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-zinc-900 text-zinc-600">
                +{skill.allowedTools.length - 3}
              </span>
            )}
          </div>
        )}
        <span className="text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all duration-150 text-[14px] leading-none mt-px">›</span>
      </div>
    </button>
  )
}

/* Chip compatta per skill globali nella vista progetto */
function GlobalSkillChip({ skill, onClick }: { skill: Skill; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111318] border border-white/[0.05] hover:border-indigo-500/25 hover:bg-[#14172280] transition-all duration-150"
    >
      <span className="text-[11px] font-mono text-zinc-600 group-hover:text-zinc-300 transition-colors duration-150">
        /{skill.name}
      </span>
      {skill.allowedTools && skill.allowedTools.length > 0 && (
        <span className="text-[9px] text-zinc-700 group-hover:text-zinc-500 transition-colors">
          · {skill.allowedTools.length}
        </span>
      )}
    </button>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 px-6 pt-5 pb-3">
      <span className="text-[9px] font-bold tracking-[0.16em] uppercase text-zinc-500">{label}</span>
      <span className="text-[9px] font-semibold tabular-nums text-zinc-600 bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
        {count}
      </span>
      <div className="flex-1 h-px bg-white/[0.04]" />
    </div>
  )
}

export function GlobalSkillsView({
  onBack,
  onSelectSkill,
  onNavigateGlobalSkills,
  project,
}: {
  onBack: () => void
  onSelectSkill: (skill: Skill) => void
  onNavigateGlobalSkills?: () => void
  project?: { hash: string; realPath: string }
}) {
  const projectName = project?.realPath.split('/').pop()
  const { data: globalSkills, isLoading: loadingGlobal } = useGlobalSkills()
  const { data: allSkills, isLoading: loadingAll } = useAllSkills(project?.realPath ?? null)

  const skills = project ? allSkills : globalSkills
  const isLoading = project ? loadingAll : loadingGlobal

  const [showCreate, setShowCreate] = useState(false)

  const projectSkills = (skills ?? []).filter(s => s.scope === 'project')
  const onlyGlobalSkills = (skills ?? []).filter(s => s.scope === 'global')

  return (
    <div className="h-full bg-[#0d0f14] flex flex-col">
      {showCreate && (
        <CreateSkillModal onClose={() => setShowCreate(false)} onCreated={() => setShowCreate(false)} />
      )}

      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.04] px-6 py-3.5 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          <span className="text-[10px]">←</span>
          Back
        </button>
        <span className="text-zinc-800 text-[11px]">/</span>
        <h1 className="text-[13px] font-semibold text-zinc-200">
          {project ? `Skills — ${projectName}` : 'Global Skills'}
        </h1>

        <div className="ml-auto flex items-center gap-3">
          {skills && skills.length > 0 && (
            <span className="text-[11px] tabular-nums text-zinc-600">
              {skills.length} skill{skills.length !== 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-600/90 text-white hover:bg-indigo-500 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            New Skill
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="px-6 py-8 text-[12px] text-zinc-600">Loading...</div>
        ) : !skills || skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <p className="text-[13px] text-zinc-500">No skills found</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Add <code className="font-mono text-zinc-500">*.md</code> files in{' '}
              <code className="font-mono text-zinc-500">~/.claude/skills/</code>
            </p>
          </div>
        ) : project ? (
          /* ── Vista progetto: righe per skill di progetto, chips per globali ── */
          <div>
            {projectSkills.length > 0 && (
              <div>
                <SectionHeader label="This project" count={projectSkills.length} />
                <div>
                  {projectSkills.map(skill => (
                    <SkillRow key={skill.name} skill={skill} onClick={() => onSelectSkill(skill)} />
                  ))}
                </div>
              </div>
            )}

            {onlyGlobalSkills.length > 0 && (
              <div className="mt-4 mb-6">
                <div className="flex items-center gap-3 px-6 pt-4 pb-3">
                  <span className="text-[9px] font-bold tracking-[0.16em] uppercase text-zinc-700">Global</span>
                  <span className="text-[9px] font-semibold tabular-nums text-zinc-700 bg-zinc-900 px-1.5 py-0.5 rounded-full">
                    {onlyGlobalSkills.length}
                  </span>
                  <div className="flex-1 h-px bg-white/[0.03]" />
                  {onNavigateGlobalSkills && (
                    <button
                      onClick={onNavigateGlobalSkills}
                      className="text-[10px] text-zinc-700 hover:text-indigo-400 transition-colors flex items-center gap-1"
                    >
                      Open Global Skills
                      <span className="text-[11px]">→</span>
                    </button>
                  )}
                </div>
                <div className="px-6 flex flex-wrap gap-2">
                  {onlyGlobalSkills.map(skill => (
                    <GlobalSkillChip
                      key={skill.name}
                      skill={skill}
                      onClick={() => onSelectSkill(skill)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Vista globale: lista righe piena ── */
          <div className="pt-1">
            {skills.map(skill => (
              <SkillRow key={skill.name} skill={skill} onClick={() => onSelectSkill(skill)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
