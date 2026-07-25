import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  categoriesFromPayload,
  classifyChangedPath,
  queryKeysForCategories,
  QUERY_KEYS_BY_CATEGORY,
  type DataChangeRoots,
} from '../electron/shared/data-change';

const CLAUDE = '/home/u/.claude';
const ROOTS: DataChangeRoots = {
  projectsDir: join(CLAUDE, 'projects'),
  tasksDir: join(CLAUDE, 'tasks'),
  plansDir: join(CLAUDE, 'plans'),
  teamsDir: join(CLAUDE, 'teams'),
  pluginsFile: join(CLAUDE, 'plugins', 'installed_plugins.json'),
  workflowsDir: join(CLAUDE, 'workflows'),
};

const HASH = '-Users-u-Projects-Demo';
const SESSION = '11111111-1111-1111-1111-111111111111';
const project = (...parts: string[]) => join(ROOTS.projectsDir, HASH, ...parts);

const classify = (path: string) => classifyChangedPath(path, ROOTS);
const keys = (path: string) => queryKeysForCategories(classify(path));

describe('classifyChangedPath', () => {
  it('maps a session transcript to the transcript bucket', () => {
    expect(classify(project(`${SESSION}.jsonl`))).toEqual(['transcript']);
  });

  it('maps sub-agent artifacts to the subagents bucket', () => {
    expect(classify(project(SESSION, 'subagents', `agent-ax-1.jsonl`))).toEqual(['subagents']);
    expect(classify(project(SESSION, 'subagents', `agent-ax-1.meta.json`))).toEqual(['subagents']);
  });

  it('maps workflow run state and workflow agent transcripts to workflow-runs', () => {
    expect(classify(project(SESSION, 'workflows', 'wf_1.json'))).toEqual(['workflow-runs']);
    expect(classify(project(SESSION, 'workflows', 'scripts', 'review-wf_1.js'))).toEqual([
      'workflow-runs',
    ]);
    expect(classify(project(SESSION, 'subagents', 'workflows', 'wf_1', 'agent-a.jsonl'))).toEqual([
      'workflow-runs',
    ]);
  });

  it('maps project memory, the project folder itself and the global roots', () => {
    expect(classify(project('memory', 'MEMORY.md'))).toEqual(['memory']);
    expect(classify(project())).toEqual(['project-tree']);
    expect(classify(join(ROOTS.tasksDir, SESSION, 'task.json'))).toEqual(['tasks']);
    expect(classify(join(ROOTS.plansDir, 'a-plan.md'))).toEqual(['plans']);
    expect(classify(join(ROOTS.teamsDir, 'session-abc', 'config.json'))).toEqual(['teams']);
    expect(classify(ROOTS.pluginsFile)).toEqual(['plugins']);
    expect(classify(join(ROOTS.workflowsDir, 'fix-issue.js'))).toEqual(['studio']);
  });

  it('maps project-local native workflow scripts to studio', () => {
    expect(classify('/Users/u/Projects/Demo/.claude/workflows/ship.js')).toEqual(['studio']);
    expect(classify('/Users/u/Projects/Demo/.claude/workflows')).toEqual(['studio']);
  });

  it('normalizes Windows separators', () => {
    const roots: DataChangeRoots = {
      projectsDir: 'C:\\Users\\u\\.claude\\projects',
      tasksDir: 'C:\\Users\\u\\.claude\\tasks',
      plansDir: 'C:\\Users\\u\\.claude\\plans',
      teamsDir: 'C:\\Users\\u\\.claude\\teams',
      pluginsFile: 'C:\\Users\\u\\.claude\\plugins\\installed_plugins.json',
      workflowsDir: 'C:\\Users\\u\\.claude\\workflows',
    };
    expect(
      classifyChangedPath(`C:\\Users\\u\\.claude\\projects\\${HASH}\\${SESSION}.jsonl`, roots)
    ).toEqual(['transcript']);
    expect(
      classifyChangedPath(
        `C:\\Users\\u\\.claude\\projects\\${HASH}\\${SESSION}\\subagents\\agent-a.meta.json`,
        roots
      )
    ).toEqual(['subagents']);
  });

  it('falls back to the blanket refresh for unknown paths', () => {
    expect(classify('/home/u/.claude/settings.json')).toEqual(['all']);
    expect(classify('/tmp/whatever')).toEqual(['all']);
  });

  it('never mistakes a sibling directory for a watched root (prefix guard)', () => {
    expect(classify(join(CLAUDE, 'projects-backup', HASH, 'x.jsonl'))).toEqual(['all']);
    expect(classify(join(CLAUDE, 'plansX', 'a.md'))).toEqual(['all']);
  });
});

describe('queryKeysForCategories', () => {
  it('keeps the teams and workflows project scans out of a transcript append', () => {
    const invalidated = keys(project(`${SESSION}.jsonl`));
    expect(invalidated).toContain('sessions:chat');
    expect(invalidated).toContain('sessions:project');
    expect(invalidated).toContain('cost:project');
    // The regression this issue is about: a live chat appending its transcript
    // must not re-run the full project scans behind the subtab badges.
    expect(invalidated).not.toContain('teams:project');
    expect(invalidated).not.toContain('workflows:project');
    expect(invalidated).not.toContain('tasks:project');
    expect(invalidated).not.toContain('studio:all');
  });

  it('refreshes teams (not workflows) on a teammate transcript', () => {
    const invalidated = keys(project(SESSION, 'subagents', 'agent-areviewer-1.meta.json'));
    expect(invalidated).toContain('teams:project');
    expect(invalidated).toContain('teams:detail');
    expect(invalidated).not.toContain('workflows:project');
    expect(invalidated).not.toContain('sessions:chat');
  });

  it('refreshes workflows (not teams) on a run state write', () => {
    const invalidated = keys(project(SESSION, 'workflows', 'wf_1.json'));
    expect(invalidated).toEqual(['workflows:project', 'workflows:run']);
  });

  it('dedupes overlapping keys across categories', () => {
    expect(queryKeysForCategories(['plans', 'transcript'])).toEqual([
      'plans:project',
      'sessions:project',
      'sessions:chat',
      'cost:summary',
      'cost:project',
    ]);
  });

  it("'all' is a superset of every other category (no key only reachable elsewhere)", () => {
    const all = new Set(QUERY_KEYS_BY_CATEGORY.all);
    for (const [category, categoryKeys] of Object.entries(QUERY_KEYS_BY_CATEGORY)) {
      if (category === 'all') continue;
      for (const key of categoryKeys) expect(all.has(key), `${category} → ${key}`).toBe(true);
    }
  });

  it('ignores unknown categories instead of throwing', () => {
    expect(queryKeysForCategories(['nope' as never])).toEqual([]);
    // Prototype keys must not resolve to a non-array "key list".
    expect(queryKeysForCategories(['constructor' as never, 'tasks'])).toEqual(['tasks:project']);
  });
});

describe('categoriesFromPayload', () => {
  it('passes through the known categories of a well-formed payload', () => {
    expect(categoriesFromPayload({ categories: ['teams', 'plans'] })).toEqual(['teams', 'plans']);
  });

  it('degrades to the blanket refresh for anything unusable', () => {
    expect(categoriesFromPayload(undefined)).toEqual(['all']);
    expect(categoriesFromPayload(null)).toEqual(['all']);
    expect(categoriesFromPayload({})).toEqual(['all']);
    expect(categoriesFromPayload({ categories: [] })).toEqual(['all']);
    expect(categoriesFromPayload({ categories: 'teams' })).toEqual(['all']);
    expect(categoriesFromPayload({ categories: ['bogus', 42] })).toEqual(['all']);
    expect(categoriesFromPayload({ categories: ['constructor', '__proto__'] })).toEqual(['all']);
  });

  it('keeps the known categories of a partially bogus payload', () => {
    expect(categoriesFromPayload({ categories: ['bogus', 'studio'] })).toEqual(['studio']);
  });

  it('never lets a payload key reach through to the invalidation list', () => {
    // A payload can only name categories, never raw query keys.
    expect(
      queryKeysForCategories(categoriesFromPayload({ categories: ['sessions:chat'] }))
    ).toEqual(QUERY_KEYS_BY_CATEGORY.all as string[]);
  });
});
