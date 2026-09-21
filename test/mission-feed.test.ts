import {
  areaOf,
  buildFileChanges,
  buildMissionFeed,
  buildTaskTimes,
  buildToolTimes,
  buildWebActivity,
  countByKind,
  editStats,
  shortAgo,
  webItemNote,
} from '../src/components/project/terminal/mission-feed';
import type { MissionFeedInput } from '../src/components/project/terminal/mission-feed';
import { buildArtifactActivity } from '../src/components/project/chat/artifact';
import type { ArtifactPublish } from '../src/types';
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
    web: [],
    changes: [],
    artifacts: [],
    tasks: [],
    teams: [],
    realPath: '/Users/dev/proj',
    now: NOW,
    ...over,
  };
}

describe('mission feed — file changes', () => {
  // The numbers are the diff's, the same the chat prints under the turn: an
  // Edit of `a` → `a\nb` is one line added, not two added and one removed.
  it('counts the diff of each mutating tool and aggregates per file', () => {
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
    expect(fc).toMatchObject({ added: 4, removed: 0, hasError: false });
  });

  // An edit made from Bash leaves no Edit call: the file is on the result row
  // (#265). It is how Claude edits in auto mode, and the rail used to show a
  // session of those as one that changed nothing.
  it('counts the files a Bash command rewrote off its result', () => {
    const bash: ToolGroup = {
      use: { type: 'tool_use', id: 'sh1', name: 'Bash', input: { command: 'sed -i s/a/b/ x' } },
      result: {
        type: 'tool_result',
        toolUseId: 'sh1',
        content: '',
        isError: false,
        bashEditDiff: {
          files: [
            {
              filePath: '/Users/dev/proj/src/x.ts',
              hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
            },
            { filePath: '/Users/dev/proj/src/new.ts', hunks: [], created: true },
          ],
          changedFiles: ['/Users/dev/proj/src/x.ts', '/Users/dev/proj/src/new.ts'],
          moreFiles: 0,
        },
      },
    };
    const changes = buildFileChanges([bash]);
    expect(changes.map(c => [c.name, c.added, c.removed, c.created])).toEqual([
      ['x.ts', 1, 1, false],
      ['new.ts', 0, 0, true],
    ]);
    expect(changes[0].items).toEqual([bash]);
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
    expect(event.rightDiff).toEqual({ added: 1, removed: 0 });
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

/* ── WEB ──────────────────────────────────────────────────────────────── */

/** A web call with a real result body (the shared `group` helper leaves it empty,
 *  and every web outcome is read *from* the body). */
function webCall(
  id: string,
  name: string,
  toolInput: Record<string, unknown>,
  result?: { content?: string; isError?: boolean }
): ToolGroup {
  return {
    use: { type: 'tool_use', id, name, input: toolInput },
    result: result
      ? {
          type: 'tool_result',
          tool_use_id: id,
          content: result.content ?? '',
          isError: !!result.isError,
        }
      : null,
  } as unknown as ToolGroup;
}

const PAGE = 'https://docs.example.org/guide/getting-started/';
const REDIRECT = `REDIRECT DETECTED: The URL redirects to a different host.

Original URL: https://docs.claude.com/en/docs/claude-code/skills
Redirect URL: https://code.claude.com/docs/en/skills
Status: 301 Moved Permanently`;
const SEARCH_OK = `Web search results for query: "vitest 5 migration"

Links: [{"title":"A","url":"https://vitest.dev/a"},{"title":"B","url":"https://github.com/b"},{"title":"C","url":"https://docs.example/c"},{"title":"D","url":"https://vitest.dev/d"}]

Synthesis.`;

describe('mission feed — web activity', () => {
  it('groups repeated calls of one URL into a single source row', () => {
    const first = webCall(
      'f1',
      'WebFetch',
      { url: PAGE, prompt: 'Riporta le date' },
      { content: '# Dates' }
    );
    const second = webCall(
      'f2',
      'WebFetch',
      { url: PAGE, prompt: 'Elenca i PDF' },
      { content: '# PDFs' }
    );
    const other = webCall(
      'f3',
      'WebFetch',
      { url: 'https://docs.example.org/uploads/Changelog-2026.pdf', prompt: 'x' },
      { content: '# Notice' }
    );
    const visits = buildWebActivity([first, second, other]);
    expect(visits).toHaveLength(2);

    const feed = buildMissionFeed(
      input({
        processed: [turn(3, [first, second]), turn(9, [other])],
        ownTools: [first, second, other],
        web: visits,
      })
    );
    const page = feed.find(e => e.title === 'getting-started')!;
    expect(page).toMatchObject({
      kind: 'WEB',
      right: 'FETCHED',
      meta: 'docs.example.org · ×2',
      expandable: true,
      danger: false,
      at: T0 + 3 * 60_000,
    });
    // The full URL and the ask are the tooltip's job — the row can't hold them.
    expect(page.hint).toContain('docs.example.org/guide/getting-started');
    expect(page.hint).toContain('Riporta le date');
    // Two calls of one source differ only in what they asked for, so the
    // disclosure carries the ask, not the tool name twice.
    expect(page.items.map(webItemNote)).toEqual(['Riporta le date', 'Elenca i PDF']);
    // A second page of the same host is a second source, never a second call.
    expect(feed.find(e => e.title === 'Changelog-2026.pdf')!.meta).toBe('docs.example.org');
  });

  it('keeps one row for one page fetched under two spellings', () => {
    // Verified on a real session: `…/settings` and `…/settings#plugin-settings`
    // produced two rows the reader could not tell apart.
    const plain = webCall(
      'a1',
      'WebFetch',
      { url: 'https://code.claude.com/docs/en/settings', prompt: 'The whole page' },
      { content: '# Settings' }
    );
    const anchored = webCall(
      'a2',
      'WebFetch',
      { url: 'https://code.claude.com/docs/en/settings#plugin-settings', prompt: 'Just plugins' },
      { content: '# Plugin settings' }
    );
    const feed = buildMissionFeed(
      input({
        processed: [turn(6, [plain, anchored])],
        ownTools: [plain, anchored],
        web: buildWebActivity([plain, anchored]),
      })
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ title: 'settings', meta: 'code.claude.com · ×2' });
  });

  it('says REDIRECT when nothing was read, and names where it was sent', () => {
    const call = webCall(
      'r1',
      'WebFetch',
      { url: 'https://docs.claude.com/en/docs/claude-code/skills', prompt: 'x' },
      { content: REDIRECT }
    );
    const [event] = buildMissionFeed(
      input({ processed: [turn(2, [call])], ownTools: [call], web: buildWebActivity([call]) })
    );
    expect(event).toMatchObject({ right: 'REDIRECT', rightTint: 'var(--cl-warn)', danger: false });
    expect(event.meta).toBe('docs.claude.com · → code.claude.com');
  });

  it('reports a URL that redirected once and was read after as read', () => {
    const bounced = webCall('r1', 'WebFetch', { url: PAGE, prompt: 'x' }, { content: REDIRECT });
    const got = webCall('r2', 'WebFetch', { url: PAGE, prompt: 'x' }, { content: '# Page' });
    const [event] = buildMissionFeed(
      input({
        processed: [turn(2, [bounced, got])],
        ownTools: [bounced, got],
        web: buildWebActivity([bounced, got]),
      })
    );
    expect(event.right).toBe('FETCHED');
    expect(event.meta).not.toContain('→');
  });

  it('says FAILED when the server refused, not FETCHED', () => {
    // Verified on a real session: 4 of 14 fetches came back like this and the
    // rail called every one of them FETCHED. `is_error` is unset — the tool
    // reports the status in prose — so the body is the only evidence.
    const refused = webCall(
      'h403',
      'WebFetch',
      { url: 'https://www.registry.example/1564/acme-srl', prompt: 'Estrai i dati' },
      {
        content:
          'The server returned HTTP 403 Forbidden.\n\nThe response body was not retrieved. If this URL requires authentication, use an authenticated tool instead of WebFetch.',
      }
    );
    const [event] = buildMissionFeed(
      input({
        processed: [turn(2, [refused])],
        ownTools: [refused],
        web: buildWebActivity([refused]),
      })
    );
    expect(event).toMatchObject({ right: 'FAILED', rightTint: 'var(--cl-danger)', danger: true });
    // The status is the meta; the sentence it opens (and its advice) is not.
    expect(event.meta).toBe('registry.example · HTTP 403 Forbidden');
  });

  it('carries a search by its query, its result count and its sources', () => {
    const call = webCall(
      's1',
      'WebSearch',
      { query: 'vitest 5 migration' },
      { content: SEARCH_OK }
    );
    const [event] = buildMissionFeed(
      input({ processed: [turn(4, [call])], ownTools: [call], web: buildWebActivity([call]) })
    );
    expect(event).toMatchObject({
      kind: 'WEB',
      title: 'vitest 5 migration',
      right: '4 LINKS',
      // Distinct hosts, two of them, `+N` for the rest — vitest.dev appears twice.
      meta: 'vitest.dev · github.com · +1',
      expandable: false,
    });
  });

  it('marks the failures the is_error flag misses, and the calls still in flight', () => {
    const dead = webCall(
      'e1',
      'WebSearch',
      { query: 'jolokia cors' },
      { content: 'Web search results for query: "jolokia cors"\n\nWeb search error: unavailable' }
    );
    const inFlight = webCall('p1', 'WebFetch', { url: 'https://x.it/slow', prompt: 'x' });
    const feed = buildMissionFeed(
      input({
        processed: [turn(5, [dead, inFlight])],
        ownTools: [dead, inFlight],
        web: buildWebActivity([dead, inFlight]),
      })
    );
    const search = feed.find(e => e.title === 'jolokia cors')!;
    expect(search).toMatchObject({ right: 'FAILED', danger: true });
    expect(search.meta).toBe('web search · unavailable');
    expect(feed.find(e => e.title === 'slow')!.right).toBe('PENDING');
  });

  it('titles a root URL with its host and does not repeat it in the meta', () => {
    const call = webCall(
      'h1',
      'WebFetch',
      { url: 'https://www.githubstatus.com', prompt: 'Is GitHub up?' },
      { content: 'All systems operational' }
    );
    const [event] = buildMissionFeed(
      input({ processed: [turn(1, [call])], ownTools: [call], web: buildWebActivity([call]) })
    );
    expect(event.title).toBe('githubstatus.com');
    expect(event.meta).toBe('');
  });

  it('ignores a web call whose defining input is missing, and every other tool', () => {
    expect(buildWebActivity([webCall('x1', 'WebFetch', {}, { content: 'x' })])).toEqual([]);
    expect(
      buildWebActivity([webCall('x2', 'Read', { file_path: '/a' }, { content: 'x' })])
    ).toEqual([]);
    expect(webItemNote(webCall('x3', 'Read', { file_path: '/a' }))).toBe('');
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
      QUESTIONS: 0,
      MEMORY: 0,
      WEB: 0,
      CHANGES: 1,
      PAGES: 0,
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

/** One `AskUserQuestion` call. `answer` undefined = still waiting for the user;
 *  `answer: null` = the user closed it and kept talking (the rejection result
 *  Claude Code writes). */
function ask(
  id: string,
  questions: { question: string; header?: string; options: string[] }[],
  answer?: Record<string, string> | null
): ToolGroup {
  const use = {
    type: 'tool_use',
    id,
    name: 'AskUserQuestion',
    input: {
      questions: questions.map(q => ({
        question: q.question,
        header: q.header,
        multiSelect: false,
        options: q.options.map(label => ({ label })),
      })),
    },
  };
  if (answer === undefined) return { use } as unknown as ToolGroup;
  const content =
    answer === null
      ? 'The tool use was rejected. (No answer provided)'
      : `Your questions have been answered: ${Object.entries(answer)
          .map(([q, a]) => `"${q}"="${a}"`)
          .join(', ')}.`;
  return {
    use,
    result: { type: 'tool_result', tool_use_id: id, content, isError: false },
  } as unknown as ToolGroup;
}

describe('mission feed — questions', () => {
  const asked = ask(
    'q1',
    [{ question: 'Which approach?', header: 'Approach', options: ['Fixed cells', 'Remove three'] }],
    { 'Which approach?': 'Fixed cells' }
  );

  it('draws one row per call, titled by the question and carrying the answer', () => {
    const [e] = buildMissionFeed(input({ processed: [turn(3, [asked])], ownTools: [asked] }));
    expect(e.kind).toBe('QUESTIONS');
    expect(e.title).toBe('Which approach?');
    expect(e.meta).toBe('Fixed cells');
    expect(e.right).toBe('ANSWERED');
    expect(e.at).toBe(T0 + 3 * 60_000);
  });

  it('routes the row to the turn the question was asked on', () => {
    const [e] = buildMissionFeed(
      input({ processed: [turn(1, []), turn(3, [asked])], ownTools: [asked] })
    );
    expect(e.source).toMatchObject({ kind: 'question', turnN: 2 });
  });

  it('separates a question the user closed without answering from an answered one', () => {
    const dismissed = ask('q2', [{ question: 'Ship it?', options: ['Yes', 'No'] }], null);
    const [e] = buildMissionFeed(
      input({ processed: [turn(1, [dismissed])], ownTools: [dismissed] })
    );
    expect(e.right).toBe('NO ANSWER');
    expect(e.meta).toBe('kept talking');
  });

  it('reads a call with no result yet as pending, never as answered', () => {
    const pending = ask('q3', [{ question: 'Ship it?', options: ['Yes', 'No'] }]);
    const [e] = buildMissionFeed(input({ processed: [turn(1, [pending])], ownTools: [pending] }));
    expect(e.right).toBe('PENDING');
    expect(e.meta).toBe('waiting for reply');
  });

  it('keeps the first question as the title and says how many the call carried', () => {
    const two = ask(
      'q4',
      [
        { question: 'Which approach?', options: ['A', 'B'] },
        { question: 'Which surface?', options: ['Pill', 'Rail'] },
      ],
      { 'Which approach?': 'A', 'Which surface?': 'Rail' }
    );
    const [e] = buildMissionFeed(input({ processed: [turn(1, [two])], ownTools: [two] }));
    expect(e.title).toBe('Which approach?');
    expect(e.meta).toBe('2 questions · A · Rail');
    // The row truncates at 380px, so the full ask stays recoverable in the tooltip.
    expect(e.hint).toContain('Which surface?');
  });

  it('never floats a pending ask as live — it leads only when it is the newest row', () => {
    const pending = ask('q6', [{ question: 'Ship it?', options: ['Yes', 'No'] }]);
    const write = group('w', 'Write', { file_path: '/Users/dev/proj/a.ts', content: 'x' });

    // Still open and last written: it leads because it is newest, not because we
    // claimed it was current.
    const open = buildMissionFeed(
      input({
        processed: [turn(1, [write]), turn(9, [pending])],
        ownTools: [write],
        changes: buildFileChanges([write]),
      })
    );
    expect(open[0].kind).toBe('QUESTIONS');
    expect(open[0].live).toBe(false);

    // A result the CLI never wrote, with the session having gone on for half an
    // hour after: it sorts by its own time like everything else.
    const stale = buildMissionFeed(
      input({
        processed: [turn(1, [pending]), turn(30, [write])],
        ownTools: [write],
        changes: buildFileChanges([write]),
      })
    );
    expect(stale.map(e => e.kind)).toEqual(['CHANGES', 'QUESTIONS']);
  });

  it('ignores a call whose input carries no readable question', () => {
    const empty = { use: { type: 'tool_use', id: 'q5', name: 'AskUserQuestion', input: {} } };
    const feed = buildMissionFeed(
      input({ processed: [turn(1, [empty as unknown as ToolGroup])], ownTools: [] })
    );
    expect(feed).toEqual([]);
  });
});

describe('mission feed — published pages', () => {
  /** An `Artifact` publish: the page is stamped on the result block, the way
   *  the transcript readers stamp it from `toolUseResult`. */
  function publish(
    id: string,
    over: Partial<ArtifactPublish> = {},
    input: Record<string, unknown> = {}
  ): ToolGroup {
    return {
      use: { type: 'tool_use', id, name: 'Artifact', input: { action: 'publish', ...input } },
      result: {
        type: 'tool_result',
        tool_use_id: id,
        content: 'Published … (Version 2)',
        isError: false,
        artifact: {
          id: 'page-1',
          url: 'https://claude.ai/artifact/AbCdEf',
          title: 'Release checklist',
          updated: true,
          seq: 2,
          audience: 'owner',
          ...over,
        },
      },
    } as unknown as ToolGroup;
  }

  it('draws one row per page, however many times it was republished', () => {
    const calls = [
      publish('p1', { updated: false, seq: 1 }, { description: 'Before and after' }),
      publish('p2', { seq: 2 }),
      publish('p3', { seq: 3 }),
    ];
    const feed = buildMissionFeed(
      input({
        processed: [turn(1, calls)],
        ownTools: calls,
        artifacts: buildArtifactActivity(calls),
      })
    );
    expect(feed).toHaveLength(1);
    const [e] = feed;
    expect(e.kind).toBe('PAGES');
    expect(e.title).toBe('Release checklist');
    expect(e.meta).toBe('3 publishes · claude.ai/artifact/AbCdEf');
    expect(e.right).toBe('v3');
    // The publishes are in the chat, each at the moment it happened; a click
    // here is worth more spent on the page than on the tool's own prose.
    expect(e.expandable).toBe(false);
    expect(e.source).toEqual({
      kind: 'artifact',
      artifact: expect.objectContaining({ id: 'page-1' }),
    });
  });

  it('says whether this session made the page or only updated one', () => {
    const made = buildMissionFeed(
      input({ artifacts: buildArtifactActivity([publish('p1', { updated: false, seq: 1 })]) })
    );
    expect(made[0].meta).toBe('created · claude.ai/artifact/AbCdEf');

    const updated = buildMissionFeed(
      input({ artifacts: buildArtifactActivity([publish('p1', { updated: true, seq: 9 })]) })
    );
    expect(updated[0].meta).toBe('updated · claude.ai/artifact/AbCdEf');
  });

  it('says PUBLISHED rather than a version the transcript never stated', () => {
    const feed = buildMissionFeed(
      input({ artifacts: buildArtifactActivity([publish('p1', { seq: undefined })]) })
    );
    expect(feed[0].right).toBe('PUBLISHED');
  });

  it('keeps the summary and the sharing for the tooltip, which the row cannot fit', () => {
    const feed = buildMissionFeed(
      input({
        artifacts: buildArtifactActivity([
          publish('p1', { audience: 'users' }, { description: 'Before and after' }),
        ]),
      })
    );
    expect(feed[0].hint).toBe('Before and after — shared');
  });

  it('dates the row from the last publish, and counts it among the filters', () => {
    const first = publish('p1', { updated: false, seq: 1 });
    const second = publish('p2', { seq: 2 });
    const feed = buildMissionFeed(
      input({
        processed: [turn(1, [first]), turn(5, [second])],
        ownTools: [first, second],
        artifacts: buildArtifactActivity([first, second]),
      })
    );
    expect(feed[0].at).toBe(T0 + 5 * 60_000);
    expect(countByKind(feed).PAGES).toBe(1);
  });
});
