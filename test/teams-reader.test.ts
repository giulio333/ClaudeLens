import {
  getProjectTeams,
  getTeamDetail,
  isSafeTeamName,
  scanMemberTranscript,
} from '../electron/modules/teams-reader';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let projectDir: string; // stands in for ~/.claude/projects/{hash}
let teamsDir: string; // stands in for ~/.claude/teams

const SESS_A = '11111111-1111-1111-1111-111111111111';
const SESS_B = '22222222-2222-2222-2222-222222222222';
const TEAM = 'session-f78e79be';

function writeMeta(
  sessionId: string,
  memberName: string,
  hash: string,
  over: Record<string, unknown> = {},
  opts: { withJsonl?: boolean; mtime?: number; content?: string } = {}
) {
  const subagents = join(projectDir, sessionId, 'subagents');
  mkdirSync(subagents, { recursive: true });
  const stem = `agent-a${memberName}-${hash}`;
  writeFileSync(
    join(subagents, `${stem}.meta.json`),
    JSON.stringify({
      agentType: memberName,
      description: `Check ${memberName}`,
      name: memberName,
      spawnDepth: 0,
      taskKind: 'in_process_teammate',
      teamName: TEAM,
      color: 'blue',
      planModeRequired: false,
      model: 'haiku',
      permissionMode: 'bypassPermissions',
      ...over,
    })
  );
  if (opts.withJsonl !== false) {
    const jsonl = join(subagents, `${stem}.jsonl`);
    writeFileSync(jsonl, opts.content ?? '{"type":"user"}\n');
    if (opts.mtime) utimesSync(jsonl, new Date(opts.mtime), new Date(opts.mtime));
  }
  return `a${memberName}-${hash}`;
}

function configMember(name: string, over: Record<string, unknown> = {}) {
  return {
    agentId: `${name}@${TEAM}`,
    name,
    color: 'green',
    joinedAt: 1_783_625_052_197,
    tmuxPaneId: 'in-process',
    subscriptions: [],
    model: 'haiku',
    prompt: `Do the ${name} check.`,
    planModeRequired: false,
    cwd: '/Users/someone/Projects/ClaudeLens',
    backendType: 'in-process',
    ...over,
  };
}

function writeConfig(teamName: string, members: unknown[], over: Record<string, unknown> = {}) {
  const dir = join(teamsDir, teamName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      name: teamName,
      createdAt: 1_783_623_417_990,
      leadAgentId: `team-lead@${teamName}`,
      leadSessionId: 'f78e79be-b5a5-4082-a707-1a335b523067',
      members: [
        {
          agentId: `team-lead@${teamName}`,
          name: 'team-lead',
          agentType: 'team-lead',
          joinedAt: 1_783_623_417_990,
          tmuxPaneId: 'leader',
          cwd: '/Users/someone/Projects/ClaudeLens',
          subscriptions: [],
          backendType: 'in-process',
        },
        ...members,
      ],
      ...over,
    })
  );
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'cl-teams-proj-'));
  teamsDir = mkdtempSync(join(tmpdir(), 'cl-teams-reg-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(teamsDir, { recursive: true, force: true });
});

const opts = () => ({ teamsDir });

describe('isSafeTeamName', () => {
  it('accepts registry-style names', () => {
    expect(isSafeTeamName('session-f78e79be')).toBe(true);
    expect(isSafeTeamName('my_team.v2')).toBe(true);
  });
  it('rejects traversal and separators', () => {
    expect(isSafeTeamName('../teams')).toBe(false);
    expect(isSafeTeamName('a/b')).toBe(false);
    expect(isSafeTeamName('.')).toBe(false);
    expect(isSafeTeamName('..')).toBe(false);
    expect(isSafeTeamName(42)).toBe(false);
    expect(isSafeTeamName('')).toBe(false);
  });
});

describe('getProjectTeams', () => {
  it('anchors teams on transcripts and merges config enrichment', async () => {
    writeMeta(SESS_A, 'check-readme', 'aaaa000011112222');
    writeConfig(TEAM, [configMember('check-readme', { color: 'yellow' })]);

    const teams = await getProjectTeams(projectDir, opts());
    expect(teams).toHaveLength(1);
    const t = teams[0];
    expect(t.teamName).toBe(TEAM);
    expect(t.hasConfig).toBe(true);
    expect(t.sessionId).toBe(SESS_A);
    expect(t.filename).toBe(`${SESS_A}.jsonl`);
    expect(t.memberNames).toEqual(['check-readme']);
    expect(t.memberColors).toEqual(['blue']); // meta wins over config
    expect(t.transcriptCount).toBe(1);
    expect(t.createdAt).toBe(1_783_623_417_990);
    // Promoted onto the summary so list-level liveness matches isTeamLive exactly.
    expect(t.leadSessionIdFromConfig).toBe('f78e79be-b5a5-4082-a707-1a335b523067');
  });

  it('ignores registry dirs with no transcripts in the project (eager lead-only dirs)', async () => {
    writeConfig('session-eager123', []);
    expect(await getProjectTeams(projectDir, opts())).toEqual([]);
  });

  it('survives a removed registry entry as a degraded team', async () => {
    writeMeta(SESS_A, 'check-readme', 'aaaa000011112222');
    const teams = await getProjectTeams(projectDir, opts());
    expect(teams).toHaveLength(1);
    expect(teams[0].hasConfig).toBe(false);
    expect(teams[0].displayName).toBe(TEAM);
    expect(teams[0].createdAt).toBeGreaterThan(0); // falls back to transcript mtime
    expect(teams[0].leadSessionIdFromConfig).toBeNull();
  });

  it('dedupes one team across rotated lead sessions', async () => {
    writeMeta(SESS_A, 'check-readme', 'aaaa000011112222', {}, { mtime: 1_700_000_000_000 });
    writeMeta(SESS_B, 'check-changelog', 'bbbb000011112222', {}, { mtime: 1_700_000_100_000 });
    writeConfig(TEAM, [configMember('check-readme'), configMember('check-changelog')]);

    const teams = await getProjectTeams(projectDir, opts());
    expect(teams).toHaveLength(1);
    expect(teams[0].sessionIds).toEqual([SESS_B, SESS_A]); // newest first
    expect(teams[0].sessionId).toBe(SESS_B);
    expect(teams[0].memberCount).toBe(2);
  });

  it('skips plain Task subagent metas and unsafe team names', async () => {
    writeMeta(SESS_A, 'not-teammate', 'cccc000011112222', { taskKind: 'task' });
    writeMeta(SESS_A, 'evil', 'dddd000011112222', { teamName: '../escape' });
    expect(await getProjectTeams(projectDir, opts())).toEqual([]);
  });

  it('skips metas without a twin .jsonl and malformed JSON', async () => {
    writeMeta(SESS_A, 'ghost', 'eeee000011112222', {}, { withJsonl: false });
    const subagents = join(projectDir, SESS_A, 'subagents');
    writeFileSync(join(subagents, 'agent-abroken-ffff000011112222.meta.json'), '{not json');
    expect(await getProjectTeams(projectDir, opts())).toEqual([]);
  });

  it('sorts teams by lastActivity desc', async () => {
    writeMeta(
      SESS_A,
      'old-member',
      'aaaa000011112222',
      { teamName: 'session-old00000' },
      { mtime: 1_700_000_000_000 }
    );
    writeMeta(
      SESS_B,
      'new-member',
      'bbbb000011112222',
      { teamName: 'session-new00000' },
      { mtime: 1_700_000_100_000 }
    );
    const teams = await getProjectTeams(projectDir, opts());
    expect(teams.map(t => t.teamName)).toEqual(['session-new00000', 'session-old00000']);
  });

  it('returns [] for a missing project dir', async () => {
    expect(await getProjectTeams(join(projectDir, 'nope'), opts())).toEqual([]);
  });
});

// A realistic member transcript: dispatch, work turn with tools, report via
// SendMessage, a follow-up from the lead, and noise (idle notification,
// malformed line).
const MEMBER_JSONL = [
  JSON.stringify({
    type: 'user',
    timestamp: '2026-07-09T19:24:12.000Z',
    message: {
      role: 'user',
      content:
        '<teammate-message teammate_id="team-lead" summary="Controllo CHANGELOG">\nControlla il file CHANGELOG.\n</teammate-message>',
    },
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-09T19:24:40.000Z',
    message: {
      role: 'assistant',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 },
      content: [
        { type: 'text', text: 'Guardo il changelog.' },
        { type: 'tool_use', name: 'Read', id: 't1', input: { file_path: '/x/CHANGELOG.md' } },
      ],
    },
  }),
  '{not json',
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-09T19:25:30.000Z',
    message: {
      role: 'assistant',
      usage: { input_tokens: 200, output_tokens: 80 },
      content: [
        {
          type: 'tool_use',
          name: 'SendMessage',
          id: 't2',
          input: { to: 'team-lead', summary: 'CHANGELOG outdated', message: 'Full report here.' },
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    timestamp: '2026-07-09T19:25:50.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '<teammate-message teammate_id="team-lead">\n{"type":"idle_notification","from":"x"}\n</teammate-message>',
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    timestamp: '2026-07-09T19:26:00.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '<teammate-message teammate_id="team-lead" summary="Follow-up">\nMandami anche le righe esatte.\n</teammate-message>',
        },
      ],
    },
  }),
].join('\n');

describe('scanMemberTranscript', () => {
  it('extracts dispatch, outbound reports and follow-ups, skipping idle noise', () => {
    const scan = scanMemberTranscript(MEMBER_JSONL, 'check-changelog');
    expect(scan.events.map(e => [e.kind, e.from, e.to])).toEqual([
      ['dispatch', 'team-lead', 'check-changelog'],
      ['message', 'check-changelog', 'team-lead'],
      ['message', 'team-lead', 'check-changelog'],
    ]);
    expect(scan.events[0].text).toBe('Controlla il file CHANGELOG.');
    expect(scan.events[0].summary).toBe('Controllo CHANGELOG');
    expect(scan.events[1].summary).toBe('CHANGELOG outdated');
    expect(scan.events[1].text).toBe('Full report here.');
    expect(scan.events[1].timestamp).toBe(Date.parse('2026-07-09T19:25:30.000Z'));
  });

  it('computes per-member metrics from assistant turns', () => {
    const scan = scanMemberTranscript(MEMBER_JSONL, 'check-changelog');
    expect(scan.messageCount).toBe(2);
    expect(scan.toolCallCount).toBe(2);
    expect(scan.totalTokens).toBe(100 + 50 + 1000 + 200 + 80);
  });

  it('unescapes XML entities in attributes', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: '2026-07-09T19:24:12.000Z',
      message: {
        role: 'user',
        content:
          '<teammate-message teammate_id="team-lead" summary="Chiedo il testo dell&apos;haiku">\nTesto?\n</teammate-message>',
      },
    });
    const scan = scanMemberTranscript(line, 'team-haiku');
    expect(scan.events[0].summary).toBe("Chiedo il testo dell'haiku");
  });

  it('returns an empty scan for empty or garbage content', () => {
    expect(scanMemberTranscript('', 'x')).toEqual({
      events: [],
      messageCount: 0,
      toolCallCount: 0,
      totalTokens: 0,
    });
    expect(scanMemberTranscript('garbage\n{"a":1}', 'x').events).toEqual([]);
  });
});

describe('list metrics rollup', () => {
  it('rolls per-member token and message metrics up to the summary', async () => {
    writeMeta(
      SESS_A,
      'check-changelog',
      'aaaa000011112222',
      {},
      { content: MEMBER_JSONL, mtime: 1_700_000_000_000 }
    );
    writeMeta(SESS_A, 'check-readme', 'bbbb000011112222', {}, { mtime: 1_700_000_100_000 });

    const teams = await getProjectTeams(projectDir, opts());
    expect(teams).toHaveLength(1);
    const t = teams[0];
    expect(t.memberNames).toEqual(['check-changelog', 'check-readme']);
    expect(t.memberTokens).toEqual([1430, 0]); // parallel to memberNames
    expect(t.totalTokens).toBe(1430);
    expect(t.messageCount).toBe(2);
  });

  it('serves the list from the mtime cache and re-parses when mtime moves', async () => {
    writeMeta(
      SESS_A,
      'check-changelog',
      'aaaa000011112222',
      {},
      { content: MEMBER_JSONL, mtime: 1_700_000_000_000 }
    );
    expect((await getProjectTeams(projectDir, opts()))[0].totalTokens).toBe(1430);

    // Rewritten content under an unchanged mtime keeps serving the cached
    // numbers — mtime is the invalidation key, exactly like cost-tracker.
    const jsonl = join(
      projectDir,
      SESS_A,
      'subagents',
      'agent-acheck-changelog-aaaa000011112222.jsonl'
    );
    writeFileSync(jsonl, `${MEMBER_JSONL}\n${MEMBER_JSONL}`);
    utimesSync(jsonl, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect((await getProjectTeams(projectDir, opts()))[0].totalTokens).toBe(1430);

    // A moved mtime re-parses the transcript.
    utimesSync(jsonl, new Date(1_700_000_200_000), new Date(1_700_000_200_000));
    expect((await getProjectTeams(projectDir, opts()))[0].totalTokens).toBe(2860);
  });
});

describe('getTeamDetail', () => {
  it('merges both/config-only/transcript-only members, lead excluded, spawn order', async () => {
    writeMeta(SESS_A, 'check-readme', 'aaaa000011112222');
    writeMeta(SESS_A, 'check-extra', 'bbbb000011112222');
    writeConfig(TEAM, [
      configMember('check-readme', { joinedAt: 100, prompt: 'Check the README.' }),
      configMember('check-never-ran', { joinedAt: 50 }),
    ]);

    const d = await getTeamDetail(projectDir, TEAM, opts());
    expect(d).not.toBeNull();
    expect(d!.members.map(m => m.name)).not.toContain('team-lead');

    const readme = d!.members.find(m => m.name === 'check-readme')!;
    expect(readme.source).toBe('both');
    expect(readme.prompt).toBe('Check the README.');
    expect(readme.joinedAt).toBe(100);
    expect(readme.transcripts).toHaveLength(1);
    expect(readme.transcripts[0].agentId).toBe('acheck-readme-aaaa000011112222');
    expect(readme.transcripts[0].filename).toBe(`${SESS_A}.jsonl`);

    const never = d!.members.find(m => m.name === 'check-never-ran')!;
    expect(never.source).toBe('config-only');
    expect(never.transcripts).toEqual([]);

    const extra = d!.members.find(m => m.name === 'check-extra')!;
    expect(extra.source).toBe('transcript-only');
    expect(extra.prompt).toBe('');

    expect(d!.leadSessionIdFromConfig).toBe('f78e79be-b5a5-4082-a707-1a335b523067');
    expect(d!.configPath).toBe(join(teamsDir, TEAM, 'config.json'));
  });

  it('collects multiple transcripts for a respawned member, newest first', async () => {
    writeMeta(SESS_A, 'check-readme', 'aaaa000011112222', {}, { mtime: 1_700_000_000_000 });
    writeMeta(SESS_B, 'check-readme', 'bbbb000011112222', {}, { mtime: 1_700_000_100_000 });
    const d = await getTeamDetail(projectDir, TEAM, opts());
    const m = d!.members[0];
    expect(m.transcripts.map(t => t.sessionId)).toEqual([SESS_B, SESS_A]);
  });

  it('returns null for unknown or unsafe team names', async () => {
    writeMeta(SESS_A, 'check-readme', 'aaaa000011112222');
    expect(await getTeamDetail(projectDir, 'session-unknown0', opts())).toBeNull();
    expect(await getTeamDetail(projectDir, '../escape', opts())).toBeNull();
  });

  it('enriches the detail with timeline events and member metrics', async () => {
    writeMeta(SESS_A, 'check-changelog', 'aaaa000011112222', {}, { content: MEMBER_JSONL });
    const d = await getTeamDetail(projectDir, TEAM, opts());
    expect(d!.events).toHaveLength(3);
    expect(d!.events.map(e => e.kind)).toEqual(['dispatch', 'message', 'message']);
    // Sorted by timestamp, oldest first.
    expect([...d!.events].sort((a, b) => a.timestamp - b.timestamp)).toEqual(d!.events);
    const m = d!.members[0];
    expect(m.messageCount).toBe(2);
    expect(m.toolCallCount).toBe(2);
    expect(m.totalTokens).toBe(1430);
    // Rolled up onto the team-level fields too.
    expect(d!.memberTokens).toEqual([1430]);
    expect(d!.totalTokens).toBe(1430);
    expect(d!.messageCount).toBe(2);
  });

  it('degrades gracefully when the registry entry is gone', async () => {
    writeMeta(SESS_A, 'check-readme', 'aaaa000011112222');
    const d = await getTeamDetail(projectDir, TEAM, opts());
    expect(d!.hasConfig).toBe(false);
    expect(d!.configPath).toBeNull();
    expect(d!.leadSessionIdFromConfig).toBeNull();
    expect(d!.members[0].source).toBe('transcript-only');
  });
});
