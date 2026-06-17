import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { CLAUDE_DIR } from '../utils';
import { parseFrontmatter, getString, getBoolean, getStringArray } from './frontmatter';

export interface Skill {
  name: string;
  path: string;
  scope: 'global' | 'project' | 'plugin';
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

export function parseSkillMarkdown(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const { frontmatter: raw, body } = parseFrontmatter(content);
  const fm: SkillFrontmatter = {};

  // Ogni campo valutato una sola volta, assegnato solo se definito (preserva
  // i campi opzionali come `undefined` invece di forzarli a un valore vuoto).
  const description = getString(raw, 'description');
  if (description !== undefined) fm.description = description;

  const argumentHint = getString(raw, 'argument-hint');
  if (argumentHint !== undefined) fm.argumentHint = argumentHint;

  const disableModelInvocation = getBoolean(raw, 'disable-model-invocation');
  if (disableModelInvocation !== undefined) fm.disableModelInvocation = disableModelInvocation;

  const userInvocable = getBoolean(raw, 'user-invocable');
  if (userInvocable !== undefined) fm.userInvocable = userInvocable;

  const allowedTools = getStringArray(raw, 'allowed-tools');
  if (allowedTools !== undefined) fm.allowedTools = allowedTools;

  const model = getString(raw, 'model');
  if (model !== undefined) fm.model = model;

  const context = getString(raw, 'context');
  if (context !== undefined) fm.context = context;

  const agent = getString(raw, 'agent');
  if (agent !== undefined) fm.agent = agent;

  // `hooks` is declared on the Skill type and forwarded below, but was never
  // actually parsed — so a skill's hooks block was silently dropped.
  const rawHooks = raw['hooks'];
  if (rawHooks && typeof rawHooks === 'object' && !Array.isArray(rawHooks)) {
    fm.hooks = rawHooks as Record<string, unknown>;
  }

  return { frontmatter: fm, body };
}

/**
 * Read a single skill from its directory (`<skillDir>/SKILL.md`). The skill name
 * is the directory's basename. Returns null if there is no SKILL.md or it fails
 * to read. Shared by `readSkillsFromDir` and the plugin reader (which resolves
 * explicit, declared skill paths rather than scanning).
 */
export function readSkillDir(skillDir: string, scope: 'global' | 'project' | 'plugin'): Skill | null {
  const skillMarkdownPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMarkdownPath)) return null;
  try {
    const rawContent = readFileSync(skillMarkdownPath, 'utf-8');
    const { frontmatter, body } = parseSkillMarkdown(rawContent);
    return {
      name: basename(skillDir),
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
    };
  } catch (error) {
    console.error(`Errore leggendo skill ${basename(skillDir)}: ${error}`);
    return null;
  }
}

export function readSkillsFromDir(dir: string, scope: 'global' | 'project' | 'plugin'): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skill = readSkillDir(join(dir, entry.name), scope);
        if (skill) skills.push(skill);
      }
    }
  } catch (error) {
    console.error(`Errore leggendo skills da ${dir}: ${error}`);
  }

  return skills;
}

export function getGlobalSkills(): Skill[] {
  const skillsDir = join(CLAUDE_DIR, 'skills');
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
