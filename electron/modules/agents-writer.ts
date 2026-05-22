import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

export interface AgentInput {
  name: string;
  content: string;
  description?: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  background?: boolean;
  isolation?: string;
  memory?: string;
  skills?: string[];
  mcpServers?: string[];
  disableModelInvocation?: boolean;
  effort?: string;
  color?: string;
}

function buildAgentMarkdown(input: AgentInput): string {
  const lines: string[] = ['---'];

  lines.push(`name: ${input.name}`);
  if (input.description) lines.push(`description: ${input.description}`);
  if (input.model) lines.push(`model: ${input.model}`);
  if (input.allowedTools && input.allowedTools.length > 0) lines.push(`tools: [${input.allowedTools.join(', ')}]`);
  if (input.disallowedTools && input.disallowedTools.length > 0) lines.push(`disallowedTools: [${input.disallowedTools.join(', ')}]`);
  if (input.permissionMode) lines.push(`permissionMode: ${input.permissionMode}`);
  if (input.maxTurns !== undefined) lines.push(`maxTurns: ${input.maxTurns}`);
  if (input.background !== undefined) lines.push(`background: ${input.background}`);
  if (input.isolation) lines.push(`isolation: ${input.isolation}`);
  if (input.memory) lines.push(`memory: ${input.memory}`);
  if (input.effort) lines.push(`effort: ${input.effort}`);
  if (input.color) lines.push(`color: ${input.color}`);
  if (input.skills && input.skills.length > 0) lines.push(`skills: [${input.skills.join(', ')}]`);
  if (input.mcpServers && input.mcpServers.length > 0) lines.push(`mcpServers: [${input.mcpServers.join(', ')}]`);
  if (input.disableModelInvocation !== undefined) lines.push(`disable_model_invocation: ${input.disableModelInvocation}`);

  lines.push('---');
  lines.push('');
  lines.push(input.content);

  return lines.join('\n');
}

export function createAgent(input: AgentInput, projectPath?: string): string {
  const baseDir = projectPath ? join(projectPath, '.claude') : join(os.homedir(), '.claude');
  const agentsDir = join(baseDir, 'agents');
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true });
  }
  const filePath = join(agentsDir, `${input.name}.md`);
  writeFileSync(filePath, buildAgentMarkdown(input), 'utf-8');
  return filePath;
}
