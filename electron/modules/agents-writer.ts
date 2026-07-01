import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { CLAUDE_DIR, validateEntityName, assertWithin } from '../utils';
import { yamlScalar } from './frontmatter';
import { AGENT_FIELDS, emitFields } from './entity-fields';

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
  // `name` is required and always first; the rest are emitted (and quoted) from
  // the shared AGENT_FIELDS registry, so the writer can't drift from the reader.
  const lines = [
    '---',
    `name: ${yamlScalar(input.name)}`,
    ...emitFields(input as unknown as Record<string, unknown>, AGENT_FIELDS),
    '---',
    '',
    input.content,
  ];
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
