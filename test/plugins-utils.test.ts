import { describe, it, expect } from 'vitest';
import {
  pluginComponentCount,
  pluginComponentGroups,
  skylineHeight,
} from '../src/components/project/plugins/utils';
import type { InstalledPlugin } from '../src/types';

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    name: 'test-plugin',
    marketplace: 'test-marketplace',
    scope: 'user',
    version: '1.0.0',
    installPath: '/nowhere',
    skills: [],
    agents: [],
    commands: [],
    ...overrides,
  };
}

function skill(name: string) {
  return { name, path: `/nowhere/${name}`, scope: 'plugin' as const, content: '', rawContent: '' };
}

function agent(name: string) {
  return {
    name,
    path: `/nowhere/${name}`,
    scope: 'plugin' as const,
    content: '',
    rawContent: '',
    missingRequired: [],
    filenameHasSpaces: false,
  };
}

function command(name: string) {
  return { name, path: `/nowhere/${name}`, description: '', content: '', rawContent: '' };
}

describe('pluginComponentCount', () => {
  it('sums skills, agents and commands', () => {
    const p = plugin({
      skills: [skill('a'), skill('b')],
      agents: [agent('c')],
      commands: [command('d')],
    });
    expect(pluginComponentCount(p)).toBe(4);
  });

  it('is zero for an MCP-only plugin', () => {
    expect(pluginComponentCount(plugin())).toBe(0);
  });
});

describe('pluginComponentGroups', () => {
  it('skips kinds the plugin does not carry', () => {
    const p = plugin({ skills: [skill('xlsx')] });
    const groups = pluginComponentGroups(p);
    expect(groups).toEqual([{ kind: 'skills', names: ['xlsx'] }]);
  });

  it('returns an empty array for an MCP-only plugin, not a placeholder group', () => {
    expect(pluginComponentGroups(plugin())).toEqual([]);
  });

  it('prefixes command names with a leading slash', () => {
    const p = plugin({ commands: [command('delete-system')] });
    expect(pluginComponentGroups(p)).toEqual([{ kind: 'commands', names: ['/delete-system'] }]);
  });

  it('preserves kind order: skills, agents, commands', () => {
    const p = plugin({
      commands: [command('c')],
      skills: [skill('s')],
      agents: [agent('a')],
    });
    expect(pluginComponentGroups(p).map(g => g.kind)).toEqual(['skills', 'agents', 'commands']);
  });
});

describe('skylineHeight', () => {
  it('reaches the max height for the richest plugin', () => {
    expect(skylineHeight(19, 19)).toBe(60);
  });

  it('floors at the min height for an empty plugin', () => {
    expect(skylineHeight(0, 19)).toBe(14);
  });

  it('never returns less than the floor when max is zero (no plugin has components)', () => {
    expect(skylineHeight(0, 0)).toBe(14);
  });

  it('grows sub-linearly — a plugin with a quarter of the max components is well over a quarter of the height', () => {
    const quarter = skylineHeight(5, 19) - 14;
    const full = 60 - 14;
    expect(quarter / full).toBeGreaterThan(0.4);
  });

  it('clamps a count above max instead of overflowing the bar', () => {
    expect(skylineHeight(100, 19)).toBe(skylineHeight(19, 19));
  });
});
