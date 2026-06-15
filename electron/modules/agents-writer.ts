import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { CLAUDE_DIR, validateEntityName, assertWithin } from '../utils';

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
  const name = validateEntityName(input.name);
  const agentsDir = join(projectPath ? join(projectPath, '.claude') : CLAUDE_DIR, 'agents');
  const filePath = join(agentsDir, `${name}.md`);
  // assertWithin(agentsDir, …) only proves the filename can't escape agentsDir,
  // but agentsDir itself is derived from the renderer-supplied projectPath. Anchor
  // the real containment check on a trusted root (home) so an absolute/attacker
  // projectPath like '/tmp/evil' can't redirect the write outside the user's tree.
  assertWithin(os.homedir(), filePath);
  assertWithin(agentsDir, filePath);
  if (existsSync(filePath)) {
    throw new Error(`An agent named "${name}" already exists.`);
  }
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true });
  }
  writeFileSync(filePath, buildAgentMarkdown({ ...input, name }), 'utf-8');
  return filePath;
}
