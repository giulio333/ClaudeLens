import { useState } from 'react';
import {
  Skill,
  SkillFile,
  useWriteMarkdownFile,
  useDeleteMarkdownFile,
  useGlobalSkills,
  useAllSkills,
} from '../../../hooks/useIPC';
import { EntityDetailView, EntityConfig } from '../shared/EntityDetailView';
import { SKILL_OPTION_DEFS, readOptions, serializeSkill, initialOf } from '../shared/entityOptions';
import { SkillExplorer, SkillFileDetail } from './SkillBundle';

type Open = { kind: 'manifest' } | { kind: 'file'; file: SkillFile } | null;

export function SkillDetailView({
  skill: initialSkill,
  project,
  onBack,
  readOnly = false,
}: {
  skill: Skill;
  project?: { hash: string; realPath: string };
  onBack: () => void;
  readOnly?: boolean;
}) {
  const write = useWriteMarkdownFile(['skills:global', 'skills:all']);
  const del = useDeleteMarkdownFile(['skills:global', 'skills:all']);
  const { data: globalSkills } = useGlobalSkills();
  const { data: allSkills } = useAllSkills(project?.realPath ?? null);
  // Landing on the explorer; SKILL.md and supporting files are drills from it.
  const [open, setOpen] = useState<Open>(null);
  // Re-derive the fresh skill after a save: project skills live in `skills:all`
  // (scoped to the project), global skills in `skills:global`. Without the
  // project-scoped lookup, project skills always fell back to the stale prop.
  // Plugin skills live in neither cache, so they always fall back to the prop.
  const skill =
    allSkills?.find(s => s.path === initialSkill.path) ??
    globalSkills?.find(s => s.path === initialSkill.path) ??
    initialSkill;

  const back = () => setOpen(null);

  // Supporting-file drill: re-resolve against the fresh skill (sizes/list change
  // after a save); if it vanished from the bundle, fall back to the explorer.
  if (open?.kind === 'file') {
    const liveFile = skill.files?.find(f => f.relPath === open.file.relPath) ?? null;
    if (liveFile)
      return <SkillFileDetail skill={skill} file={liveFile} onBack={back} readOnly={readOnly} />;
  }

  if (open?.kind !== 'manifest') {
    return (
      <SkillExplorer
        skill={skill}
        onBack={onBack}
        onOpenManifest={() => setOpen({ kind: 'manifest' })}
        onOpenFile={file => setOpen({ kind: 'file', file })}
      />
    );
  }

  const scope =
    skill.scope === 'global' ? 'Global' : skill.scope === 'plugin' ? 'Plugin' : 'Project';

  const config: EntityConfig = {
    kind: 'skill',
    name: skill.name,
    titleGlyph: '.md',
    scopeLabel: scope,
    path: skill.path,
    description: skill.description,
    eyebrow: 'Skill · markdown manifest',
    kindLabel: 'skill',
    backLabel: skill.name,
    crumbs: [{ label: skill.name }, { label: 'SKILL.md', accent: true }],
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
    serialize: ({ body, description, options }) =>
      serializeSkill(skill, body, { description, options }),
    editable: !readOnly,
    deletable: !readOnly,
    duplicable: false,
    runnable: false,
  };

  return (
    <EntityDetailView
      config={config}
      onBack={back}
      onSave={
        readOnly
          ? undefined
          : async raw => {
              await write.mutateAsync({ filePath: skill.path, content: raw });
            }
      }
      onDelete={
        readOnly
          ? undefined
          : async () => {
              await del.mutateAsync({ filePath: skill.path, pruneEmptyDir: true });
              back();
            }
      }
    />
  );
}
