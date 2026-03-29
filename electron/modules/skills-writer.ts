import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

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

export function createGlobalSkill(input: SkillInput): string {
  const skillDir = join(os.homedir(), '.claude', 'skills', input.name);
  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true });
  }
  const filePath = join(skillDir, 'SKILL.md');
  writeFileSync(filePath, buildSkillMarkdown(input), 'utf-8');
  return filePath;
}
