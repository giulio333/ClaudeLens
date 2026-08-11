import {
  areaOf,
  buildFileChanges,
  buildMissionFeed,
  buildTaskTimes,
  buildToolTimes,
  countByKind,
  editStats,
  shortAgo,
} from '../src/components/project/terminal/mission-feed';
import type { MissionFeedInput } from '../src/components/project/terminal/mission-feed';
import type {
  MemoryActivity,
  ProcessedMessage,
  SessionAgent,
  SessionSkill,
  ToolGroup,
} from '../src/components/project/chat/utils';
import type { Task, TeamSummary } from '../src/types';

const T0 = Date.parse('2026-08-11T10:00:00.000Z');
const NOW = T0 + 60 * 60_000; // one hour after the session's first turn

function iso(offsetMinutes: number): string {
  return new Date(T0 + offsetMinutes * 60_000).toISOString();
}

function group(
  id: string,
  name: string,
  input: Record<string, unknown>,
  isError = false
): ToolGroup {
  return {
    use: { type: 'tool_use', id, name, input },
    result: { type: 'tool_result', tool_use_id: id, content: '', isError },
  } as unknown as ToolGroup;
}

/** One assistant turn carrying the given tool groups, stamped at +N minutes. */
function turn(offsetMinutes: number, groups: ToolGroup[]): ProcessedMessage {
  return {
    msg: {
      uuid: `t${offsetMinutes}`,
      role: 'assistant',
      timestamp: iso(offsetMinutes),
      model: 'claude-opus-5',
      content: [],
    },
    toolGroups: groups,
  } as unknown as ProcessedMessage;
}

function task(over: Partial<Task> & Pick<Task, 'id' | 'subject'>): Task {
  return {
    description: '',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    ...over,
  };
}

function team(over: Partial<TeamSummary> & Pick<TeamSummary, 'teamName'>): TeamSummary {
  return {
    displayName: over.teamName,
    sessionId: 'sess',
    filename: 'sess.jsonl',
    sessionIds: ['sess'],
    createdAt: T0,
    lastActivity: T0,
    hasConfig: true,
    memberCount: 2,
    memberNames: ['a', 'b'],
    memberColors: ['blue', 'green'],
    transcriptCount: 2,
    memberTokens: [1, 2],
    totalTokens: 3,
    messageCount: 4,
    leadSessionIdFromConfig: null,
    ...over,
  };
}

const EMPTY_MEMORY: MemoryActivity = { touches: [], indexOps: [] };

function input(over: Partial<MissionFeedInput> = {}): MissionFeedInput {
  return {
    processed: [],
    ownTools: [],
    agents: [],
    skills: [],
    memory: EMPTY_MEMORY,
    changes: [],
    tasks: [],
    teams: [],
    realPath: '/Users/dev/proj',
    now: NOW,
    ...over,
  };
}

describe('mission feed — file changes', () => {
  it('estimates a diff per mutating tool and aggregates per file', () => {
    const write = group('w1', 'Write', {
      file_path: '/Users/dev/proj/src/a.ts',
      content: 'a\nb\nc',
    });
    const edit = group('e1', 'Edit', {
      file_path: '/Users/dev/proj/src/a.ts',
      old_string: 'a',
      new_string: 'a\nb',
    });
    expect(editStats(write)).toEqual({ added: 3, removed: 0 });

    const [fc] = buildFileChanges([write, edit, group('r1', 'Read', { file_path: '/x' })]);
    expect(fc.name).toBe('a.ts');
    expect(fc.items).toHaveLength(2);
    expect(fc).toMatchObject({ added: 5, removed: 1, hasError: false });
  });

  it('reads the area relative to the project, and falls back outside it', () => {
    expect(areaOf('/Users/dev/proj/electron/modules/x.ts', '/Users/dev/proj')).toBe(
      'electron/modules'
    );
    expect(areaOf('/Users/dev/proj/README.md', '/Users/dev/proj')).toBe('(root)');
    expect(areaOf('/Users/dev/.claude/memory/x.md', '/Users/dev/proj')).toBe('memory');
  });
});

describe('mission feed — timestamps', () => {
  it('dates a tool use from the assistant turn that issued it', () => {
    const g = group('g1', 'Write', { file_path: '/Users/dev/proj/a.ts', content: 'x' });
    expect(buildToolTimes([turn(5, [g])]).get('g1')).toBe(T0 + 5 * 60_000);
  });

  it('recovers task timestamps from TaskCreate / TaskUpdate, latest update winning', () => {
    const create = group('c1', 'TaskCreate', { subject: 'Ship it' });
    const early = group('u1', 'TaskUpdate', { taskId: '1', status: 'in_progress' });
    const late = group('u2', 'TaskUpdate', { taskId: '1', status: 'completed' });
    const processed = [turn(1, [create]), turn(4, [early]), turn(9, [late])];
    const at = buildToolTimes(processed);
    const { byId, bySubject } = buildTaskTimes([create, early, late], at);
    expect(bySubject.get('Ship it')).toBe(T0 + 60_000);
    expect(byId.get('1')).toBe(T0 + 9 * 60_000);
  });

  it('leaves a task undated when the transcript holds no call for it', () => {
    const [event] = buildMissionFeed(input({ tasks: [task({ id: '7', subject: 'Orphan' })] }));
    expect(event.at).toBe(0);
    expect(shortAgo(event.at, NOW)).toBe('—');
  });
});

describe('mission feed — ordering', () => {
  it('floats live events above everything, then sorts newest first', () => {
    const running: SessionAgent = {
      key: '1-0',
      turnN: 1,
      subagentType: 'test-runner',
      description: 'Run the suite',
      prompt: '',
      isError: false,
      runState: 'running',
      agentId: null,
    };
    const write = group('w1', 'Write', { file_path: '/Users/dev/proj/a.ts', content: 'x' });
    const processed = [turn(1, []), turn(30, [write])];

    const feed = buildMissionFeed(
      input({
        processed,
        ownTools: [write],
        agents: [running],
        changes: buildFileChanges([write]),
        tasks: [task({ id: '1', subject: 'Old task' })],
      })
    );

    // The agent dispatched at +1m is still running, so it leads a file written
    // 29 minutes later; the undated task sinks under both.
    expect(feed.map(e => e.kind)).toEqual(['AGENTS', 'CHANGES', 'TASKS']);
    expect(feed[0].live).toBe(true);
    expect(feed[0].right).toBe('WORKING');
  });

  it('prefers a sub-agent transcript end over its dispatch turn', () => {
    const done: SessionAgent = {
      key: '1-0',
      turnN: 1,
      subagentType: 'git-committer',
      description: 'Commit the fix',
      prompt: '',
      isError: false,
      runState: 'done',
      agentId: 'agent-x',
      startedAt: iso(2),
      endedAt: iso(12),
      messageCount: 28,
    };
    const [event] = buildMissionFeed(input({ processed: [turn(1, [])], agents: [done] }));
    expect(event.at).toBe(T0 + 12 * 60_000);
    expect(event.right).toBe('28 MSGS');
  });
});

describe('mission feed — row copy', () => {
  it('labels a multi-edit file with its edit count and area, and marks it expandable', () => {
    const a = group('a', 'Edit', {
      file_path: '/Users/dev/proj/electron/modules/x.ts',
      old_string: 'q',
      new_string: 'q\nq',
    });
    const b = group('b', 'Edit', {
      file_path: '/Users/dev/proj/electron/modules/x.ts',
      old_string: 'z',
      new_string: 'z',
    });
    const [event] = buildMissionFeed(
      input({ processed: [turn(3, [a, b])], ownTools: [a, b], changes: buildFileChanges([a, b]) })
    );
    expect(event.meta).toBe('2 edits · electron/modules');
    expect(event.expandable).toBe(true);
    expect(event.rightDiff).toEqual({ added: 3, removed: 2 });
    expect(event.ext).toBe('ts');
  });

  it('flags a failed edit instead of printing a diff for it', () => {
    const bad = group('bad', 'Write', { file_path: '/Users/dev/proj/a.ts', content: 'x' }, true);
    const [event] = buildMissionFeed(
      input({ processed: [turn(3, [bad])], ownTools: [bad], changes: buildFileChanges([bad]) })
    );
    expect(event.right).toBe('FAILED');
    expect(event.rightDiff).toBeUndefined();
    expect(event.danger).toBe(true);
  });

  it('separates a consulted memory from a remembered one', () => {
    const read = group('m1', 'Read', { file_path: '/Users/dev/.claude/memory/feedback_x.md' });
    const memory: MemoryActivity = {
      touches: [
        {
          path: '/Users/dev/.claude/memory/feedback_x.md',
          title: 'Always commit in English',
          type: 'feedback',
          scope: 'user',
          description: '',
          items: [read],
          reads: 1,
          writes: 0,
          action: 'read',
          hasError: false,
        },
      ],
      indexOps: [],
    };
    const [event] = buildMissionFeed(
      input({ processed: [turn(2, [read])], ownTools: [read], memory })
    );
    expect(event.meta).toBe('consulted');
    expect(event.right).toBe('READ');
    expect(event.glyphTint).toBe('var(--cl-warn)');
  });

  it('reports a live team as LEAD LIVE and surfaces the quiet signal', () => {
    const quiet = team({ teamName: 'release-train', lastActivity: NOW - 12 * 60_000 });
    const [event] = buildMissionFeed(
      input({ teams: [{ team: quiet, title: 'release-train', live: true }] })
    );
    expect(event.right).toBe('LEAD LIVE');
    expect(event.live).toBe(true);
    expect(event.meta).toBe('2 members · 2 transcripts · quiet 12m');
  });

  it('says HISTORICAL when a team has no configuration left', () => {
    const gone = team({ teamName: 'old', hasConfig: false });
    const [event] = buildMissionFeed(input({ teams: [{ team: gone, title: 'old', live: false }] }));
    expect(event.right).toBe('HISTORICAL');
  });

  it('routes a skill by its scope and marks an agentic run', () => {
    const skill: SessionSkill = {
      key: '1',
      turnN: 1,
      name: 'changelog',
      description: 'Write the changelog',
      scope: 'project',
      skill: null,
      group: group('s1', 'Skill', { name: 'changelog' }),
    };
    const [event] = buildMissionFeed(input({ processed: [turn(1, [])], skills: [skill] }));
    expect(event.right).toBe('PROJECT');
    expect(event.glyph).toBe('✦');
  });

  it('expands a task only when it carries detail beyond its subject', () => {
    const feed = buildMissionFeed(
      input({
        tasks: [
          task({ id: '1', subject: 'Bare', status: 'completed' }),
          task({ id: '2', subject: 'Rich', description: 'Why it matters' }),
          task({ id: '3', subject: 'Running', status: 'in_progress', activeForm: 'Splitting' }),
        ],
      })
    );
    const byTitle = new Map(feed.map(e => [e.title, e]));
    expect(byTitle.get('Bare')!.expandable).toBe(false);
    expect(byTitle.get('Rich')!.expandable).toBe(true);
    expect(byTitle.get('Running')!).toMatchObject({
      expandable: true,
      live: true,
      meta: 'Splitting',
      right: 'RUNNING',
    });
  });
});

describe('mission feed — filters', () => {
  it('counts every species so the pills can carry the old eyebrow numbers', () => {
    const write = group('w', 'Write', { file_path: '/Users/dev/proj/a.ts', content: 'x' });
    const feed = buildMissionFeed(
      input({
        processed: [turn(1, [write])],
        ownTools: [write],
        changes: buildFileChanges([write]),
        tasks: [task({ id: '1', subject: 'One' })],
        teams: [{ team: team({ teamName: 't' }), title: 't', live: false }],
      })
    );
    expect(countByKind(feed)).toEqual({
      AGENTS: 0,
      TEAMS: 1,
      SKILLS: 0,
      MEMORY: 0,
      CHANGES: 1,
      TASKS: 1,
    });
  });
});

describe('mission feed — age labels', () => {
  it('keeps the time gutter to one compact token', () => {
    expect(shortAgo(NOW, NOW)).toBe('now');
    expect(shortAgo(NOW - 30_000, NOW)).toBe('now');
    expect(shortAgo(NOW - 7 * 60_000, NOW)).toBe('7m');
    expect(shortAgo(NOW - 3 * 3_600_000, NOW)).toBe('3h');
    expect(shortAgo(NOW - 2 * 86_400_000, NOW)).toBe('2d');
    expect(shortAgo(0, NOW)).toBe('—');
    expect(shortAgo(NOW - 86_400_000, NOW, true)).toBe('now');
  });
});
