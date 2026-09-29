import type { InitInfo } from '../../../types';

/**
 * The MCP servers that broke, grouped the way a reader goes to fix them.
 *
 * A failed server used to be printed by its full name, one per chip, under the
 * environment strip — `plugin:acme:calendar` repeats the plugin
 * on every server it ships, and four of them took three wrapped lines of a rail
 * that has no room to spare. Grouping by where the server comes from says the
 * same thing once: the plugin that ships it, or the scope it was configured in.
 */

type McpServer = InitInfo['mcpServers'][number];

export interface McpFailureGroup {
  /** The plugin that ships these servers; null for a server configured directly. */
  plugin: string | null;
  /** Where a directly-configured server was defined (`user`, `project`, …),
   *  when the CLI says. Absent on CLIs that predate the field. */
  source?: string;
  /** The server names as the reader knows them — the plugin prefix dropped. */
  servers: string[];
}

/** `failed` is the SDK's word; an older CLI reported the reason in the status. */
export function isFailedMcp(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'failed' || s.includes('error');
}

// A plugin's server is named `plugin:<plugin>:<server>`; the server part may
// itself hold a colon, so only the first two separators split.
const PLUGIN_NAME = /^plugin:([^:]+):(.+)$/;

/** The failed servers, one group per plugin or per config scope, in the order
 *  the handshake listed them. */
export function failedMcpGroups(servers: McpServer[]): McpFailureGroup[] {
  const groups = new Map<string, McpFailureGroup>();
  for (const s of servers) {
    if (!isFailedMcp(s.status)) continue;
    const m = PLUGIN_NAME.exec(s.name);
    const plugin = m ? m[1] : null;
    const key = plugin !== null ? `plugin:${plugin}` : `scope:${s.source ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = plugin !== null ? { plugin, servers: [] } : { plugin, source: s.source, servers: [] };
      groups.set(key, group);
    }
    group.servers.push(m ? m[2] : s.name);
  }
  return [...groups.values()];
}
