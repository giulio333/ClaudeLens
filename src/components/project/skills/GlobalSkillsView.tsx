import { useGlobalSkills, useAllSkills, Skill } from '../../../hooks/useIPC'
import { Lens } from '../overview/Lens'
import { TopBar } from '../shared/TopBar'
import { projectDisplayName } from '../shared/projectName'

function SkillTile({ skill, index, onClick }: { skill: Skill; index: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`cl-tile ${index === 0 ? 'accent' : ''}`}
      onClick={onClick}
    >
      <span className="glyph">{(skill.name[0] ?? '?').toUpperCase()}</span>
      <div style={{ minWidth: 0 }}>
        <div className="t-name">/{skill.name}</div>
        <div className="t-desc">{skill.description || '—'}</div>
      </div>
      <span className="t-meta"><b>{skill.scope}</b></span>
    </button>
  )
}

export function GlobalSkillsView({
  onBack,
  onSelectSkill,
  onNavigateGlobalSkills,
  onCreate,
  project,
}: {
  onBack: () => void
  onSelectSkill: (skill: Skill) => void
  onNavigateGlobalSkills?: () => void
  onCreate: () => void
  project?: { hash: string; realPath: string }
}) {
  const projectName = project ? projectDisplayName(project.realPath) : undefined
  const { data: globalSkills, isLoading: loadingGlobal } = useGlobalSkills()
  const { data: allSkills, isLoading: loadingAll } = useAllSkills(project?.realPath ?? null)

  const skills = project ? allSkills : globalSkills
  const isLoading = project ? loadingAll : loadingGlobal

  const projectSkills = (skills ?? []).filter(s => s.scope === 'project')
  const onlyGlobalSkills = (skills ?? []).filter(s => s.scope === 'global')
  const total = skills?.length ?? 0

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: project ? `Project · Skills · ${projectName}` : 'Global · Skills' }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-hero-actions">
            <button type="button" className="cl-btn cl-btn--primary" onClick={onCreate}>
              + New Skill
            </button>
          </div>
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>{project ? `Project · ${projectName} · skills` : 'Global · ~/.claude/skills'}</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Skills</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span><b>{total}</b> {total === 1 ? 'skill' : 'skills'}</span>
            <span className="sep">·</span>
            <span>reusable behaviors</span>
            {project && onlyGlobalSkills.length > 0 && (
              <>
                <span className="sep">·</span>
                <span><b>{projectSkills.length}</b> project · <b>{onlyGlobalSkills.length}</b> global</span>
              </>
            )}
          </div>
        </section>

        {isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : total === 0 ? (
          <section className="cl-section">
            <div className="cl-empty">
              No skills found. Add <code style={{ fontFamily: 'var(--font-mono)' }}>*.md</code> files in{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>~/.claude/skills/</code>.
            </div>
          </section>
        ) : project ? (
          <>
            {projectSkills.length > 0 && (
              <section className="cl-section">
                <div className="cl-sec-head">
                  <h2>This project</h2>
                  <span className="ct">{projectSkills.length} project-scoped</span>
                </div>
                <div className="cl-tile-grid cl-tile-grid--list">
                  {projectSkills.map((s, i) => (
                    <SkillTile key={s.path} skill={s} index={i} onClick={() => onSelectSkill(s)} />
                  ))}
                </div>
              </section>
            )}
            {onlyGlobalSkills.length > 0 && (
              <section className="cl-section">
                <div className="cl-sec-head">
                  <h2>Global</h2>
                  <span className="ct">{onlyGlobalSkills.length} shared across projects</span>
                  {onNavigateGlobalSkills && (
                    <button className="all" type="button" onClick={onNavigateGlobalSkills}>
                      Open Global Skills
                    </button>
                  )}
                </div>
                <div className="cl-tile-grid cl-tile-grid--list">
                  {onlyGlobalSkills.map((s, i) => (
                    <SkillTile key={s.path} skill={s} index={i} onClick={() => onSelectSkill(s)} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="cl-section">
            <div className="cl-tile-grid cl-tile-grid--list">
              {(skills ?? []).map((s, i) => (
                <SkillTile key={s.path} skill={s} index={i} onClick={() => onSelectSkill(s)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
