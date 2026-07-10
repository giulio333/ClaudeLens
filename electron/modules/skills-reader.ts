import { existsSync, readdirSync, statSync } from 'fs';
import { join, basename, relative, extname, sep } from 'path';
import { CLAUDE_DIR } from '../utils';
import { readTextFile } from './safe-fs';
import { parseFrontmatter } from './frontmatter';
import { SKILL_FIELDS, parseFields } from './entity-fields';

/** Role buckets used to group a skill's supporting files in the UI. */
export type SkillFileRole = 'doc' | 'script' | 'template' | 'asset' | 'extension' | 'eval' | 'meta';

export interface SkillFile {
  /** Path relative to the skill directory (POSIX-style, e.g. `references/api.md`). */
  relPath: string;
  role: SkillFileRole;
  /** True when the file is linked from SKILL.md (first-class, intentional). */
  referenced: boolean;
  /** Size in bytes. */
  size: number;
  /** Editable as text in-app; false for images/binaries (preview only). */
  isText: boolean;
}

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
  /** Supporting files bundled alongside SKILL.md (empty for bare skills). */
  files: SkillFile[];
}

// Directories never worth surfacing: VCS, build output, virtualenvs, caches, and
// the skill's own runtime/state dir (which can hold credentials — never exposed).
const IGNORED_DIRS = new Set([
  '.git', '.venv', 'venv', 'node_modules', '__pycache__', 'dist', 'build', '.next',
  '.cache', 'data', '.pytest_cache', '.mypy_cache', '.ruff_cache',
]);

const SCRIPT_EXTS = new Set([
  '.py', '.sh', '.bash', '.zsh', '.js', '.mjs', '.cjs', '.ts', '.rb', '.go', '.rs',
  '.pl', '.php', '.lua', '.ps1',
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const TEXT_EXTS = new Set([
  '.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.csv', '.tsv', '.html', '.htm', '.css', '.xml', '.env', '.svg',
  ...SCRIPT_EXTS,
]);
const META_BASENAMES = new Set([
  'license', 'license.md', 'license.txt', 'requirements.txt', 'package.json',
  'package-lock.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'pnpm-lock.yaml',
  '.gitignore', '.python-version', 'changelog.md',
]);
const EVAL_BASENAMES = new Set(['evals.json', 'grading.json', 'benchmark.json']);

/** Classify a supporting file by its role. Path-segment rules win over extension. */
function classifyRole(relPath: string): SkillFileRole {
  const segs = relPath.split(/[\\/]/);
  const top = segs[0].toLowerCase();
  const base = basename(relPath).toLowerCase();
  const ext = extname(relPath).toLowerCase();

  if (top === 'agents' || top === 'hooks' || top === 'output-styles' ||
      base === '.mcp.json' || segs.includes('.claude-plugin')) return 'extension';
  if (top === 'evals' || EVAL_BASENAMES.has(base)) return 'eval';
  if (META_BASENAMES.has(base)) return 'meta';
  if (top === 'scripts' || SCRIPT_EXTS.has(ext)) return 'script';
  if (IMAGE_EXTS.has(ext)) return 'asset';
  if (top === 'templates' || base.startsWith('template')) return 'template';
  if (ext === '.md' || ext === '.mdx' || ext === '.txt') return 'doc';
  return 'meta';
}

// Walk a skill directory (depth-limited), skipping noise/runtime dirs and SKILL.md
// itself, collecting one SkillFile per supporting file. Content is NOT read here —
// the list stays cheap for `getAll`; bodies load lazily via `skills:readFile`.
function collectSkillFiles(skillDir: string, referencedRel: Set<string>): SkillFile[] {
  const out: SkillFile[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: import('fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(abs, depth + 1);
      } else if (entry.isFile()) {
        const rel = relative(skillDir, abs).split(sep).join('/');
        if (rel === 'SKILL.md') continue;
        let size: number;
        try {
          size = statSync(abs).size;
        } catch {
          continue;
        }
        out.push({
          relPath: rel,
          role: classifyRole(rel),
          referenced: referencedRel.has(rel) || referencedRel.has(basename(rel)),
          size,
          isText: TEXT_EXTS.has(extname(rel).toLowerCase()),
        });
      }
    }
  };
  walk(skillDir, 0);
  // Referenced first, then by role, then alphabetical — stable, meaningful order.
  return out.sort(
    (a, b) =>
      Number(b.referenced) - Number(a.referenced) ||
      a.role.localeCompare(b.role) ||
      a.relPath.localeCompare(b.relPath),
  );
}

/** Extract the link targets from a SKILL.md body so we can flag referenced files. */
function referencedPaths(body: string): Set<string> {
  const set = new Set<string>();
  // Markdown links/images: [..](path) — keep relative-looking targets only.
  for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0].replace(/^\.\//, '');
    if (target && !/^[a-z]+:\/\//i.test(target)) set.add(target);
  }
  // Bare paths under known supporting dirs (e.g. `scripts/run.py` in a code block).
  for (const m of body.matchAll(/\b((?:scripts|references|examples|assets|templates)\/[\w./-]+)/g)) {
    set.add(m[1].replace(/^\.\//, ''));
  }
  return set;
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
  // Scalar/list fields come from the shared SKILL_FIELDS registry; `hooks` is a
  // nested map (not a scalar), so it is read separately below.
  const fm = parseFields(raw, SKILL_FIELDS) as SkillFrontmatter;

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
export async function readSkillDir(skillDir: string, scope: 'global' | 'project' | 'plugin'): Promise<Skill | null> {
  const skillMarkdownPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMarkdownPath)) return null;
  try {
    const rawContent = await readTextFile(skillMarkdownPath);
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
      files: collectSkillFiles(skillDir, referencedPaths(body)),
    };
  } catch (error) {
    console.error(`Errore leggendo skill ${basename(skillDir)}: ${error}`);
    return null;
  }
}

export async function readSkillsFromDir(dir: string, scope: 'global' | 'project' | 'plugin'): Promise<Skill[]> {
  if (!existsSync(dir)) return [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const skills = await Promise.all(
      entries
        .filter(entry => entry.isDirectory())
        .map(entry => readSkillDir(join(dir, entry.name), scope)),
    );
    return skills.filter((s): s is Skill => s !== null);
  } catch (error) {
    console.error(`Errore leggendo skills da ${dir}: ${error}`);
    return [];
  }
}

export function getGlobalSkills(): Promise<Skill[]> {
  const skillsDir = join(CLAUDE_DIR, 'skills');
  return readSkillsFromDir(skillsDir, 'global');
}

export function getProjectSkills(realProjectPath: string): Promise<Skill[]> {
  const skillsDir = join(realProjectPath, '.claude', 'skills');
  return readSkillsFromDir(skillsDir, 'project');
}

export async function getAllSkills(realProjectPath: string): Promise<Skill[]> {
  const [projectSkills, globalSkills] = await Promise.all([
    getProjectSkills(realProjectPath),
    getGlobalSkills(),
  ]);

  // Project skills hanno priorità, quindi filtriamo i global skills con lo stesso nome
  const projectNames = new Set(projectSkills.map(s => s.name));
  const filteredGlobal = globalSkills.filter(s => !projectNames.has(s.name));

  return [...projectSkills, ...filteredGlobal];
}
