import { describe, it, expect } from 'vitest';
import {
  filterCommandGroups,
  groupSlashCommands,
} from '../src/components/project/settings/slash-command-groups';
import type { InitCommand } from '../src/types';

function cmd(name: string, description = '', builtin = false, argumentHint = ''): InitCommand {
  return { name, description, argumentHint, builtin };
}

describe('groupSlashCommands', () => {
  it('puts local commands first, one group per plugin next, built-ins last', () => {
    const { groups, described, total } = groupSlashCommands(
      [
        cmd('compact', 'Free up context', true),
        cmd('widgets:lint', '(widgets) Lint the widgets'),
        cmd('deploy', 'Ship it (project)'),
        cmd('acme:release', '(acme) Cut a release'),
        cmd('acme:rollback', '(acme) Undo a release'),
      ],
      []
    );
    expect(described).toBe(true);
    expect(total).toBe(5);
    expect(groups.map(g => [g.label, g.kind, g.rows.length])).toEqual([
      ['Project & user', 'local', 1],
      ['acme', 'plugin', 2],
      ['widgets', 'plugin', 1],
      ['Built-in', 'builtin', 1],
    ]);
  });

  it('strips the plugin tag only when it names that plugin', () => {
    const { groups } = groupSlashCommands(
      [cmd('acme:release', '(acme) Cut a release'), cmd('acme:notes', 'Uses (other) tools')],
      []
    );
    expect(groups[0].rows.map(r => [r.shortName, r.description])).toEqual([
      ['release', 'Cut a release'],
      ['notes', 'Uses (other) tools'],
    ]);
  });

  it('keeps the description prose of local commands as written', () => {
    const { groups } = groupSlashCommands([cmd('deploy', 'Ship it (project)')], []);
    expect(groups[0].rows[0].description).toBe('Ship it (project)');
  });

  it('keeps two rows that share a name', () => {
    const { groups } = groupSlashCommands(
      [cmd('review', 'Built-in review', true), cmd('review', 'My own review')],
      []
    );
    expect(groups.map(g => g.rows.map(r => r.description))).toEqual([
      ['My own review'],
      ['Built-in review'],
    ]);
  });

  it('falls back to the bare names without claiming any is built-in', () => {
    const { groups, described, total } = groupSlashCommands(undefined, [
      'compact',
      'acme:release',
      'deploy',
    ]);
    expect(described).toBe(false);
    expect(total).toBe(3);
    expect(groups.map(g => [g.label, g.kind, g.rows.map(r => r.name)])).toEqual([
      ['Commands', 'unsorted', ['compact', 'deploy']],
      ['acme', 'plugin', ['acme:release']],
    ]);
  });
});

describe('filterCommandGroups', () => {
  const { groups } = groupSlashCommands(
    [
      cmd('deploy', 'Ship it'),
      cmd('acme:release', '(acme) Cut a release'),
      cmd('compact', 'Free up context', true),
    ],
    []
  );

  it('matches names and descriptions and drops emptied groups', () => {
    expect(filterCommandGroups(groups, 'release').map(g => g.label)).toEqual(['acme']);
    expect(filterCommandGroups(groups, 'context').map(g => g.label)).toEqual(['Built-in']);
  });

  it('returns every group for an empty query', () => {
    expect(filterCommandGroups(groups, '')).toBe(groups);
  });
});
