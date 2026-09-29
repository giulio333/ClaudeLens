// The failed MCP servers behind Mission Control's environment strip, grouped by
// where a reader goes to fix them: the plugin that ships them, or the scope
// they were configured in.

import { describe, it, expect } from 'vitest';
import { failedMcpGroups, isFailedMcp } from '../src/components/project/terminal/mcp-health';

describe('isFailedMcp', () => {
  it('reads `failed` and an error status as a failure, and nothing else', () => {
    expect(isFailedMcp('failed')).toBe(true);
    expect(isFailedMcp('Error: spawn ENOENT')).toBe(true);
    for (const s of ['connected', 'pending', 'needs-auth', 'disabled']) {
      expect(isFailedMcp(s)).toBe(false);
    }
  });
});

describe('failedMcpGroups', () => {
  it('is empty when nothing failed', () => {
    expect(
      failedMcpGroups([
        { name: 'claude.ai Mail', status: 'needs-auth' },
        { name: 'plugin:alpha:beta', status: 'connected' },
      ])
    ).toEqual([]);
  });

  it('names each plugin once and drops its prefix from the servers it ships', () => {
    expect(
      failedMcpGroups([
        { name: 'plugin:alpha:first server', status: 'failed', source: 'plugin' },
        { name: 'plugin:gamma:third', status: 'failed', source: 'plugin' },
        { name: 'plugin:alpha:second', status: 'failed', source: 'plugin' },
        { name: 'plugin:gamma:fourth', status: 'connected', source: 'plugin' },
      ])
    ).toEqual([
      { plugin: 'alpha', servers: ['first server', 'second'] },
      { plugin: 'gamma', servers: ['third'] },
    ]);
  });

  it('splits only the first two colons, so a server name may hold one', () => {
    expect(failedMcpGroups([{ name: 'plugin:alpha:api:v2', status: 'failed' }])).toEqual([
      { plugin: 'alpha', servers: ['api:v2'] },
    ]);
  });

  it('groups a directly-configured server by its scope, and keeps it without one', () => {
    expect(
      failedMcpGroups([
        { name: 'local-db', status: 'failed', source: 'project' },
        { name: 'ide', status: 'failed' },
        { name: 'search', status: 'failed', source: 'user' },
        { name: 'docs', status: 'failed', source: 'project' },
      ])
    ).toEqual([
      { plugin: null, source: 'project', servers: ['local-db', 'docs'] },
      { plugin: null, source: undefined, servers: ['ide'] },
      { plugin: null, source: 'user', servers: ['search'] },
    ]);
  });
});
