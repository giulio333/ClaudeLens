import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { execClaude } from './claude-cli';
import { resolveClaudeExecutablePath } from '../utils';
import { readTextFile } from './safe-fs';

// Reads the MCP servers Claude Code knows about. Two complementary sources:
//
//   1. the LIVE list — `claude mcp list`, the official non-interactive command
//      behind the same health check `/mcp` shows: which servers exist right now
//      and whether each one is connected, unauthenticated or failing.
//   2. the DISK state — `~/.claude.json`, which holds the per-project toggles
//      (`disabledMcpServers`) and any locally declared server config.
//
// Only (1) may decide *which* servers exist. `claudeAiMcpEverConnected` — the
// field this module used to build the whole cloud list from — is an append-only
// local cache of every claude.ai connector ever seen: disconnecting a connector
// from the web never removes its name, and newly connected ones never get added
// (verified live: `claude.ai Splice` was connected but absent from the field,
// while `claude.ai Synthesize Bio` sits in it and `/mcp` does not list it). That
// is why the UI used to show connectors Claude has no access to.
//
// Two caveats found by watching the real thing, both encoded below:
//
//   * the live list is VOLATILE. Consecutive runs minutes apart returned 11 then
//     3 connectors (`claude mcp get <name>` agreed with each run, so it is the
//     CLI's own view that changes, not a parse artifact). A name missing from one
//     run therefore proves "not in this list", NOT "removed from your account" —
//     hence the status is `unlisted`, and the UI says so in those words.
//   * the Agent SDK `system/init` handshake exposes an `mcp_servers` list too,
//     but it is worse: scoped to the queried directory (an untrusted cwd — the
//     home dir usually is one — reports nothing) and empty on 3 of 4 consecutive
//     probes of the same trusted project.

export type McpStatus =
  | 'connected'
  | 'pending'
  | 'needs-auth'
  | 'failed'
  | 'unknown'
  /**
   * Recorded on disk but absent from the last live list. Deliberately not
   * "removed": the list is volatile, so this is an observation, not a verdict.
   */
  | 'unlisted';

export interface McpServer {
  name: string;
  source: 'cloud' | 'local';
  /** Health reported by `claude mcp list`; `'unlisted'` for disk-only leftovers. */
  status: McpStatus;
  /** Present in the live list (i.e. `/mcp` shows it). */
  live: boolean;
  /** Server exists but has not completed its OAuth flow. */
  needsAuth: boolean;
  /** Endpoint (cloud) or command line (local), as reported by the CLI. */
  target?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // Per-project state (cloud connectors are on unless explicitly disabled).
  enabledInProjects: number;
  disabledInProjects: number;
  disabledProjectPaths: string[];
  enabledProjectPaths: string[];
}

/** How the live read went, so the UI can be honest about what it is showing. */
export interface McpProbe {
  /** Command the live list came from. */
  command: string;
  /** When the list being shown was actually observed (ms epoch); null if never. */
  observedAt: number | null;
  error: string | null;
}

export interface McpData {
  /** Remote connectors that exist right now. */
  cloudServers: McpServer[];
  /** Servers backed by a local command. */
  localServers: McpServer[];
  /** Names recorded on disk that the last live list did not include. */
  unlistedServers: McpServer[];
  totalProjects: number;
  probe: McpProbe;
}

export interface LiveMcpServer {
  name: string;
  target: string;
  status: McpStatus;
}

interface ProjectState {
  path: string;
  disabled: string[];
  enabled: string[];
}

interface LocalConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Raw disk state, kept separate from IO so `buildMcpData` stays pure. */
export interface McpDiskState {
  projects: ProjectState[];
  everConnected: string[];
  localConfigs: Record<string, LocalConfig>;
  /** Servers the CLI cached as awaiting authentication. */
  needsAuth: string[];
}

const CLOUD_PREFIX = 'claude.ai ';
const LIVE_TTL_MS = 60_000;
const LIST_TIMEOUT_MS = 45_000;
export const MCP_LIST_COMMAND = 'claude mcp list';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** `~/.claude.json` is an undocumented file rewritten constantly — validate every field. */
function readProjectState(path: string, raw: unknown): ProjectState {
  const proj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    path,
    disabled: asStringArray(proj.disabledMcpServers),
    enabled: asStringArray(proj.enabledMcpServers),
  };
}

function statusFromLabel(label: string): McpStatus {
  const l = label.toLowerCase();
  if (l.includes('connected')) return 'connected';
  if (l.includes('needs authentication') || l.includes('needs auth')) return 'needs-auth';
  if (l.includes('pending')) return 'pending';
  if (l.includes('fail') || l.includes('error')) return 'failed';
  return 'unknown';
}

/**
 * Parse the output of `claude mcp list`. Each server is one line shaped
 * `name: target - <glyph> Status`; the command has no JSON mode, so this is a
 * text parse — kept pure and unit-tested, and degrading to "no servers" rather
 * than throwing when the CLI changes its wording.
 */
export function parseMcpList(stdout: string): LiveMcpServer[] {
  const out: LiveMcpServer[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    // The status label never contains " - ", but a command line might, so the
    // split anchors on the last separator.
    const sep = line.lastIndexOf(' - ');
    const colon = line.indexOf(': ');
    if (sep < 0 || colon < 0 || colon > sep) continue;

    const name = line.slice(0, colon).trim();
    const target = line.slice(colon + 2, sep).trim();
    // Drop the leading status glyph (✔ / ! / ✗ / ⏸), which is decoration.
    const label = line
      .slice(sep + 3)
      .replace(/^[^\p{L}]+/u, '')
      .trim();
    if (!name || !label) continue;
    out.push({ name, target, status: statusFromLabel(label) });
  }
  return out;
}

/**
 * Merge the live list with the on-disk per-project state.
 *
 * The live list is the authority on existence; disk contributes the per-project
 * toggles and the local configs.
 */
export function buildMcpData(
  live: LiveMcpServer[],
  disk: McpDiskState,
  probe: McpProbe,
): McpData {
  const totalProjects = disk.projects.length;
  const needsAuthSet = new Set(disk.needsAuth);

  const perProject = (name: string) => {
    const disabledIn = disk.projects.filter(p => p.disabled.includes(name));
    const enabledIn = disk.projects.filter(p => !p.disabled.includes(name));
    return {
      enabledInProjects: enabledIn.length,
      disabledInProjects: disabledIn.length,
      disabledProjectPaths: disabledIn.map(p => p.path),
      enabledProjectPaths: enabledIn.map(p => p.path),
    };
  };

  const liveNames = new Set(live.map(s => s.name));
  const localNames = new Set(Object.keys(disk.localConfigs));

  const cloudServers: McpServer[] = live
    .filter(s => !localNames.has(s.name))
    .map(s => ({
      name: s.name,
      source: 'cloud' as const,
      status: s.status,
      live: true,
      needsAuth: s.status === 'needs-auth' || needsAuthSet.has(s.name),
      target: s.target,
      ...perProject(s.name),
    }));

  const localServers: McpServer[] = Object.entries(disk.localConfigs).map(([name, cfg]) => {
    const liveEntry = live.find(s => s.name === name);
    return {
      name,
      source: 'local' as const,
      status: liveEntry ? liveEntry.status : probe.error ? 'unknown' : 'unlisted',
      live: !!liveEntry,
      needsAuth: needsAuthSet.has(name),
      target: liveEntry?.target,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
      ...perProject(name),
    };
  });

  // Leftovers: names disk still remembers (ever-connected cache, or a per-project
  // toggle for a connector since removed) with nothing behind them. Without a
  // successful live read we cannot tell stale from live, so we report none.
  const remembered = new Set<string>();
  if (!probe.error) {
    for (const n of disk.everConnected) remembered.add(n);
    for (const p of disk.projects) {
      for (const n of [...p.disabled, ...p.enabled]) {
        if (n.startsWith(CLOUD_PREFIX)) remembered.add(n);
      }
    }
    for (const n of liveNames) remembered.delete(n);
    for (const n of localNames) remembered.delete(n);
  }

  const unlistedServers: McpServer[] = [...remembered].sort().map(name => ({
    name,
    source: 'cloud' as const,
    status: 'unlisted' as const,
    live: false,
    needsAuth: false,
    // A server that no longer exists is enabled nowhere: reporting it as active
    // in N projects is exactly the fiction this rewrite removes.
    enabledInProjects: 0,
    disabledInProjects: 0,
    disabledProjectPaths: [],
    enabledProjectPaths: [],
  }));

  return { cloudServers, localServers, unlistedServers, totalProjects, probe };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(await readTextFile(path));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {}; // malformed / unreadable: degrade to "no disk state"
  }
}

function localConfigsOf(...sources: unknown[]): Record<string, LocalConfig> {
  const out: Record<string, LocalConfig> = {};
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [name, cfg] of Object.entries(source as Record<string, unknown>)) {
      if (!cfg || typeof cfg !== 'object') continue;
      const c = cfg as LocalConfig;
      out[name] = { command: c.command, args: c.args, env: c.env };
    }
  }
  return out;
}

async function readDiskState(): Promise<McpDiskState> {
  const home = os.homedir();
  const [claudeJson, settings, authCache] = await Promise.all([
    readJson(join(home, '.claude.json')),
    readJson(join(home, '.claude', 'settings.json')),
    readJson(join(home, '.claude', 'mcp-needs-auth-cache.json')),
  ]);

  const projectsRaw = (claudeJson.projects ?? {}) as Record<string, unknown>;
  return {
    projects: Object.entries(projectsRaw).map(([path, raw]) => readProjectState(path, raw)),
    everConnected: asStringArray(claudeJson.claudeAiMcpEverConnected),
    // `claude mcp add -s user` writes into ~/.claude.json; settings.json is the
    // other place a user-scoped stdio server can be declared.
    localConfigs: localConfigsOf(claudeJson.mcpServers, settings.mcpServers),
    needsAuth: Object.keys(authCache),
  };
}

// `claude mcp list` health-checks every server, so it is cached briefly rather
// than re-run on each read of a view that is refetched on any blanket change.
let liveCache: { at: number; servers: LiveMcpServer[] } | null = null;

export function clearMcpLiveCache(): void {
  liveCache = null;
}

interface LiveRead {
  servers: LiveMcpServer[];
  observedAt: number | null;
  error: string | null;
}

async function readLive(now: number): Promise<LiveRead> {
  if (liveCache && now - liveCache.at < LIVE_TTL_MS) {
    return { servers: liveCache.servers, observedAt: liveCache.at, error: null };
  }
  try {
    const { stdout } = await execClaude(['mcp', 'list'], {
      timeout: LIST_TIMEOUT_MS,
      executable: resolveClaudeExecutablePath(),
    });
    const servers = parseMcpList(stdout);
    liveCache = { at: now, servers };
    return { servers, observedAt: now, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string }).code;
    const message =
      code === 'ENOENT'
        ? 'The `claude` CLI is not on PATH, so the live MCP status could not be read.'
        : `\`${MCP_LIST_COMMAND}\` failed: ${error}`;
    // Keep showing the last known-good list rather than blanking the section.
    if (liveCache) return { servers: liveCache.servers, observedAt: liveCache.at, error: message };
    return { servers: [], observedAt: null, error: message };
  }
}

export async function getGlobalMcp(): Promise<McpData> {
  const [disk, live] = await Promise.all([readDiskState(), readLive(Date.now())]);
  return buildMcpData(live.servers, disk, {
    command: MCP_LIST_COMMAND,
    observedAt: live.observedAt,
    error: live.error,
  });
}
