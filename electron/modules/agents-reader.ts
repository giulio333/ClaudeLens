import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { CLAUDE_DIR } from '../utils';
import { parseFrontmatter, getString } from './frontmatter';
import { AGENT_FIELDS, parseFields } from './entity-fields';

export interface Agent {
  name: string;
  path: string;
  scope: 'global' | 'project' | 'plugin';
  content: string;
  rawContent: string;
  /** Required frontmatter fields that are missing (e.g. ['name', 'description']). Empty = valid. */
  missingRequired: string[];
  /** True if the file name contains spaces — Claude Code requires space-free agent file names. */
  filenameHasSpaces: boolean;
  description?: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  disableModelInvocation?: boolean;
  permissionMode?: string;
  maxTurns?: number;
  skills?: string[];
  mcpServers?: string[];
  background?: boolean;
  isolation?: string;
  memory?: string;
  effort?: string;
  color?: string;
}

/** Frontmatter fields the docs mark as required for a subagent definition. */
export const REQUIRED_AGENT_FIELDS = ['name', 'description'] as const;

interface AgentFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  disableModelInvocation?: boolean;
  permissionMode?: string;
  maxTurns?: number;
  skills?: string[];
  mcpServers?: string[];
  background?: boolean;
  isolation?: string;
  memory?: string;
  effort?: string;
  color?: string;
}

function parseAgentMarkdown(content: string): { frontmatter: AgentFrontmatter; body: string } {
  const { frontmatter: raw, body } = parseFrontmatter(content);
  // All scalar/list fields come from the shared AGENT_FIELDS registry; `name`
  // is read separately (required, with a filename fallback in readAgentFile).
  const fm = parseFields(raw, AGENT_FIELDS) as AgentFrontmatter;
  const name = getString(raw, 'name');
  if (name !== undefined) fm.name = name;
  return { frontmatter: fm, body };
}

/**
 * Read a single agent definition from a `.md` file. Returns null if it fails to
 * read. Shared by `readAgentsFromDir` and the plugin reader (which resolves
 * explicit, declared agent paths rather than scanning).
 */
export function readAgentFile(filePath: string, scope: 'global' | 'project' | 'plugin'): Agent | null {
  if (!existsSync(filePath)) return null;
  const fileName = basename(filePath);
  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseAgentMarkdown(rawContent);
    const missingRequired = REQUIRED_AGENT_FIELDS.filter(f => !frontmatter[f]);
    return {
      name: frontmatter.name ?? fileName.replace(/\.md$/, ''),
      path: filePath,
      scope,
      content: body,
      rawContent,
      missingRequired,
      filenameHasSpaces: fileName.includes(' '),
      description: frontmatter.description,
      model: frontmatter.model,
      allowedTools: frontmatter.allowedTools,
      disallowedTools: frontmatter.disallowedTools,
      disableModelInvocation: frontmatter.disableModelInvocation,
      permissionMode: frontmatter.permissionMode,
      maxTurns: frontmatter.maxTurns,
      skills: frontmatter.skills,
      mcpServers: frontmatter.mcpServers,
      background: frontmatter.background,
      isolation: frontmatter.isolation,
      memory: frontmatter.memory,
      effort: frontmatter.effort,
      color: frontmatter.color,
    };
  } catch (e) {
    console.error(`Errore leggendo agent ${fileName}: ${e}`);
    return null;
  }
}

export function readAgentsFromDir(dir: string, scope: 'global' | 'project' | 'plugin'): Agent[] {
  if (!existsSync(dir)) return [];
  const agents: Agent[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const agent = readAgentFile(join(dir, entry.name), scope);
        if (agent) agents.push(agent);
      }
    }
  } catch (e) {
    console.error(`Errore leggendo agents da ${dir}: ${e}`);
  }

  return agents;
}

export function getGlobalAgents(): Agent[] {
  const agentsDir = join(CLAUDE_DIR, 'agents');
  return readAgentsFromDir(agentsDir, 'global');
}

export function getProjectAgents(realProjectPath: string): Agent[] {
  const agentsDir = join(realProjectPath, '.claude', 'agents');
  return readAgentsFromDir(agentsDir, 'project');
}
