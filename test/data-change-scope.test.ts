import { scopesForPath, type DataScope } from '../electron/modules/data-change-scope';
import { join } from 'path';

const CLAUDE = join('/Users', 'tester', '.claude');
const PROJECT = join(CLAUDE, 'projects', '-Users-tester-app');

/** Order-insensitive: the classifier builds its scopes from a Set. */
function scopes(path: string): DataScope[] | null {
  const out = scopesForPath(path, CLAUDE);
  return out === null ? null : [...out].sort();
}

describe('scopesForPath', () => {
  it('maps a session transcript to sessions, cost, plans and memory', () => {
    // `plans` is here on purpose: plan refs live INSIDE the transcript, as
    // plan_mode attachments — see plans-reader.
    expect(scopes(join(PROJECT, 'abc-123.jsonl'))).toEqual(['cost', 'memory', 'plans', 'sessions']);
  });

  it('maps a transcript under the sessions/ subdir the same way', () => {
    expect(scopes(join(PROJECT, 'sessions', 'abc-123.jsonl'))).toEqual([
      'cost',
      'memory',
      'plans',
      'sessions',
    ]);
  });

  it('maps a sub-agent transcript to sessions and teams, never to cost or plans', () => {
    // cost-tracker and plans-reader glob `*.jsonl` non-recursively, so a sidecar
    // transcript cannot change either figure.
    expect(scopes(join(PROJECT, 'abc-123', 'subagents', 'agent-a1.jsonl'))).toEqual([
      'sessions',
      'teams',
    ]);
    expect(scopes(join(PROJECT, 'abc-123', 'subagents', 'agent-a1.meta.json'))).toEqual([
      'sessions',
      'teams',
    ]);
  });

  it('maps a workflow run state file to workflows', () => {
    expect(scopes(join(PROJECT, 'abc-123', 'workflows', 'wf_x1.json'))).toEqual(['workflows']);
    expect(scopes(join(PROJECT, 'abc-123', 'workflows', 'scripts', 'review-wf_x1.js'))).toEqual([
      'workflows',
    ]);
  });

  it('gives a workflow sub-agent transcript both branches', () => {
    expect(
      scopes(join(PROJECT, 'abc-123', 'subagents', 'workflows', 'wf_x1', 'agent-1.jsonl'))
    ).toEqual(['sessions', 'teams', 'workflows']);
  });

  it('maps the top-level ~/.claude dirs', () => {
    expect(scopes(join(CLAUDE, 'tasks', 'abc-123', '1.json'))).toEqual(['tasks']);
    expect(scopes(join(CLAUDE, 'plans', 'curious-horizon.md'))).toEqual(['plans']);
    expect(scopes(join(CLAUDE, 'teams', 'session-ab12', 'config.json'))).toEqual(['teams']);
    expect(scopes(join(CLAUDE, 'workflows', 'fix-issue.js'))).toEqual(['studio']);
    expect(scopes(join(CLAUDE, 'plugins', 'installed_plugins.json'))).toEqual(['plugins']);
  });

  it('maps a project-local .claude/workflows script to studio', () => {
    // Native workflow location outside ~/.claude — watched all the same.
    expect(scopes(join('/Users', 'tester', 'code', 'app', '.claude', 'workflows', 'x.js'))).toEqual(
      ['studio']
    );
  });

  it('returns null (= invalidate everything) for anything it cannot classify', () => {
    expect(scopes(join('/Users', 'tester', 'code', 'app', 'src', 'index.ts'))).toBeNull();
    expect(scopes(join(CLAUDE, 'settings.json'))).toBeNull();
    expect(scopes(join(CLAUDE, 'plugins', 'repos', 'foo', 'plugin.json'))).toBeNull();
    expect(scopes(join(CLAUDE, 'projects'))).toBeNull();
    expect(scopes(join(PROJECT))).toBeNull();
    // A project dir child that is neither a transcript nor a known sidecar.
    expect(scopes(join(PROJECT, 'abc-123', 'notes.txt'))).toBeNull();
  });

  it('does not treat a path that merely starts with the claude dir name as inside it', () => {
    expect(scopes(join('/Users', 'tester', '.claude-backup', 'plans', 'x.md'))).toBeNull();
  });
});
