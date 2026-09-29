import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
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
  /** `marketplace`: installed with `/plugin`, listed in `installed_plugins.json`.
   * `synced`: pushed by claude.ai to the logged-in account, under `plugins/synced/`. */
  source: 'marketplace' | 'synced';
  /** False when `enabledPlugins` in the user's settings turns it off — or the
   * plugin defaults off and nothing turns it on: Claude Code does not load it. */
  enabled: boolean;
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
  version?: string;
  /** `false` makes the plugin off until `enabledPlugins` turns it on. */
  defaultEnabled?: boolean;
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
    version?: unknown;
    defaultEnabled?: unknown;
    mcpServers?: unknown;
    hooks?: unknown;
  }>(join(installPath, '.claude-plugin', 'plugin.json'));
  if (!manifest) return {};
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  const out: PluginManifest = {};
  if (manifest.description) out.description = manifest.description;
  if (author) out.author = author;
  if (typeof manifest.version === 'string' && manifest.version) out.version = manifest.version;
  if (typeof manifest.defaultEnabled === 'boolean') out.defaultEnabled = manifest.defaultEnabled;
  if (isRecord(manifest.mcpServers)) out.mcpServers = manifest.mcpServers;
  if (typeof manifest.hooks === 'string') out.hooksPath = manifest.hooks;
  return out;
}

/**
 * Whether Claude Code loads a plugin, from its `enabledPlugins` entry: `true`
 * or an array turns it on, `false` off, and no entry leaves it to the
 * plugin's own `defaultEnabled` — the rule the CLI applies.
 */
export function isPluginEnabled(entry: unknown, defaultEnabled?: boolean): boolean {
  if (entry === undefined) return defaultEnabled !== false;
  return entry === true || Array.isArray(entry);
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

/** What places one plugin — everything `readPluginAt` cannot read off its folder. */
interface PluginOrigin {
  name: string;
  marketplace: string;
  source: InstalledPlugin['source'];
  /** The version the registry pinned; the plugin's own manifest is the fallback. */
  version?: string;
  repo?: string;
  /** The plugin's `enabledPlugins` entry, if the settings have one. */
  enabledEntry: unknown;
}

/**
 * One plugin, read off its folder. We list the components it provides:
 * - If the folder's `marketplace.json` DECLARES skills/agents/commands for
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
async function readPluginAt(installPath: string, origin: PluginOrigin): Promise<InstalledPlugin> {
  const manifest = readPluginManifest(installPath);
  const declared = readMarketplaceEntry(installPath, origin.name);
  return {
    name: origin.name,
    marketplace: origin.marketplace,
    scope: 'user',
    source: origin.source,
    enabled: isPluginEnabled(origin.enabledEntry, manifest.defaultEnabled),
    version: origin.version ?? manifest.version ?? 'unknown',
    installPath,
    description: manifest.description ?? declared?.description,
    author: manifest.author,
    repo: origin.repo,
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
  };
}

/**
 * The plugins installed with `/plugin`. Source of truth is `installed_plugins.json`:
 * each key is `<plugin>@<marketplace>` mapping to one or more install records
 * (per scope). We surface only `user`-scope records (the section is global).
 */
async function readMarketplacePlugins(
  pluginsDir: string,
  enabled: Record<string, unknown>
): Promise<InstalledPlugin[]> {
  const installed = readJson<{
    plugins?: Record<string, InstalledEntry[]>;
  }>(join(pluginsDir, 'installed_plugins.json'));
  if (!installed?.plugins) return [];

  const marketplaces = readJson<Record<string, { source?: { repo?: string } }>>(
    join(pluginsDir, 'known_marketplaces.json')
  );

  const plugins: InstalledPlugin[] = [];
  for (const [key, entries] of Object.entries(installed.plugins)) {
    if (!Array.isArray(entries)) continue;
    const [name, marketplace] = key.split('@');
    if (!name || !marketplace) continue;

    const userEntry = entries.find(e => e?.scope === 'user' && e.installPath);
    if (!userEntry?.installPath || !existsSync(userEntry.installPath)) continue;

    plugins.push(
      await readPluginAt(userEntry.installPath, {
        name,
        marketplace,
        source: 'marketplace',
        version: userEntry.version,
        repo: marketplaces?.[marketplace]?.source?.repo,
        enabledEntry: enabled[key],
      })
    );
  }
  return plugins;
}

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * The folder under `plugins/synced/` that holds what claude.ai syncs to the
 * logged-in account: `<organizationUuid>_<accountUuid>`, lowercased — the name
 * the CLI builds from `oauthAccount`. One `~/.claude` keeps a folder for every
 * account it was logged in with, and reading them all would list another
 * login's plugins as if they were loaded. Null without both ids (an API-key
 * login has no account to sync to), which lists no synced plugin at all.
 */
export function syncedBucketName(account: unknown): string | null {
  if (!isRecord(account)) return null;
  const org = account.organizationUuid;
  const acc = account.accountUuid;
  if (typeof org !== 'string' || typeof acc !== 'string') return null;
  if (!UUID_RE.test(org) || !UUID_RE.test(acc)) return null;
  return `${org.toLowerCase()}_${acc.toLowerCase()}`;
}

/** One plugin a synced folder's `manifest.json` lists. */
export interface SyncedManifestEntry {
  name: string;
  marketplaceName?: string;
  /** Which unpacked copy is current: past the first, the folder is `<name>~g<N>`. */
  generation: number;
}

/**
 * The plugins of a synced folder's `manifest.json`, minus the ones marked
 * `installationPreference: "not_available"` — the one value the CLI treats as
 * absent (`available`, `required` and `auto_install` are all loaded).
 */
export function parseSyncedManifest(json: unknown): SyncedManifestEntry[] {
  if (!isRecord(json) || !Array.isArray(json.plugins)) return [];
  const out: SyncedManifestEntry[] = [];
  for (const p of json.plugins) {
    if (!isRecord(p) || typeof p.name !== 'string' || !p.name) continue;
    if (p.installationPreference === 'not_available') continue;
    const g = p.generation;
    const generation = typeof g === 'number' && Number.isInteger(g) && g > 1 ? g : 1;
    const marketplaceName =
      typeof p.marketplaceName === 'string' && p.marketplaceName ? p.marketplaceName : undefined;
    out.push({ name: p.name, ...(marketplaceName ? { marketplaceName } : {}), generation });
  }
  return out;
}

/**
 * The folder a synced plugin is unpacked into, named the way the CLI names it:
 * a character a file name cannot hold becomes `_`, trailing dots and spaces
 * go, and a generation past the first adds `~g<N>`. Derived rather than found
 * by listing, because the synced folder also holds stale generations, staging
 * and trash. Null for a name that leaves nothing, `..` included.
 */
export function syncedPluginDirName(name: string, generation: number): string | null {
  const base = name.replace(/[<>:"|?*\\/]/g, '_').replace(/[. ]+$/, '');
  if (!base) return null;
  return generation > 1 ? `${base}~g${generation}` : base;
}

/** The plugins claude.ai syncs to the account `oauthAccount` names. */
async function readSyncedPlugins(
  pluginsDir: string,
  account: unknown,
  enabled: Record<string, unknown>
): Promise<InstalledPlugin[]> {
  const bucket = syncedBucketName(account);
  if (!bucket) return [];
  const bucketDir = join(pluginsDir, 'synced', bucket);
  const entries = parseSyncedManifest(readJson<unknown>(join(bucketDir, 'manifest.json')));

  const plugins: InstalledPlugin[] = [];
  for (const entry of entries) {
    const dir = syncedPluginDirName(entry.name, entry.generation);
    if (!dir) continue;
    const installPath = join(bucketDir, dir);
    if (!existsSync(installPath)) continue;
    const marketplace = entry.marketplaceName ?? 'claude.ai';
    // No version from the sync manifest: its `version` is a server revision
    // ("0040"), and the plugin's own manifest carries the one worth reading.
    plugins.push(
      await readPluginAt(installPath, {
        name: entry.name,
        marketplace,
        source: 'synced',
        // Keyed like an installed plugin's; no synced plugin has been seen
        // with an entry, so a wrong guess here only leaves it on.
        enabledEntry: enabled[`${entry.name}@${marketplace}`],
      })
    );
  }
  return plugins;
}

/** Claude Code's global config: inside a relocated `CLAUDE_CONFIG_DIR`, else `~/.claude.json`. */
function globalConfigPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  return dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json');
}

/**
 * Every user-scoped plugin Claude Code can load: the ones installed from a
 * marketplace, then the ones claude.ai syncs to the logged-in account — each
 * marked with whether the user's `enabledPlugins` leaves it on. Project
 * settings can turn a plugin on or off for one project; this page is global
 * and reads the user's settings only.
 */
export async function getInstalledPlugins(
  claudeDir: string = CLAUDE_DIR,
  configPath: string = globalConfigPath()
): Promise<InstalledPlugin[]> {
  const pluginsDir = join(claudeDir, 'plugins');
  const settings = readJson<{ enabledPlugins?: unknown }>(join(claudeDir, 'settings.json'));
  const enabled = isRecord(settings?.enabledPlugins) ? settings.enabledPlugins : {};
  const account = readJson<{ oauthAccount?: unknown }>(configPath)?.oauthAccount;

  const plugins = [
    ...(await readMarketplacePlugins(pluginsDir, enabled)),
    ...(await readSyncedPlugins(pluginsDir, account, enabled)),
  ];
  // Stable order: installed before synced, then by marketplace and plugin name.
  const rank = (p: InstalledPlugin) => (p.source === 'marketplace' ? 0 : 1);
  plugins.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.marketplace.localeCompare(b.marketplace) ||
      a.name.localeCompare(b.name)
  );
  return plugins;
}
