import type { InitInfo } from '../../../types';
import { failedMcpGroups, type McpFailureGroup } from './mcp-health';

/**
 * What Mission Control's TOOLKIT panel lists: the skills, agents and tools the
 * SDK handshake says this project loads, set against what the session's
 * transcript says it called.
 *
 * The two halves come from different places and the panel must not blur them.
 * "Available" is the project probe (`config-reader.ts`), not the `claude` in
 * the terminal, which may have loaded something else since; the uses are
 * counted from the transcript, which is this session's own record.
 */

/** A name the session called, and how many times. */
export interface ToolkitUse {
  name: string;
  uses: number;
}

export interface ToolkitList {
  /** What the session called, most-called first; ties keep the order of the first call. */
  used: ToolkitUse[];
  /** What the project offers and the session never called, alphabetical. */
  available: string[];
}

export interface Toolkit {
  skills: ToolkitList;
  agents: ToolkitList;
  /** Built-in tools only. The probe closes before any MCP server connects, so
   *  the tools a server would add are never in its list — counting them would
   *  report zero for servers the running session may well have. */
  tools: string[];
  /** The servers that failed to connect, grouped by where they are fixed. The
   *  connected ones are not counted, for the same reason as the tools: at the
   *  probe's snapshot nearly every server is still pending. */
  mcpFailed: McpFailureGroup[];
  mcpFailedCount: number;
}

// Slash-command names reach the transcript reader lowercased; the handshake
// spells them as defined. Matching ignores the case, display keeps the
// handshake's spelling where it has one.
const key = (name: string) => name.toLowerCase();

function tally(calls: string[]): ToolkitUse[] {
  const byKey = new Map<string, ToolkitUse>();
  for (const name of calls) {
    const k = key(name);
    const hit = byKey.get(k);
    if (hit) hit.uses += 1;
    else byKey.set(k, { name, uses: 1 });
  }
  // Array.prototype.sort is stable, so equal counts stay in call order.
  return [...byKey.values()].sort((a, b) => b.uses - a.uses);
}

function toolkitList(offered: string[], calls: string[]): ToolkitList {
  const spelled = new Map(offered.map(n => [key(n), n]));
  const used = tally(calls).map(u => ({ ...u, name: spelled.get(key(u.name)) ?? u.name }));
  const usedKeys = new Set(used.map(u => key(u.name)));
  const available = [...spelled.values()]
    .filter(n => !usedKeys.has(key(n)))
    .sort((a, b) => a.localeCompare(b));
  return { used, available };
}

/** `skillCalls` and `agentCalls` hold one entry per call: a skill's name, an
 *  agent's `subagent_type`. */
export function buildToolkit(init: InitInfo, skillCalls: string[], agentCalls: string[]): Toolkit {
  const mcpFailed = failedMcpGroups(init.mcpServers);
  return {
    skills: toolkitList(init.skills, skillCalls),
    agents: toolkitList(init.agents, agentCalls),
    tools: init.tools.filter(t => !t.startsWith('mcp__')).sort((a, b) => a.localeCompare(b)),
    mcpFailed,
    mcpFailedCount: mcpFailed.reduce((n, g) => n + g.servers.length, 0),
  };
}

/** `superpowers:brainstorming` → the namespace a plugin adds, and the name. */
export function splitNamespace(name: string): { ns: string; base: string } {
  const at = name.lastIndexOf(':');
  return at > 0 ? { ns: name.slice(0, at + 1), base: name.slice(at + 1) } : { ns: '', base: name };
}
