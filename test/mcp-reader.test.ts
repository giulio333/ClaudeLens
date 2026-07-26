import { describe, it, expect } from 'vitest';
import {
  buildMcpData,
  parseMcpList,
  MCP_LIST_COMMAND,
  type McpDiskState,
  type LiveMcpServer,
} from '../electron/modules/mcp-reader';

// The disk shape mirrors the real ~/.claude.json: `claudeAiMcpEverConnected` is an
// append-only cache (a connector removed from the account is never dropped from
// it, a newly connected one is never added), while `claude mcp list` — the same
// health check `/mcp` runs — is the authority on what actually exists.
function disk(over: Partial<McpDiskState> = {}): McpDiskState {
  return {
    projects: [
      { path: '/p/a', disabled: [], enabled: [] },
      { path: '/p/b', disabled: ['claude.ai Gmail'], enabled: [] },
    ],
    everConnected: ['claude.ai Gmail', 'claude.ai Synthesize Bio'],
    localConfigs: {},
    needsAuth: [],
    ...over,
  };
}

const okProbe = { command: MCP_LIST_COMMAND, observedAt: 1_700_000_000_000, error: null };

function live(name: string, status: LiveMcpServer['status'] = 'connected'): LiveMcpServer {
  return { name, target: `https://${name}/mcp`, status };
}

describe('parseMcpList', () => {
  // Verbatim output of `claude mcp list` (2.1.198) — the command has no JSON mode.
  const REAL = `Checking MCP server health…

claude.ai Splice: https://mcp.splice.com/mcp - ✔ Connected
claude.ai Postman: https://mcp.postman.com/minimal - ! Needs authentication
claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected
`;

  it('reads name, endpoint and status from real CLI output', () => {
    const servers = parseMcpList(REAL);
    expect(servers).toEqual([
      { name: 'claude.ai Splice', target: 'https://mcp.splice.com/mcp', status: 'connected' },
      { name: 'claude.ai Postman', target: 'https://mcp.postman.com/minimal', status: 'needs-auth' },
      {
        name: 'claude.ai Google Drive',
        target: 'https://drivemcp.googleapis.com/mcp/v1',
        status: 'connected',
      },
    ]);
  });

  it('ignores the health-check header and blank lines', () => {
    expect(parseMcpList('Checking MCP server health…\n\n\n')).toEqual([]);
  });

  it('maps the other documented statuses', () => {
    const servers = parseMcpList(
      [
        'a: https://a/mcp - ⏸ Pending approval',
        'b: https://b/mcp - ✗ Failed to connect',
        'c: https://c/mcp - ✻ Something new',
      ].join('\n'),
    );
    expect(servers.map(s => s.status)).toEqual(['pending', 'failed', 'unknown']);
  });

  it('splits on the last separator so a local command line survives', () => {
    const servers = parseMcpList('fs: npx -y server-fs --root /tmp - ✔ Connected');
    expect(servers).toEqual([
      { name: 'fs', target: 'npx -y server-fs --root /tmp', status: 'connected' },
    ]);
  });

  it('returns nothing for unparseable output instead of throwing', () => {
    expect(parseMcpList('No MCP servers configured.')).toEqual([]);
    expect(parseMcpList('')).toEqual([]);
  });
});

describe('buildMcpData', () => {
  it('lists only servers reported by the live list', () => {
    const data = buildMcpData([live('claude.ai Gmail')], disk(), okProbe);
    expect(data.cloudServers.map(s => s.name)).toEqual(['claude.ai Gmail']);
    expect(data.cloudServers[0].status).toBe('connected');
    expect(data.cloudServers[0].live).toBe(true);
  });

  it('demotes an ever-connected name the live list does not know to stale', () => {
    const data = buildMcpData([live('claude.ai Gmail')], disk(), okProbe);
    expect(data.unlistedServers.map(s => s.name)).toEqual(['claude.ai Synthesize Bio']);
    const stale = data.unlistedServers[0];
    expect(stale.live).toBe(false);
    expect(stale.status).toBe('unlisted');
    // A server that no longer exists is active nowhere.
    expect(stale.enabledInProjects).toBe(0);
  });

  it('surfaces a live server missing from the ever-connected cache', () => {
    const data = buildMcpData([live('claude.ai Splice', 'needs-auth')], disk(), okProbe);
    expect(data.cloudServers.map(s => s.name)).toEqual(['claude.ai Splice']);
    expect(data.cloudServers[0].needsAuth).toBe(true);
    expect(data.unlistedServers.map(s => s.name)).toEqual([
      'claude.ai Gmail',
      'claude.ai Synthesize Bio',
    ]);
  });

  it('picks up a stale name left behind by a per-project toggle alone', () => {
    const data = buildMcpData(
      [],
      disk({
        everConnected: [],
        projects: [{ path: '/p/a', disabled: ['claude.ai Expedia'], enabled: [] }],
      }),
      okProbe,
    );
    expect(data.unlistedServers.map(s => s.name)).toEqual(['claude.ai Expedia']);
  });

  it('keeps the per-project enabled/disabled counts for live servers', () => {
    const data = buildMcpData([live('claude.ai Gmail')], disk(), okProbe);
    const gmail = data.cloudServers[0];
    expect(gmail.enabledInProjects).toBe(1);
    expect(gmail.disabledProjectPaths).toEqual(['/p/b']);
    expect(data.totalProjects).toBe(2);
  });

  it('keeps a server disabled in every project in the live list', () => {
    // `claude mcp list` is account-wide: a connector every project has turned off
    // still exists, and the counts (not its absence) carry that dimension.
    const data = buildMcpData(
      [live('claude.ai Gmail')],
      disk({ projects: [{ path: '/p/b', disabled: ['claude.ai Gmail'], enabled: [] }] }),
      okProbe,
    );
    expect(data.cloudServers[0].live).toBe(true);
    expect(data.cloudServers[0].enabledInProjects).toBe(0);
    expect(data.unlistedServers.map(s => s.name)).not.toContain('claude.ai Gmail');
  });

  it('reports no stale servers when the live read failed', () => {
    // Without a live list we cannot tell stale from live: claiming a server is
    // unlisted would be the same guess this rewrite removes, in the other direction.
    const data = buildMcpData([], disk(), {
      command: MCP_LIST_COMMAND,
      observedAt: null,
      error: 'claude timed out after 45000ms',
    });
    expect(data.unlistedServers).toHaveLength(0);
    expect(data.cloudServers).toHaveLength(0);
    expect(data.probe.error).toContain('timed out');
  });

  it('merges local configs with their live status', () => {
    const data = buildMcpData(
      [{ name: 'filesystem', target: 'npx -y server-fs', status: 'connected' }],
      disk({ localConfigs: { filesystem: { command: 'npx', args: ['-y', 'server-fs'] } } }),
      okProbe,
    );
    expect(data.cloudServers).toHaveLength(0);
    expect(data.localServers).toHaveLength(1);
    expect(data.localServers[0]).toMatchObject({ command: 'npx', status: 'connected', live: true });
  });

  it('marks a configured local server the live list omits as unlisted', () => {
    const data = buildMcpData([], disk({ localConfigs: { broken: { command: 'nope' } } }), okProbe);
    expect(data.localServers[0].status).toBe('unlisted');
    expect(data.localServers[0].live).toBe(false);
  });

  it('does not claim a local server is unlisted when the live read failed', () => {
    const data = buildMcpData([], disk({ localConfigs: { fs: { command: 'npx' } } }), {
      command: MCP_LIST_COMMAND,
      observedAt: null,
      error: 'CLI not on PATH',
    });
    expect(data.localServers[0].status).toBe('unknown');
  });

  it('carries the needs-auth cache onto a server the CLI reports as connected', () => {
    const data = buildMcpData([live('claude.ai Atlassian')], disk({ needsAuth: ['claude.ai Atlassian'] }), okProbe);
    expect(data.cloudServers[0].needsAuth).toBe(true);
  });
});
