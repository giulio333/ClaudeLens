import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

export interface McpServer {
  name: string;
  source: 'cloud' | 'local';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // Per i server cloud: stato per progetto
  enabledInProjects: number;
  disabledInProjects: number;
  disabledProjectPaths: string[];
}

export interface McpData {
  cloudServers: McpServer[];
  localServers: McpServer[];
  totalProjects: number;
}

export function getGlobalMcp(): McpData {
  const homeDir = os.homedir();
  const claudeJsonPath = join(homeDir, '.claude.json');
  const settingsPath = join(homeDir, '.claude', 'settings.json');

  let cloudConnected: string[] = [];
  let projectStates: Array<{ path: string; disabled: string[] }> = [];

  if (existsSync(claudeJsonPath)) {
    try {
      const data = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'));
      cloudConnected = data.claudeAiMcpEverConnected ?? [];

      // Raccoglie stato MCP per ogni progetto
      const projects: Record<string, { disabledMcpServers?: string[] }> = data.projects ?? {};
      for (const [path, proj] of Object.entries(projects)) {
        if (proj.disabledMcpServers && proj.disabledMcpServers.length > 0) {
          projectStates.push({ path, disabled: proj.disabledMcpServers });
        } else {
          projectStates.push({ path, disabled: [] });
        }
      }
    } catch {
      // file malformato, ignora
    }
  }

  const totalProjects = projectStates.length;

  const cloudServers: McpServer[] = cloudConnected.map(name => {
    const disabledIn = projectStates.filter(p => p.disabled.includes(name));
    return {
      name,
      source: 'cloud' as const,
      enabledInProjects: totalProjects - disabledIn.length,
      disabledInProjects: disabledIn.length,
      disabledProjectPaths: disabledIn.map(p => p.path),
    };
  });

  // MCP locali da ~/.claude/settings.json
  let localServers: McpServer[] = [];
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const mcpServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> =
        settings.mcpServers ?? {};
      localServers = Object.entries(mcpServers).map(([name, cfg]) => ({
        name,
        source: 'local' as const,
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        enabledInProjects: totalProjects,
        disabledInProjects: 0,
        disabledProjectPaths: [],
      }));
    } catch {
      // file malformato, ignora
    }
  }

  return { cloudServers, localServers, totalProjects };
}
