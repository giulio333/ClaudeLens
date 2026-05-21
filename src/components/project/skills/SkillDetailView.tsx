import { useState, useEffect } from 'react'
import { Skill, useWriteMarkdownFile, useGlobalSkills } from '../../../hooks/useIPC'
import { SkillPropertiesPanel } from './SkillPropertiesPanel'
import { MarkdownDocView } from '../shared/MarkdownDocView'

export function SkillDetailView({ skill: initialSkill, onBack }: { skill: Skill; onBack: () => void }) {
  const write = useWriteMarkdownFile(['skills:global', 'skills:all'])
  const { data: globalSkills } = useGlobalSkills()
  const fresh = globalSkills?.find(s => s.path === initialSkill.path)
  const skill = fresh ?? initialSkill
  const [raw, setRaw] = useState(skill.rawContent)
  useEffect(() => { setRaw(skill.rawContent) }, [skill.rawContent])

  return (
    <MarkdownDocView
      onBack={onBack}
      backLabel="Skills"
      crumb={`${skill.scope} · ${skill.name}`}
      eyebrow={<>{skill.scope} · {skill.path}</>}
      titleLabel={skill.name}
      titleGlyph=".md"
      lead={skill.description || undefined}
      content={raw}
      onSave={async next => {
        await write.mutateAsync({ filePath: skill.path, content: next })
        setRaw(next)
      }}
      sidebar={<SkillPropertiesPanel skill={skill} />}
    />
  )
}
