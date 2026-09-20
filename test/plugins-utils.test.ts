import {
  describeVersion,
  firstSentence,
  groupByMarketplace,
  pluginComponentCount,
  pluginComponentSummary,
  repoUrl,
  shortInstallPath,
  stepPlugin,
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
    mcpServers: [],
    hooks: [],
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

describe('pluginComponentSummary', () => {
  it('spells the count out by kind, in skills → agents → commands order', () => {
    const p = plugin({
      commands: [command('c')],
      skills: [skill('s1'), skill('s2')],
      agents: [agent('a')],
    });
    expect(pluginComponentSummary(p)).toBe('2 skills, 1 agent, 1 command');
  });

  it('skips kinds the plugin does not carry', () => {
    expect(pluginComponentSummary(plugin({ skills: [skill('xlsx')] }))).toBe('1 skill');
  });

  it('counts MCP servers and hooks as things the plugin adds', () => {
    const p = plugin({
      mcpServers: [{ name: 'docs', transport: 'http', target: 'https://example.test/mcp' }],
      hooks: [{ event: 'SessionStart', commands: ['./hooks/start.sh'] }],
    });
    expect(pluginComponentCount(p)).toBe(2);
    expect(pluginComponentSummary(p)).toBe('1 MCP server, 1 hook');
  });

  it('says so for a plugin with nothing to list instead of printing nothing', () => {
    expect(pluginComponentSummary(plugin())).toBe('nothing to list');
  });
});

describe('groupByMarketplace', () => {
  it('keeps the incoming order both across marketplaces and within one', () => {
    const groups = groupByMarketplace([
      plugin({ name: 'b', marketplace: 'one' }),
      plugin({ name: 'z', marketplace: 'two' }),
      plugin({ name: 'a', marketplace: 'one' }),
    ]);
    expect([...groups.keys()]).toEqual(['one', 'two']);
    expect(groups.get('one')!.map(p => p.name)).toEqual(['b', 'a']);
  });
});

describe('stepPlugin', () => {
  const a = plugin({ name: 'a', marketplace: 'm' });
  const b = plugin({ name: 'b', marketplace: 'm' });
  const c = plugin({ name: 'c', marketplace: 'n' });

  it('moves one step through the visible plugins', () => {
    expect(stepPlugin([a, b, c], b, 1)).toBe(c);
    expect(stepPlugin([a, b, c], b, -1)).toBe(a);
  });

  it('clamps at either end instead of wrapping', () => {
    expect(stepPlugin([a, b, c], c, 1)).toBe(c);
    expect(stepPlugin([a, b, c], a, -1)).toBe(a);
  });

  it('starts from the top when the current plugin is hidden or unset', () => {
    // `b` sits in a collapsed marketplace: not in the visible list.
    expect(stepPlugin([a, c], b, 1)).toBe(a);
    expect(stepPlugin([a, c], null, -1)).toBe(a);
  });

  it('returns null when nothing is visible', () => {
    expect(stepPlugin([], a, 1)).toBeNull();
  });
});

describe('firstSentence', () => {
  it('cuts at the first period a capital follows', () => {
    expect(firstSentence('Use this for PDFs. This includes merging files.')).toBe(
      'Use this for PDFs.'
    );
  });

  it('does not mistake an abbreviation or a file extension for the end', () => {
    expect(
      firstSentence('Edit spreadsheets (e.g. adding columns) in .xlsx files. Then more.')
    ).toBe('Edit spreadsheets (e.g. adding columns) in .xlsx files.');
  });

  it('returns a description with no sentence break whole, trimmed', () => {
    expect(firstSentence('  Generate a changelog entry from the staged diff  ')).toBe(
      'Generate a changelog entry from the staged diff'
    );
  });

  it('treats a line break after the period as a break too', () => {
    expect(firstSentence('First line.\nSecond line.')).toBe('First line.');
  });
});

describe('describeVersion', () => {
  it('labels a number as a version', () => {
    expect(describeVersion('1.2.0')).toEqual({ label: 'Version', value: '1.2.0' });
  });

  it('labels a hex hash as the commit it is, cut to seven digits', () => {
    expect(describeVersion('34040c9c5685')).toEqual({ label: 'Commit', value: '34040c9' });
  });

  it('says nothing for an unknown or empty version', () => {
    expect(describeVersion('unknown')).toBeNull();
    expect(describeVersion('')).toBeNull();
  });
});

describe('repoUrl', () => {
  it('sends an owner/name slug to GitHub and keeps a URL as it is', () => {
    expect(repoUrl('acme/skills')).toBe('https://github.com/acme/skills');
    expect(repoUrl('https://git.example.test/acme/skills')).toBe(
      'https://git.example.test/acme/skills'
    );
  });

  it('gives no link for anything else', () => {
    expect(repoUrl('local')).toBeNull();
    expect(repoUrl('a/b/c')).toBeNull();
  });
});

describe('shortInstallPath', () => {
  it('cuts the plugins root every install shares', () => {
    expect(shortInstallPath('/Users/alice/.claude/plugins/cache/mkt/tool/1.0.0')).toBe(
      'cache/mkt/tool/1.0.0'
    );
  });

  it('leaves a path outside that root whole', () => {
    expect(shortInstallPath('/opt/plugins/tool')).toBe('/opt/plugins/tool');
  });
});
