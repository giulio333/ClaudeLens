import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

export interface Skill {
  name: string;
  path: string;
  scope: 'global' | 'project';
  content: string;
  rawContent: string;
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  context?: string;
  agent?: string;
  hooks?: Record<string, unknown>;
}

interface SkillFrontmatter {
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  context?: string;
  agent?: string;
  hooks?: Record<string, unknown>;
}

function parseSkillMarkdown(content: string): { frontmatter: SkillFrontmatter; body: string } {
  // Estrai il frontmatter YAML se presente (---...---)
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterText = frontmatterMatch[1];
  const body = frontmatterMatch[2];
  const fm: SkillFrontmatter = {};

  // Helper per estrarre valori dal YAML
  const getScalarValue = (key: string): string | undefined => {
    const match = frontmatterText.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
  };

  const getBoolValue = (key: string): boolean | undefined => {
    const val = getScalarValue(key);
    return val ? val.toLowerCase() === 'true' : undefined;
  };

  const getArrayValue = (key: string): string[] | undefined => {
    const match = frontmatterText.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (!match) return undefined;
    const val = match[1].trim();
    // Supporta sia "tool1, tool2" che "[tool1, tool2]"
    return val
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s);
  };

  // Parsifica tutti i campi
  if (getScalarValue('description')) fm.description = getScalarValue('description');
  if (getScalarValue('argument-hint')) fm.argumentHint = getScalarValue('argument-hint');
  if (getBoolValue('disable-model-invocation')) fm.disableModelInvocation = getBoolValue('disable-model-invocation');
  if (getBoolValue('user-invocable')) fm.userInvocable = getBoolValue('user-invocable');
  if (getArrayValue('allowed-tools')) fm.allowedTools = getArrayValue('allowed-tools');
  if (getScalarValue('model')) fm.model = getScalarValue('model');
  if (getScalarValue('context')) fm.context = getScalarValue('context');
  if (getScalarValue('agent')) fm.agent = getScalarValue('agent');

  return { frontmatter: fm, body };
}

function readSkillsFromDir(dir: string, scope: 'global' | 'project'): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMarkdownPath = join(dir, entry.name, 'SKILL.md');
        if (existsSync(skillMarkdownPath)) {
          try {
            const rawContent = readFileSync(skillMarkdownPath, 'utf-8');
            const { frontmatter, body } = parseSkillMarkdown(rawContent);
            skills.push({
              name: entry.name,
              path: skillMarkdownPath,
              scope,
              content: body,
              rawContent,
              description: frontmatter.description,
              argumentHint: frontmatter.argumentHint,
              disableModelInvocation: frontmatter.disableModelInvocation,
              userInvocable: frontmatter.userInvocable,
              allowedTools: frontmatter.allowedTools,
              model: frontmatter.model,
              context: frontmatter.context,
              agent: frontmatter.agent,
              hooks: frontmatter.hooks,
            });
          } catch (error) {
            console.error(`Errore leggendo skill ${entry.name}: ${error}`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Errore leggendo skills da ${dir}: ${error}`);
  }

  return skills;
}

export function getGlobalSkills(): Skill[] {
  const claudeDir = join(os.homedir(), '.claude');
  const skillsDir = join(claudeDir, 'skills');
  return readSkillsFromDir(skillsDir, 'global');
}

export function getProjectSkills(realProjectPath: string): Skill[] {
  const skillsDir = join(realProjectPath, '.claude', 'skills');
  return readSkillsFromDir(skillsDir, 'project');
}

export function getAllSkills(realProjectPath: string): Skill[] {
  const projectSkills = getProjectSkills(realProjectPath);
  const globalSkills = getGlobalSkills();

  // Project skills hanno priorità, quindi filtriamo i global skills con lo stesso nome
  const projectNames = new Set(projectSkills.map(s => s.name));
  const filteredGlobal = globalSkills.filter(s => !projectNames.has(s.name));

  return [...projectSkills, ...filteredGlobal];
}
