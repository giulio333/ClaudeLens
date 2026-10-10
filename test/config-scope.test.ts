// The settings cascade, as the Config pages read it. Two questions ride on this
// module — "which file set this value?" and "what does this project change?" —
// and both are answered from the tiers `resolveSettings` returns, so what is
// pinned here is the reading of those tiers: which tier a source name means,
// which file a path is printed as, and what counts as set by the project.

import { describe, it, expect } from 'vitest';
import {
  isProjectTier,
  permissionRuleCount,
  projectSettings,
  settingValue,
  settingsCascade,
  settingsFilePath,
  settingsTier,
  sourceLabel,
} from '../src/components/project/settings/config-scope';
import type { SettingsSourceEntry } from '../src/types';

const HOME = '/Users/alice';
const ROOT = '/Users/alice/Projects/acme';

function tiers(): SettingsSourceEntry[] {
  return [
    {
      source: 'user',
      path: `${HOME}/.claude/settings.json`,
      settings: { cleanupPeriodDays: 30, permissions: { allow: ['Read(~/notes/**)'] } },
    },
    {
      source: 'project',
      path: `${ROOT}/.claude/settings.json`,
      settings: {
        model: 'claude-opus-5',
        permissions: { allow: ['Bash(npm test)', 'Bash(npm run lint)'], deny: ['Read(./.env)'] },
      },
    },
  ];
}

describe('settings tiers', () => {
  it('reads both spellings of a source as the same tier', () => {
    // `resolveSettings` says `user`; the permission API and older captures say
    // `userSettings`. A stamp must not show two names for one file.
    expect(settingsTier('user')).toBe('user');
    expect(settingsTier('userSettings')).toBe('user');
    expect(settingsTier('managed')).toBe('managed');
    expect(settingsTier('policySettings')).toBe('managed');
    expect(sourceLabel('projectSettings')).toBe('Project');
    expect(sourceLabel('local')).toBe('Local');
  });

  it('keeps the name of a source it has no tier for', () => {
    expect(settingsTier('cliArg')).toBeNull();
    expect(sourceLabel('cliArg')).toBe('cliArg');
  });

  it('counts the shared and the local file as the project, and nothing else', () => {
    expect(isProjectTier('project')).toBe(true);
    expect(isProjectTier('localSettings')).toBe(true);
    expect(isProjectTier('user')).toBe(false);
    expect(isProjectTier('managed')).toBe(false);
  });
});

describe('settingsFilePath', () => {
  it('prints a project file relative to the project and a user file from the home', () => {
    expect(settingsFilePath(`${ROOT}/.claude/settings.json`, 'project', ROOT)).toBe(
      '.claude/settings.json'
    );
    expect(settingsFilePath(`${HOME}/.claude/settings.json`, 'user', ROOT)).toBe(
      '~/.claude/settings.json'
    );
  });

  it('never strips the home from the user file when the scope is the home itself', () => {
    // The global page resolves against the home directory: relative to that
    // "project" the user file would print as `.claude/settings.json`, the exact
    // name of a project's own file.
    expect(settingsFilePath(`${HOME}/.claude/settings.json`, 'user', HOME)).toBe(
      '~/.claude/settings.json'
    );
  });
});

describe('settingsCascade', () => {
  it('always lists the three files, lowest precedence first', () => {
    const cells = settingsCascade(tiers(), ROOT);
    expect(cells.map(c => c.label)).toEqual(['User', 'Project', 'Local']);
    expect(cells.map(c => c.keys)).toEqual([2, 2, 0]);
    expect(cells.map(c => c.here)).toEqual([false, true, true]);
    expect(cells[0].path).toBe('~/.claude/settings.json');
    expect(cells[1].path).toBe('.claude/settings.json');
  });

  it('keeps a tier that sets nothing, with no file claimed for it', () => {
    const local = settingsCascade(tiers(), ROOT)[2];
    expect(local).toMatchObject({ label: 'Local', keys: 0, path: null });
  });

  it('adds a managed tier after the files only when the SDK returned one', () => {
    expect(settingsCascade([], ROOT).map(c => c.label)).toEqual(['User', 'Project', 'Local']);
    const withPolicy = settingsCascade(
      [...tiers(), { source: 'managed', settings: { permissions: { deny: ['WebFetch'] } } }],
      ROOT
    );
    expect(withPolicy.map(c => c.label)).toEqual(['User', 'Project', 'Local', 'Managed']);
    expect(withPolicy[3]).toMatchObject({ keys: 1, here: false, path: null });
  });
});

describe('projectSettings', () => {
  it('lists what the project files set, and only that', () => {
    const rows = projectSettings(tiers(), ROOT);
    expect(rows.map(r => r.key)).toEqual(['model', 'permissions']);
    expect(rows[0]).toMatchObject({
      label: 'Configured model',
      value: 'claude-opus-5',
      path: '.claude/settings.json',
    });
  });

  it('counts the rules the project wrote, not the merged list', () => {
    // The user tier allows one more rule. Crediting the merged `permissions` to
    // the project — which is what per-key provenance does — would say three.
    const permissions = projectSettings(tiers(), ROOT).find(r => r.key === 'permissions');
    expect(permissions?.value).toBe('2 allow · 1 deny');
  });

  it('shows a key once per project tier when both set it', () => {
    const rows = projectSettings(
      [
        ...tiers(),
        {
          source: 'local',
          path: `${ROOT}/.claude/settings.local.json`,
          settings: { model: 'claude-haiku-4-5' },
        },
      ],
      ROOT
    );
    expect(rows.filter(r => r.key === 'model').map(r => [r.source, r.value])).toEqual([
      ['project', 'claude-opus-5'],
      ['local', 'claude-haiku-4-5'],
    ]);
  });

  it('is empty for a project with no settings files of its own', () => {
    expect(projectSettings([tiers()[0]], ROOT)).toEqual([]);
  });
});

describe('settingValue', () => {
  it('prints a scalar and counts a structure', () => {
    expect(settingValue('model', 'claude-opus-5')).toBe('claude-opus-5');
    expect(settingValue('includeCoAuthoredBy', false)).toBe('false');
    expect(settingValue('cleanupPeriodDays', 1)).toBe('1 day');
    expect(settingValue('hooks', { PreToolUse: [], Stop: [] })).toBe('2 keys');
    expect(settingValue('enabledMcpjsonServers', ['tracker'])).toBe('1 entry');
  });

  it('says so when a permissions object carries no rule', () => {
    expect(settingValue('permissions', {})).toBe('no rules');
    expect(settingValue('permissions', { defaultMode: 'plan' })).toBe('mode plan');
  });
});

describe('permissionRuleCount', () => {
  it('adds allow, ask and deny, and treats a missing list as none', () => {
    expect(permissionRuleCount({ allow: ['a', 'b'], deny: ['c'] })).toBe(3);
    expect(permissionRuleCount({ defaultMode: 'default' })).toBe(0);
    expect(permissionRuleCount(undefined)).toBe(0);
  });
});
