import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { CLAUDE_DIR } from '../utils';
import { parseFrontmatter, getString, getBoolean, getStringArray, getNumber } from './frontmatter';

export interface Agent {
  name: string;
  path: string;
  scope: 'global' | 'project';
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
  const fm: AgentFrontmatter = {};

  const name = getString(raw, 'name');
  if (name !== undefined) fm.name = name;

  const description = getString(raw, 'description');
  if (description !== undefined) fm.description = description;

  const model = getString(raw, 'model');
  if (model !== undefined) fm.model = model;

  // Il frontmatter usa `tools:` ma il modello dati lo espone come allowedTools.
  const allowedTools = getStringArray(raw, 'tools');
  if (allowedTools !== undefined) fm.allowedTools = allowedTools;

  const disallowedTools = getStringArray(raw, 'disallowedTools');
  if (disallowedTools !== undefined) fm.disallowedTools = disallowedTools;

  const permissionMode = getString(raw, 'permissionMode');
  if (permissionMode !== undefined) fm.permissionMode = permissionMode;

  const isolation = getString(raw, 'isolation');
  if (isolation !== undefined) fm.isolation = isolation;

  const memory = getString(raw, 'memory');
  if (memory !== undefined) fm.memory = memory;

  const effort = getString(raw, 'effort');
  if (effort !== undefined) fm.effort = effort;

  const color = getString(raw, 'color');
  if (color !== undefined) fm.color = color;

  const skills = getStringArray(raw, 'skills');
  if (skills !== undefined) fm.skills = skills;

  const mcpServers = getStringArray(raw, 'mcpServers');
  if (mcpServers !== undefined) fm.mcpServers = mcpServers;

  const maxTurns = getNumber(raw, 'maxTurns');
  if (maxTurns !== undefined) fm.maxTurns = maxTurns;

  const background = getBoolean(raw, 'background');
  if (background !== undefined) fm.background = background;

  const disableModelInvocation = getBoolean(raw, 'disable_model_invocation');
  if (disableModelInvocation !== undefined) fm.disableModelInvocation = disableModelInvocation;

  return { frontmatter: fm, body };
}

function readAgentsFromDir(dir: string, scope: 'global' | 'project'): Agent[] {
  if (!existsSync(dir)) return [];
  const agents: Agent[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = join(dir, entry.name);
        try {
          const rawContent = readFileSync(filePath, 'utf-8');
          const { frontmatter, body } = parseAgentMarkdown(rawContent);
          const missingRequired = REQUIRED_AGENT_FIELDS.filter(f => !frontmatter[f]);
          agents.push({
            name: frontmatter.name ?? entry.name.replace(/\.md$/, ''),
            path: filePath,
            scope,
            content: body,
            rawContent,
            missingRequired,
            filenameHasSpaces: entry.name.includes(' '),
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
          });
        } catch (e) {
          console.error(`Errore leggendo agent ${entry.name}: ${e}`);
        }
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
