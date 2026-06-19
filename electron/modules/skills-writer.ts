import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { CLAUDE_DIR, validateEntityName, assertWithin } from '../utils';
import { yamlScalar } from './frontmatter';

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
  // Quote each scalar/list entry so a value with a colon, '#', etc. can't break
  // the YAML block (which would make the reader drop ALL frontmatter on load).
  const list = (arr: string[]) => `[${arr.map(yamlScalar).join(', ')}]`;

  if (input.description) lines.push(`description: ${yamlScalar(input.description)}`);
  if (input.argumentHint) lines.push(`argument-hint: ${yamlScalar(input.argumentHint)}`);
  if (input.disableModelInvocation !== undefined) lines.push(`disable-model-invocation: ${input.disableModelInvocation}`);
  if (input.userInvocable !== undefined) lines.push(`user-invocable: ${input.userInvocable}`);
  if (input.allowedTools && input.allowedTools.length > 0) lines.push(`allowed-tools: ${list(input.allowedTools)}`);
  if (input.model) lines.push(`model: ${yamlScalar(input.model)}`);
  if (input.context) lines.push(`context: ${yamlScalar(input.context)}`);
  if (input.agent) lines.push(`agent: ${yamlScalar(input.agent)}`);

  lines.push('---');
  lines.push('');
  lines.push(input.content);

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
