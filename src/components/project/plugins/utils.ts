import type { InstalledPlugin, PluginHook, PluginMcpServer } from '../../../hooks/useIPC';

/** Everything a plugin adds — skills, agents, commands, MCP servers, hooks —
 * the count the tree prints beside the plugin's name. */
export function pluginComponentCount(plugin: InstalledPlugin): number {
  return (
    plugin.skills.length +
    plugin.agents.length +
    plugin.commands.length +
    plugin.mcpServers.length +
    plugin.hooks.length
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The count spelled out by kind — `2 skills · 1 agent` — skipping kinds the
 * plugin does not carry; the tooltip of the tree's bare number. A plugin with
 * nothing local says so, since a bare `0` would read as "broken". */
export function pluginComponentSummary(plugin: InstalledPlugin): string {
  const parts: string[] = [];
  if (plugin.skills.length) parts.push(plural(plugin.skills.length, 'skill'));
  if (plugin.agents.length) parts.push(plural(plugin.agents.length, 'agent'));
  if (plugin.commands.length) parts.push(plural(plugin.commands.length, 'command'));
  if (plugin.mcpServers.length) parts.push(plural(plugin.mcpServers.length, 'MCP server'));
  if (plugin.hooks.length) parts.push(plural(plugin.hooks.length, 'hook'));
  return parts.length ? parts.join(', ') : 'nothing to list';
}

/** What an MCP server row says about where the server is. */
export function describeMcpServer(server: PluginMcpServer): string {
  if (!server.target) return 'No endpoint declared.';
  if (server.transport === 'stdio') return `Runs locally: ${server.target}`;
  return `Remote server at ${server.target}`;
}

/** What a hook row says: when it fires and what it runs. */
export function describeHook(hook: PluginHook): string {
  const when = hook.matcher ? `When it matches "${hook.matcher}"` : 'Every time';
  const n = hook.commands.length;
  return `${when}, runs ${plural(n, 'command')}.`;
}

/** The opening sentence of a description — what a row has room for. A period
 * only ends a sentence when a capital follows it, so `e.g. adding` and
 * `.docx files` stay inside their sentence; a description with no such break
 * comes back whole. */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = /[.!?](?=\s+[A-Z(“"])/.exec(t);
  return m ? t.slice(0, m.index + 1) : t;
}

/** The version fact of the header. Marketplaces often pin a commit rather
 * than a number, and twelve hex digits are not a version to a reader: those
 * are labelled as the commit they are, cut to the seven git prints. */
export function describeVersion(
  version: string
): { label: 'Version' | 'Commit'; value: string } | null {
  if (!version || version === 'unknown') return null;
  if (/^[0-9a-f]{7,}$/i.test(version)) return { label: 'Commit', value: version.slice(0, 7) };
  return { label: 'Version', value: version };
}

/** Where a marketplace's source repo can be opened: `owner/name` is a GitHub
 * slug, a URL is itself, anything else has no link. */
export function repoUrl(repo: string): string | null {
  if (/^https?:\/\//.test(repo)) return repo;
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return `https://github.com/${repo}`;
  return null;
}

/** The install path with the part every plugin shares cut off — the reader
 * already knows it all lives under `~/.claude/plugins`. */
export function shortInstallPath(installPath: string): string {
  const i = installPath.indexOf('/.claude/plugins/');
  return i >= 0 ? installPath.slice(i + '/.claude/plugins/'.length) : installPath;
}

export interface PluginKey {
  marketplace: string;
  name: string;
}

export function samePlugin(a: PluginKey, b: PluginKey): boolean {
  return a.marketplace === b.marketplace && a.name === b.name;
}

/** Plugins grouped by marketplace, in the order the backend sorted them. */
export function groupByMarketplace(plugins: InstalledPlugin[]): Map<string, InstalledPlugin[]> {
  const groups = new Map<string, InstalledPlugin[]>();
  for (const p of plugins) {
    const list = groups.get(p.marketplace) ?? [];
    list.push(p);
    groups.set(p.marketplace, list);
  }
  return groups;
}

/** The plugin the arrow keys land on: `delta` steps from `current` through the
 * plugins still visible (a collapsed marketplace hides its own), clamped at
 * either end. `current` outside the visible set starts from the top. */
export function stepPlugin(
  visible: InstalledPlugin[],
  current: PluginKey | null,
  delta: 1 | -1
): InstalledPlugin | null {
  if (!visible.length) return null;
  const at = current ? visible.findIndex(p => samePlugin(p, current)) : -1;
  if (at < 0) return visible[0];
  const next = Math.min(visible.length - 1, Math.max(0, at + delta));
  return visible[next];
}
