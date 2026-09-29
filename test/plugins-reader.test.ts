import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  getInstalledPlugins,
  isPluginEnabled,
  parsePluginHooks,
  parsePluginMcpServers,
  parseSyncedManifest,
  syncedBucketName,
  syncedPluginDirName,
} from '../electron/modules/plugins-reader';

describe('parsePluginMcpServers', () => {
  it('reads the wrapped shape and keeps only name, transport and endpoint', () => {
    const servers = parsePluginMcpServers({
      mcpServers: {
        docs: {
          type: 'http',
          url: 'https://mcp.example.test/mcp?client=plugin',
          headers: { Authorization: '${DOCS_API_KEY:-}' },
        },
      },
    });
    expect(servers).toEqual([
      { name: 'docs', transport: 'http', target: 'https://mcp.example.test/mcp?client=plugin' },
    ]);
  });

  it('reads the bare map shape too', () => {
    const servers = parsePluginMcpServers({
      forge: { type: 'http', url: 'https://api.example.test/mcp/' },
    });
    expect(servers.map(s => s.name)).toEqual(['forge']);
  });

  it('infers the transport when none is declared: a url is remote, a command is local', () => {
    const servers = parsePluginMcpServers({
      remote: { url: 'https://r.example.test' },
      local: { command: 'npx', args: ['-y', 'some-server'] },
    });
    expect(servers).toEqual([
      { name: 'remote', transport: 'http', target: 'https://r.example.test' },
      { name: 'local', transport: 'stdio', target: 'npx -y some-server' },
    ]);
  });

  it('keeps a declared sse or ws transport as it is', () => {
    const servers = parsePluginMcpServers({
      a: { type: 'sse', url: 'https://a.example.test/sse' },
      b: { type: 'ws', url: 'wss://b.example.test' },
    });
    expect(servers.map(s => s.transport)).toEqual(['sse', 'ws']);
  });

  it('marks an entry with neither url nor command as unknown, with no target', () => {
    expect(parsePluginMcpServers({ odd: { type: 'stdio' } })).toEqual([
      { name: 'odd', transport: 'stdio' },
    ]);
    expect(parsePluginMcpServers({ none: {} })).toEqual([{ name: 'none', transport: 'unknown' }]);
  });

  it('returns nothing for a missing, malformed or non-object file', () => {
    expect(parsePluginMcpServers(null)).toEqual([]);
    expect(parsePluginMcpServers('nope')).toEqual([]);
    expect(parsePluginMcpServers({ mcpServers: { bad: 'string' } })).toEqual([]);
  });
});

describe('parsePluginHooks', () => {
  it('flattens one entry per event-and-matcher group with the commands it runs', () => {
    const hooks = parsePluginHooks({
      hooks: {
        SessionStart: [
          {
            matcher: 'startup|clear|compact',
            hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run.cmd" start' }],
          },
        ],
        PreToolUse: [
          {
            hooks: [
              { type: 'command', command: './a.sh' },
              { type: 'command', command: './b.sh' },
            ],
          },
        ],
      },
    });
    expect(hooks).toEqual([
      {
        event: 'SessionStart',
        matcher: 'startup|clear|compact',
        commands: ['"${CLAUDE_PLUGIN_ROOT}/hooks/run.cmd" start'],
      },
      { event: 'PreToolUse', commands: ['./a.sh', './b.sh'] },
    ]);
  });

  it('skips handlers with no command and groups that are not objects', () => {
    const hooks = parsePluginHooks({
      hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: 'x' }] }, 'junk'] },
    });
    expect(hooks).toEqual([{ event: 'Stop', commands: [] }]);
  });

  it('returns nothing for a missing or malformed file', () => {
    expect(parsePluginHooks(null)).toEqual([]);
    expect(parsePluginHooks({ hooks: 'nope' })).toEqual([]);
    expect(parsePluginHooks({})).toEqual([]);
  });
});

// Made-up ids: the real ones are the user's organization and account.
const ORG = '0a1b2c3d-1111-4222-8333-444455556666';
const ACCOUNT = '7e8f9a0b-7777-4888-9999-aaaabbbbcccc';
const OTHER_ORG = 'deadbeef-0000-4000-8000-000000000001';
const OTHER_ACCOUNT = 'deadbeef-0000-4000-8000-000000000002';

describe('syncedBucketName', () => {
  it('builds <org>_<account> in lowercase, the name the CLI gives the folder', () => {
    expect(
      syncedBucketName({ organizationUuid: ORG.toUpperCase(), accountUuid: ACCOUNT.toUpperCase() })
    ).toBe(`${ORG}_${ACCOUNT}`);
  });

  it('names no folder without both ids, or with ids that are not UUIDs', () => {
    expect(syncedBucketName(undefined)).toBeNull();
    expect(syncedBucketName({ organizationUuid: ORG })).toBeNull();
    expect(syncedBucketName({ organizationUuid: ORG, accountUuid: '../../etc' })).toBeNull();
    expect(syncedBucketName('not an object')).toBeNull();
  });
});

describe('syncedPluginDirName', () => {
  it('adds the generation past the first, as ~g<N>', () => {
    expect(syncedPluginDirName('data', 1)).toBe('data');
    expect(syncedPluginDirName('data', 2)).toBe('data~g2');
  });

  it('replaces what a file name cannot hold and drops trailing dots and spaces', () => {
    expect(syncedPluginDirName('a/b:c', 1)).toBe('a_b_c');
    expect(syncedPluginDirName('notes. ', 1)).toBe('notes');
  });

  it('names nothing for a name that leaves nothing, .. included', () => {
    expect(syncedPluginDirName('..', 1)).toBeNull();
    expect(syncedPluginDirName(' ', 1)).toBeNull();
  });
});

describe('parseSyncedManifest', () => {
  it('drops not_available entries and keeps every other preference', () => {
    const entries = parseSyncedManifest({
      plugins: [
        { name: 'a', installationPreference: 'available', marketplaceName: 'kw' },
        { name: 'b', installationPreference: 'required', generation: 3 },
        { name: 'c', installationPreference: 'not_available' },
        { name: 'd', installationPreference: 'auto_install' },
      ],
    });
    expect(entries).toEqual([
      { name: 'a', marketplaceName: 'kw', generation: 1 },
      { name: 'b', generation: 3 },
      { name: 'd', generation: 1 },
    ]);
  });

  it('returns nothing for a malformed manifest and skips entries with no name', () => {
    expect(parseSyncedManifest(null)).toEqual([]);
    expect(parseSyncedManifest({ plugins: 'nope' })).toEqual([]);
    expect(parseSyncedManifest({ plugins: [{}, 'x', { name: '' }] })).toEqual([]);
  });
});

describe('isPluginEnabled', () => {
  it('follows the enabledPlugins entry, else the plugin default', () => {
    expect(isPluginEnabled(true)).toBe(true);
    expect(isPluginEnabled(['x'])).toBe(true);
    expect(isPluginEnabled(false)).toBe(false);
    expect(isPluginEnabled(undefined)).toBe(true);
    expect(isPluginEnabled(undefined, false)).toBe(false);
    expect(isPluginEnabled(true, false)).toBe(true);
  });
});

describe('getInstalledPlugins', () => {
  let root: string;
  let claudeDir: string;
  let configPath: string;

  const write = (path: string, content: unknown) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  };
  const pluginAt = (dir: string, manifest: Record<string, unknown>, skill?: string) => {
    write(join(dir, '.claude-plugin', 'plugin.json'), manifest);
    if (skill) {
      write(
        join(dir, 'skills', skill, 'SKILL.md'),
        `---\nname: ${skill}\ndescription: Does ${skill}.\n---\nBody\n`
      );
    }
  };
  const bucketDir = (org: string, account: string) =>
    join(claudeDir, 'plugins', 'synced', `${org}_${account}`);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cl-plugins-'));
    claudeDir = join(root, '.claude');
    configPath = join(root, '.claude.json');

    const toolPath = join(claudeDir, 'plugins', 'cache', 'mkt', 'tool', '1.0.0');
    const offPath = join(claudeDir, 'plugins', 'cache', 'mkt', 'off', '2.0.0');
    pluginAt(toolPath, { name: 'tool', description: 'A tool.' }, 'greet');
    pluginAt(offPath, { name: 'off' });
    write(join(claudeDir, 'plugins', 'installed_plugins.json'), {
      version: 2,
      plugins: {
        'tool@mkt': [{ scope: 'user', installPath: toolPath, version: '1.0.0' }],
        'off@mkt': [{ scope: 'user', installPath: offPath, version: '2.0.0' }],
      },
    });
    write(join(claudeDir, 'settings.json'), { enabledPlugins: { 'off@mkt': false } });

    const mine = bucketDir(ORG, ACCOUNT);
    write(join(mine, 'manifest.json'), {
      plugins: [
        {
          name: 'notes',
          marketplaceName: 'kw',
          version: '0040',
          installationPreference: 'available',
        },
        { name: 'data', marketplaceName: 'kw', generation: 2, installationPreference: 'available' },
        { name: 'hidden', marketplaceName: 'kw', installationPreference: 'not_available' },
        { name: 'missing', marketplaceName: 'kw', installationPreference: 'available' },
      ],
    });
    pluginAt(join(mine, 'notes'), { name: 'notes', version: '1.1.0' }, 'jot');
    // A stale first generation beside the current one: the manifest says which.
    pluginAt(join(mine, 'data'), { name: 'data', version: '0.9.0' }, 'old-query');
    pluginAt(join(mine, 'data~g2'), { name: 'data', version: '1.0.0' }, 'query');
    pluginAt(join(mine, 'hidden'), { name: 'hidden' });

    // Another login on the same machine: its plugins are not loaded now.
    const theirs = bucketDir(OTHER_ORG, OTHER_ACCOUNT);
    write(join(theirs, 'manifest.json'), {
      plugins: [
        { name: 'ledger', marketplaceName: 'kw', installationPreference: 'available' },
      ],
    });
    pluginAt(join(theirs, 'ledger'), { name: 'ledger' });

    write(configPath, { oauthAccount: { organizationUuid: ORG, accountUuid: ACCOUNT } });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists installed plugins, then the logged-in account's synced ones, and no other account's", async () => {
    const plugins = await getInstalledPlugins(claudeDir, configPath);
    expect(plugins.map(p => `${p.source}:${p.name}`)).toEqual([
      'marketplace:off',
      'marketplace:tool',
      'synced:data',
      'synced:notes',
    ]);
  });

  it('marks a plugin enabledPlugins turns off, and leaves the rest on', async () => {
    const plugins = await getInstalledPlugins(claudeDir, configPath);
    const enabled = Object.fromEntries(plugins.map(p => [p.name, p.enabled]));
    expect(enabled).toEqual({ off: false, tool: true, data: true, notes: true });
  });

  it("reads a synced plugin from its current generation, with its own manifest's version", async () => {
    const plugins = await getInstalledPlugins(claudeDir, configPath);
    const data = plugins.find(p => p.name === 'data')!;
    expect(data.installPath).toBe(join(bucketDir(ORG, ACCOUNT), 'data~g2'));
    expect(data.marketplace).toBe('kw');
    expect(data.version).toBe('1.0.0');
    expect(data.skills.map(s => s.name)).toEqual(['query']);
    // The sync manifest's `version` is a server revision, never shown.
    expect(plugins.find(p => p.name === 'notes')!.version).toBe('1.1.0');
  });

  it('lists no synced plugin without an account, rather than every folder on disk', async () => {
    write(configPath, { primaryApiKey: 'set' });
    const plugins = await getInstalledPlugins(claudeDir, configPath);
    expect(plugins.every(p => p.source === 'marketplace')).toBe(true);
  });

  it('follows a login to the other account', async () => {
    write(configPath, {
      oauthAccount: { organizationUuid: OTHER_ORG, accountUuid: OTHER_ACCOUNT },
    });
    const plugins = await getInstalledPlugins(claudeDir, configPath);
    expect(plugins.filter(p => p.source === 'synced').map(p => p.name)).toEqual(['ledger']);
  });
});
