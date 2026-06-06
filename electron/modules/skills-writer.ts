import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { CLAUDE_DIR, validateEntityName, assertWithin } from '../utils';

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
  const lines: string[] = ['---'];

  if (input.description) lines.push(`description: ${input.description}`);
  if (input.argumentHint) lines.push(`argument-hint: ${input.argumentHint}`);
  if (input.disableModelInvocation !== undefined) lines.push(`disable-model-invocation: ${input.disableModelInvocation}`);
  if (input.userInvocable !== undefined) lines.push(`user-invocable: ${input.userInvocable}`);
  if (input.allowedTools && input.allowedTools.length > 0) lines.push(`allowed-tools: [${input.allowedTools.join(', ')}]`);
  if (input.model) lines.push(`model: ${input.model}`);
  if (input.context) lines.push(`context: ${input.context}`);
  if (input.agent) lines.push(`agent: ${input.agent}`);

  lines.push('---');
  lines.push('');
  lines.push(input.content);

  return lines.join('\n');
}

export function createSkill(input: SkillInput, projectPath?: string): string {
  const name = validateEntityName(input.name);
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
