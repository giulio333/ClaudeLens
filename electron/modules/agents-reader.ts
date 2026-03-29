import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

export interface Agent {
  name: string;
  path: string;
  scope: 'global' | 'project';
  content: string;
  rawContent: string;
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
}

interface AgentFrontmatter {
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
}

function parseAgentMarkdown(content: string): { frontmatter: AgentFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fmText = match[1];
  const body = match[2];
  const fm: AgentFrontmatter = {};

  const scalar = (key: string): string | undefined => {
    const m = fmText.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  };

  const arr = (key: string): string[] | undefined => {
    // Supporta sia "key: a, b, c" che "key: [a, b, c]"
    const m = fmText.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (!m) return undefined;
    return m[1].trim().replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  };

  const bool = (key: string): boolean | undefined => {
    const v = scalar(key);
    return v !== undefined ? v.toLowerCase() === 'true' : undefined;
  };

  const num = (key: string): number | undefined => {
    const v = scalar(key);
    return v !== undefined ? parseInt(v, 10) : undefined;
  };

  if (scalar('description'))     fm.description     = scalar('description');
  if (scalar('model'))           fm.model           = scalar('model');
  if (arr('tools'))              fm.allowedTools    = arr('tools');
  if (arr('disallowedTools'))    fm.disallowedTools = arr('disallowedTools');
  if (scalar('permissionMode'))  fm.permissionMode  = scalar('permissionMode');
  if (scalar('isolation'))       fm.isolation       = scalar('isolation');
  if (scalar('memory'))          fm.memory          = scalar('memory');
  if (arr('skills'))             fm.skills          = arr('skills');
  if (arr('mcpServers'))         fm.mcpServers      = arr('mcpServers');
  const mt = num('maxTurns');    if (mt !== undefined) fm.maxTurns = mt;
  const bg = bool('background'); if (bg !== undefined) fm.background = bg;
  const dm = bool('disable_model_invocation'); if (dm !== undefined) fm.disableModelInvocation = dm;

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
          agents.push({
            name: entry.name.replace(/\.md$/, ''),
            path: filePath,
            scope,
            content: body,
            rawContent,
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
  const agentsDir = join(os.homedir(), '.claude', 'agents');
  return readAgentsFromDir(agentsDir, 'global');
}

export function getProjectAgents(realProjectPath: string): Agent[] {
  const agentsDir = join(realProjectPath, '.claude', 'agents');
  return readAgentsFromDir(agentsDir, 'project');
}
