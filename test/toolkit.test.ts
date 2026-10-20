// What the TOOLKIT panel lists, set from the SDK handshake against the
// session's own calls. The claims: a called name leaves "available" and is
// counted once per call, most-called first; the match ignores the case the
// transcript reader lowercases slash commands to; a call the handshake does not
// list is still a use; MCP tools never count, since the probe closes before a
// server connects; and only failed servers are reported.

import { describe, expect, it } from 'vitest';
import { buildToolkit, splitNamespace } from '../src/components/project/terminal/toolkit';
import type { InitInfo } from '../src/types';

function init(over: Partial<InitInfo> = {}): InitInfo {
  return {
    permissionMode: 'default',
    model: 'claude-opus-5-5',
    cwd: '/work/acme',
    apiKeySource: 'none',
    claudeCodeVersion: '2.1.283',
    cliSource: 'bundled',
    tools: ['Write', 'Bash', 'Read', 'mcp__alpha__lookup'],
    mcpServers: [],
    slashCommands: [],
    outputStyle: 'default',
    skills: ['zeta', 'alpha:Draft', 'beta', 'gamma'],
    agents: ['Explore', 'reviewer', 'Plan'],
    plugins: [],
    models: [],
    ...over,
  };
}

describe('buildToolkit', () => {
  it('leads with what the session called, most-called first, and folds the rest', () => {
    const kit = buildToolkit(init(), ['beta', 'gamma', 'gamma', 'beta', 'gamma'], []);
    expect(kit.skills.used).toEqual([
      { name: 'gamma', uses: 3 },
      { name: 'beta', uses: 2 },
    ]);
    expect(kit.skills.available).toEqual(['alpha:Draft', 'zeta']);
  });

  it('keeps the order of the first call between names called as often', () => {
    const kit = buildToolkit(init(), [], ['reviewer', 'Explore']);
    expect(kit.agents.used.map(u => u.name)).toEqual(['reviewer', 'Explore']);
    expect(kit.agents.available).toEqual(['Plan']);
  });

  it('matches a lowercased slash command to the name as the handshake spells it', () => {
    const kit = buildToolkit(init(), ['alpha:draft'], []);
    expect(kit.skills.used).toEqual([{ name: 'alpha:Draft', uses: 1 }]);
    expect(kit.skills.available).not.toContain('alpha:Draft');
  });

  it('counts a call the handshake does not list, without inventing it as available', () => {
    const kit = buildToolkit(init(), ['retired'], []);
    expect(kit.skills.used).toEqual([{ name: 'retired', uses: 1 }]);
    expect(kit.skills.available).toEqual(['alpha:Draft', 'beta', 'gamma', 'zeta']);
  });

  it('lists the built-in tools only, alphabetical', () => {
    expect(buildToolkit(init(), [], []).tools).toEqual(['Bash', 'Read', 'Write']);
  });

  it('reports only the servers that failed, grouped and counted', () => {
    const kit = buildToolkit(
      init({
        mcpServers: [
          { name: 'plugin:alpha:first', status: 'failed', source: 'plugin' },
          { name: 'plugin:alpha:second', status: 'failed', source: 'plugin' },
          { name: 'local-db', status: 'failed', source: 'project' },
          { name: 'claude.ai Mail', status: 'needs-auth', source: 'claudeai' },
          { name: 'ide', status: 'pending' },
          { name: 'docs', status: 'connected', source: 'user' },
        ],
      }),
      [],
      []
    );
    expect(kit.mcpFailedCount).toBe(3);
    expect(kit.mcpFailed).toEqual([
      { plugin: 'alpha', servers: ['first', 'second'] },
      { plugin: null, source: 'project', servers: ['local-db'] },
    ]);
  });

  it('says zero failed for a handshake with no failure', () => {
    const kit = buildToolkit(init({ mcpServers: [{ name: 'ide', status: 'pending' }] }), [], []);
    expect(kit.mcpFailedCount).toBe(0);
    expect(kit.mcpFailed).toEqual([]);
  });
});

describe('splitNamespace', () => {
  it('splits the namespace a plugin adds from the name', () => {
    expect(splitNamespace('alpha:draft')).toEqual({ ns: 'alpha:', base: 'draft' });
    expect(splitNamespace('beta')).toEqual({ ns: '', base: 'beta' });
  });
});
