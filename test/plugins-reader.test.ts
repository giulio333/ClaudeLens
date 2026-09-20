import { describe, it, expect } from 'vitest';
import { parsePluginMcpServers, parsePluginHooks } from '../electron/modules/plugins-reader';

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
