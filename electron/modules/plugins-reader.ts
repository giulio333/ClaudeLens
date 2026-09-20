import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { CLAUDE_DIR } from '../utils';
import { Skill, readSkillsFromDir, readSkillDir } from './skills-reader';
import { Agent, readAgentsFromDir, readAgentFile } from './agents-reader';
import { parseFrontmatter, getString } from './frontmatter';

/** A slash command provided by a plugin (`<installPath>/commands/*.md`). */
export interface PluginCommand {
  name: string;
  path: string;
  description?: string;
  content: string;
  rawContent: string;
}

/** An MCP server a plugin declares (`<installPath>/.mcp.json`, or inline in
 * its manifest). Only the name, the transport and where it points are kept:
 * headers and env carry `${TOKEN}` placeholders at best and secrets at worst,
 * and neither belongs in a listing. */
export interface PluginMcpServer {
  name: string;
  /** `http` / `sse` / `ws` are remote, `stdio` is a local command. Inferred
   * from `url` vs `command` when the entry names no `type`. */
  transport: 'http' | 'sse' | 'ws' | 'stdio' | 'unknown';
  /** The endpoint of a remote server, the command line of a local one. */
  target?: string;
}

/** One hook registration from a plugin's `hooks/hooks.json`: the event it
 * listens to, the matcher narrowing it (a tool name pattern, a session-start
 * reason…) and the commands it runs. */
export interface PluginHook {
  event: string;
  matcher?: string;
  commands: string[];
}

/** A plugin installed at user scope, with the components it provides. */
export interface InstalledPlugin {
  /** Plugin name, e.g. `document-skills`. */
  name: string;
  /** Marketplace it was installed from, e.g. `anthropic-agent-skills`. */
  marketplace: string;
  scope: 'user';
  version: string;
  installPath: string;
  description?: string;
  author?: string;
  /** Source repo of the marketplace (from known_marketplaces.json), e.g. `anthropics/skills`. */
  repo?: string;
  skills: Skill[];
  agents: Agent[];
  commands: PluginCommand[];
  mcpServers: PluginMcpServer[];
  hooks: PluginHook[];
}

const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins');

interface InstalledEntry {
  scope?: string;
  projectPath?: string;
  installPath?: string;
  version?: string;
}

/** Safe JSON read; returns null on any failure (missing/malformed file). */
function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch (e) {
    console.error(`Errore leggendo JSON ${path}: ${e}`);
    return null;
  }
}

interface PluginManifest {
  description?: string;
  author?: string;
  /** MCP servers declared inline in the manifest (a path string is ignored:
   * the file it names is `.mcp.json`, read on its own). */
  mcpServers?: Record<string, unknown>;
  /** A hooks file the manifest points at instead of the default `hooks/hooks.json`. */
  hooksPath?: string;
}

/** Read description/author (and the inline declarations) from a plugin's
 * `.claude-plugin/plugin.json`. */
function readPluginManifest(installPath: string): PluginManifest {
  const manifest = readJson<{
    description?: string;
    author?: { name?: string } | string;
    mcpServers?: unknown;
    hooks?: unknown;
  }>(join(installPath, '.claude-plugin', 'plugin.json'));
  if (!manifest) return {};
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  const out: PluginManifest = {};
  if (manifest.description) out.description = manifest.description;
  if (author) out.author = author;
  if (isRecord(manifest.mcpServers)) out.mcpServers = manifest.mcpServers;
  if (typeof manifest.hooks === 'string') out.hooksPath = manifest.hooks;
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The servers of a plugin's `.mcp.json`. Two shapes are in the wild — the
 * `{ mcpServers: { name: … } }` wrapper `.claude.json` uses, and the bare
 * `{ name: … }` map — so the wrapper is unwrapped when present and the map
 * read as is otherwise.
 */
export function parsePluginMcpServers(json: unknown): PluginMcpServer[] {
  if (!isRecord(json)) return [];
  const map = isRecord(json.mcpServers) ? json.mcpServers : json;
  const servers: PluginMcpServer[] = [];
  for (const [name, entry] of Object.entries(map)) {
    if (!isRecord(entry)) continue;
    const url = typeof entry.url === 'string' ? entry.url : undefined;
    const command = typeof entry.command === 'string' ? entry.command : undefined;
    const args = Array.isArray(entry.args) ? entry.args.filter(a => typeof a === 'string') : [];
    const declared = typeof entry.type === 'string' ? entry.type : undefined;
    const transport =
      declared === 'http' || declared === 'sse' || declared === 'ws' || declared === 'stdio'
        ? declared
        : url
          ? 'http'
          : command
            ? 'stdio'
            : 'unknown';
    const target = transport === 'stdio' ? [command, ...args].filter(Boolean).join(' ') : url;
    servers.push({ name, transport, ...(target ? { target } : {}) });
  }
  return servers;
}

/**
 * The registrations of a plugin's `hooks/hooks.json`:
 * `{ hooks: { <Event>: [ { matcher?, hooks: [ { command } ] } ] } }`, one
 * entry per event-and-matcher group, carrying the commands it runs.
 */
export function parsePluginHooks(json: unknown): PluginHook[] {
  if (!isRecord(json) || !isRecord(json.hooks)) return [];
  const out: PluginHook[] = [];
  for (const [event, groups] of Object.entries(json.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isRecord(group)) continue;
      const handlers = Array.isArray(group.hooks) ? group.hooks : [];
      const commands = handlers
        .map(h => (isRecord(h) && typeof h.command === 'string' ? h.command : null))
        .filter((c): c is string => c !== null);
      const matcher = typeof group.matcher === 'string' ? group.matcher : undefined;
      out.push({ event, ...(matcher ? { matcher } : {}), commands });
    }
  }
  return out;
}

function readPluginMcpServers(installPath: string, manifest: PluginManifest): PluginMcpServer[] {
  const fromFile = parsePluginMcpServers(readJson<unknown>(join(installPath, '.mcp.json')));
  const inline = manifest.mcpServers ? parsePluginMcpServers(manifest.mcpServers) : [];
  const seen = new Set(fromFile.map(s => s.name));
  return [...fromFile, ...inline.filter(s => !seen.has(s.name))];
}

function readPluginHooks(installPath: string, manifest: PluginManifest): PluginHook[] {
  const file = manifest.hooksPath
    ? join(installPath, manifest.hooksPath)
    : join(installPath, 'hooks', 'hooks.json');
  return parsePluginHooks(readJson<unknown>(file));
}

function readCommandFile(filePath: string): PluginCommand | null {
  if (!existsSync(filePath)) return null;
  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(rawContent);
    return {
      name: basename(filePath).replace(/\.md$/, ''),
      path: filePath,
      description: getString(frontmatter, 'description'),
      content: body,
      rawContent,
    };
  } catch (e) {
    console.error(`Errore leggendo command ${basename(filePath)}: ${e}`);
    return null;
  }
}

function readPluginCommands(installPath: string): PluginCommand[] {
  const dir = join(installPath, 'commands');
  if (!existsSync(dir)) return [];
  const commands: PluginCommand[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const cmd = readCommandFile(join(dir, entry.name));
      if (cmd) commands.push(cmd);
    }
  } catch (e) {
    console.error(`Errore leggendo commands da ${dir}: ${e}`);
  }
  return commands;
}

interface MarketplaceEntry {
  name: string;
  description?: string;
  skills?: string[];
  agents?: string[];
  commands?: string[];
}

/**
 * Find a plugin's declaration in the marketplace.json shipped inside its install
 * path. Monorepo marketplaces (e.g. anthropic-agent-skills) bundle ALL their
 * skills in one shared `skills/` dir and declare a per-plugin subset here, so
 * scanning the dir would over-report. Returns null when no manifest/entry exists
 * (e.g. claude-plugins-official, where each install path is the plugin's own dir
 * and declares nothing → caller falls back to scanning).
 */
function readMarketplaceEntry(installPath: string, pluginName: string): MarketplaceEntry | null {
  const manifest = readJson<{ plugins?: MarketplaceEntry[] }>(
    join(installPath, '.claude-plugin', 'marketplace.json')
  );
  return manifest?.plugins?.find(p => p?.name === pluginName) ?? null;
}

/** Resolve declared skill dirs (each containing SKILL.md) relative to installPath. */
async function readDeclaredSkills(installPath: string, rels: string[]): Promise<Skill[]> {
  const skills = await Promise.all(rels.map(rel => readSkillDir(join(installPath, rel), 'plugin')));
  return skills.filter((s): s is Skill => s !== null);
}

async function readDeclaredAgents(installPath: string, rels: string[]): Promise<Agent[]> {
  const agents = await Promise.all(
    rels.map(rel => readAgentFile(join(installPath, rel), 'plugin'))
  );
  return agents.filter((a): a is Agent => a !== null);
}

function readDeclaredCommands(installPath: string, rels: string[]): PluginCommand[] {
  return rels
    .map(rel => readCommandFile(join(installPath, rel)))
    .filter((c): c is PluginCommand => c !== null);
}

/**
 * Read user-scoped plugins installed under `~/.claude/plugins/`.
 *
 * Source of truth is `installed_plugins.json`: each key is `<plugin>@<marketplace>`
 * mapping to one or more install records (per scope). We surface only `user`-scope
 * records (the section is global). For each, we list the components it provides:
 * - If the install path's `marketplace.json` DECLARES skills/agents/commands for
 *   the plugin (monorepo marketplaces bundle all skills in one shared dir and
 *   declare a per-plugin subset), we resolve exactly those declared paths.
 * - Otherwise we scan the plugin root dirs `skills/<name>/SKILL.md`, `agents/*.md`,
 *   `commands/*.md` (the install path is the plugin's own dir).
 * Agents nested inside a skill (`skills/<skill>/agents/*.md`) are NOT surfaced — they
 * are internal helpers of that skill, not independently invocable plugin agents.
 * What a plugin adds beyond files Claude reads — the MCP servers of its
 * `.mcp.json` and the hooks of `hooks/hooks.json` — is listed too, else a
 * plugin like an MCP connector shows up with nothing in it.
 */
export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  const installed = readJson<{
    plugins?: Record<string, InstalledEntry[]>;
  }>(join(PLUGINS_DIR, 'installed_plugins.json'));
  if (!installed?.plugins) return [];

  const marketplaces = readJson<Record<string, { source?: { repo?: string } }>>(
    join(PLUGINS_DIR, 'known_marketplaces.json')
  );

  const plugins: InstalledPlugin[] = [];

  for (const [key, entries] of Object.entries(installed.plugins)) {
    if (!Array.isArray(entries)) continue;
    const [name, marketplace] = key.split('@');
    if (!name || !marketplace) continue;

    const userEntry = entries.find(e => e?.scope === 'user' && e.installPath);
    if (!userEntry?.installPath) continue;
    if (!existsSync(userEntry.installPath)) continue;

    const installPath = userEntry.installPath;
    const manifest = readPluginManifest(installPath);
    const repo = marketplaces?.[marketplace]?.source?.repo;
    const declared = readMarketplaceEntry(installPath, name);

    plugins.push({
      name,
      marketplace,
      scope: 'user',
      version: userEntry.version ?? 'unknown',
      installPath,
      description: manifest.description ?? declared?.description,
      author: manifest.author,
      repo,
      skills: declared?.skills
        ? await readDeclaredSkills(installPath, declared.skills)
        : await readSkillsFromDir(join(installPath, 'skills'), 'plugin'),
      agents: declared?.agents
        ? await readDeclaredAgents(installPath, declared.agents)
        : await readAgentsFromDir(join(installPath, 'agents'), 'plugin'),
      commands: declared?.commands
        ? readDeclaredCommands(installPath, declared.commands)
        : readPluginCommands(installPath),
      mcpServers: readPluginMcpServers(installPath, manifest),
      hooks: readPluginHooks(installPath, manifest),
    });
  }

  // Stable order: by marketplace then plugin name.
  plugins.sort(
    (a, b) => a.marketplace.localeCompare(b.marketplace) || a.name.localeCompare(b.name)
  );
  return plugins;
}
