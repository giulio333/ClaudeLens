import { Skill, useWriteMarkdownFile, useDeleteMarkdownFile, useGlobalSkills } from '../../../hooks/useIPC'
import { EntityDetailView, EntityConfig } from '../shared/EntityDetailView'
import { SKILL_OPTION_DEFS, readOptions, serializeSkill, initialOf } from '../shared/entityOptions'

export function SkillDetailView({ skill: initialSkill, onBack }: { skill: Skill; onBack: () => void }) {
  const write = useWriteMarkdownFile(['skills:global', 'skills:all'])
  const del = useDeleteMarkdownFile(['skills:global', 'skills:all'])
  const { data: globalSkills } = useGlobalSkills()
  const skill = globalSkills?.find(s => s.path === initialSkill.path) ?? initialSkill

  const scope = skill.scope === 'global' ? 'Global' : 'Project'

  const config: EntityConfig = {
    kind: 'skill',
    name: skill.name,
    titleGlyph: '.md',
    scopeLabel: scope,
    path: skill.path,
    description: skill.description,
    eyebrow: 'Skill · markdown manifest',
    kindLabel: 'skill',
    backLabel: 'Skills',
    crumbs: [{ label: scope }, { label: skill.name, accent: true }],
    neutralTint: true,
    initial: initialOf(skill.name),
    tape: [
      { label: 'Scope', value: scope },
      { label: 'Model', value: skill.model || 'inherit', mono: true },
    ],
    bodyLabel: 'Skill body · markdown',
    optionDefs: SKILL_OPTION_DEFS,
    initialOptions: readOptions(skill as unknown as Record<string, unknown>, SKILL_OPTION_DEFS),
    body: skill.content,
    hasDescriptionField: true,
    descriptionValue: skill.description ?? '',
    coreRows: [
      { label: 'name', value: skill.name },
      { label: 'scope', value: skill.scope },
    ],
    serialize: ({ body, description, options }) => serializeSkill(skill, body, { description, options }),
    editable: true,
    deletable: true,
    duplicable: false,
    runnable: false,
  }

  return (
    <EntityDetailView
      config={config}
      onBack={onBack}
      onSave={async raw => { await write.mutateAsync({ filePath: skill.path, content: raw }) }}
      onDelete={async () => { await del.mutateAsync({ filePath: skill.path, pruneEmptyDir: true }) }}
    />
  )
}
