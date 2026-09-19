import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { CLAUDE_DIR, validateEntityName, assertWithin, assertKnownProjectPath } from '../utils';
import { SKILL_FIELDS, emitFields } from './entity-fields';

export interface SkillInput {
  name: string;
  content: string;
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  context?: string;
  agent?: string;
}

function buildSkillMarkdown(input: SkillInput): string {
  // A skill's name is its directory, not a frontmatter field, so the block is
  // emitted (and quoted) entirely from the shared SKILL_FIELDS registry.
  const lines = [
    '---',
    ...emitFields(input as unknown as Record<string, unknown>, SKILL_FIELDS),
    '---',
    '',
    input.content,
  ];
  return lines.join('\n');
}

export function createSkill(input: SkillInput, projectPath?: string): string {
  const name = validateEntityName(input.name);
  // skillsDir is derived from the renderer-supplied projectPath, so
  // assertWithin(skillsDir, …) alone can't stop an absolute projectPath from
  // redirecting the write: the path itself has to be one the registry knows.
  // Without a projectPath the root is CLAUDE_DIR, which nothing supplied.
  if (projectPath) assertKnownProjectPath(projectPath);
  const skillsDir = join(projectPath ? join(projectPath, '.claude') : CLAUDE_DIR, 'skills');
  const skillDir = join(skillsDir, name);
  assertWithin(skillsDir, skillDir);
  if (existsSync(join(skillDir, 'SKILL.md'))) {
    throw new Error(`A skill named "${name}" already exists.`);
  }
  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true });
  }
  const filePath = join(skillDir, 'SKILL.md');
  writeFileSync(filePath, buildSkillMarkdown(input), 'utf-8');
  return filePath;
}
