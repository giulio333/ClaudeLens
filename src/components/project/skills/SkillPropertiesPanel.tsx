import { Skill } from '../../../hooks/useIPC'
import { FrontmatterPanel, FrontmatterFieldDef } from '../shared/FrontmatterPanel'

const SKILL_FIELDS: FrontmatterFieldDef<Skill>[] = [
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
  return <FrontmatterPanel entity={skill} fields={SKILL_FIELDS} filenameHint="SKILL.md" />
}
