import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { CLAUDE_DIR, validateEntityName, assertWithin } from '../utils';
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
  const skillsDir = join(projectPath ? join(projectPath, '.claude') : CLAUDE_DIR, 'skills');
  const skillDir = join(skillsDir, name);
  // Anchor containment on a trusted root (home): skillsDir is derived from the
  // renderer-supplied projectPath, so the assertWithin(skillsDir, …) alone can't
  // stop an absolute projectPath redirecting the write outside the user's tree.
  assertWithin(os.homedir(), skillDir);
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
