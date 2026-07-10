import {
  parseRunFile,
  parseAgentEntry,
  originSessionFromScriptPath,
  isSafeRunId,
  getProjectWorkflows,
  getWorkflowRun,
} from '../electron/modules/workflows-reader';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let dir: string; // stands in for a project dir ~/.claude/projects/{hash}

const SESS_A = '11111111-1111-1111-1111-111111111111';
const SESS_B = '22222222-2222-2222-2222-222222222222';
const SESS_C = '33333333-3333-3333-3333-333333333333';

function scriptPathFor(sessionId: string, name: string, runId: string): string {
  return join(dir, sessionId, 'workflows', 'scripts', `${name}-${runId}.js`);
}

// A realistic run-state object; overrides merge over these defaults.
function runState(runId: string, launchSession: string, over: Record<string, unknown> = {}) {
  const name = (over.workflowName as string) ?? 'code-review';
  return {
    runId,
    timestamp: '2026-07-09T17:20:37.164Z',
    taskId: 'tsk1',
    script: 'export const meta = {}',
    scriptPath: scriptPathFor(launchSession, name, runId),
    args: 'high',
    result: { ok: true },
    agentCount: 2,
    logs: ['line one', 'line two'],
    durationMs: 120000,
    summary: 'a summary',
    workflowName: name,
    status: 'completed',
    startTime: 3000,
    phases: [
      { title: 'Find', detail: 'find things' },
      { title: 'Verify' },
    ],
    defaultModel: 'claude-fable-5',
    totalTokens: 42000,
    totalToolCalls: 9,
    workflowProgress: [
      { type: 'workflow_phase', index: 1, title: 'Find' },
      {
        type: 'workflow_agent',
        index: 1,
        label: 'finder',
        phaseIndex: 1,
        phaseTitle: 'Find',
        agentId: 'aFINDER',
        model: 'claude-fable-5',
        state: 'done',
        attempt: 1,
        tokens: 21000,
        toolCalls: 4,
        durationMs: 60000,
        lastToolName: 'Grep',
        promptPreview: 'find the bugs',
        resultPreview: '{"bugs":[]}',
      },
      {
        type: 'workflow_agent',
        index: 2,
        label: 'verifier',
        phaseIndex: 2,
        phaseTitle: 'Verify',
        agentId: 'aVERIFY',
        model: 'claude-fable-5',
        state: 'error',
        attempt: 2,
        error: 'session limit',
      },
    ],
    ...over,
  };
}

function writeRun(stateSession: string, launchSession: string, runId: string, over = {}): void {
  const wfDir = join(dir, stateSession, 'workflows');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, `${runId}.json`), JSON.stringify(runState(runId, launchSession, over)), 'utf-8');
}

function writeScript(session: string, name: string, runId: string): void {
  const scriptsDir = join(dir, session, 'workflows', 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, `${name}-${runId}.js`), '// script', 'utf-8');
}

function writeTranscript(session: string, runId: string, agentIds: string[]): void {
  const tDir = join(dir, session, 'subagents', 'workflows', runId);
  mkdirSync(tDir, { recursive: true });
  for (const id of agentIds) {
    writeFileSync(join(tDir, `agent-${id}.jsonl`), '{}', 'utf-8');
    writeFileSync(join(tDir, `agent-${id}.meta.json`), '{}', 'utf-8');
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cl-wf-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseAgentEntry', () => {
  it('parses a full workflow_agent entry', () => {
    const a = parseAgentEntry({
      type: 'workflow_agent',
      index: 1,
      label: 'finder',
      phaseIndex: 1,
      phaseTitle: 'Find',
      agentId: 'aX',
      model: 'm',
      state: 'done',
      attempt: 1,
      tokens: 10,
      toolCalls: 2,
      durationMs: 100,
      lastToolName: 'Grep',
      lastToolSummary: 'ripgrep',
      promptPreview: 'p',
      resultPreview: 'r',
    });
    expect(a).toMatchObject({ label: 'finder', agentId: 'aX', state: 'done', tokens: 10, lastToolName: 'Grep' });
  });

  it('returns null for non-agent entries', () => {
    expect(parseAgentEntry({ type: 'workflow_phase', index: 1, title: 'Find' })).toBeNull();
    expect(parseAgentEntry({ index: 1 })).toBeNull();
    expect(parseAgentEntry(null)).toBeNull();
    expect(parseAgentEntry('x')).toBeNull();
  });

  it('defaults state/attempt and leaves missing optionals undefined', () => {
    const a = parseAgentEntry({ type: 'workflow_agent', agentId: 'aY' });
    expect(a).toMatchObject({ state: 'unknown', attempt: 1, label: '', agentId: 'aY' });
    expect(a?.tokens).toBeUndefined();
    expect(a?.error).toBeUndefined();
    expect(a?.lastToolName).toBeUndefined();
  });
});

describe('originSessionFromScriptPath', () => {
  it('extracts the launching session segment', () => {
    const p = join('/proj', SESS_A, 'workflows', 'scripts', 'code-review-wf_x.js');
    expect(originSessionFromScriptPath(p, '/proj')).toBe(SESS_A);
  });

  it('normalizes backslashes (POSIX path read on Windows)', () => {
    expect(originSessionFromScriptPath(`/proj/${SESS_A}/workflows/scripts/n-wf_x.js`, '\\proj')).toBe(SESS_A);
  });

  it('returns null when outside the project or unsafe', () => {
    expect(originSessionFromScriptPath('/other/x/workflows/scripts/a.js', '/proj')).toBeNull();
    expect(originSessionFromScriptPath('/proj/../etc/workflows/scripts/a.js', '/proj')).toBeNull();
    expect(originSessionFromScriptPath('', '/proj')).toBeNull();
    expect(originSessionFromScriptPath(42, '/proj')).toBeNull();
  });
});

describe('isSafeRunId', () => {
  it('requires the wf_ prefix and rejects traversal/separators', () => {
    expect(isSafeRunId('wf_afd71916-020')).toBe(true);
    expect(isSafeRunId('afd71916')).toBe(false);
    expect(isSafeRunId('wf_../../etc')).toBe(false);
    expect(isSafeRunId('wf_a/b')).toBe(false);
    expect(isSafeRunId(123)).toBe(false);
  });
});

describe('parseRunFile', () => {
  const ctx = { projectPath: '/proj', stateSessionId: SESS_B, fallbackMtimeMs: 999 };

  it('derives counts and sessionId from scriptPath', () => {
    const d = parseRunFile(runState('wf_1', SESS_A), { ...ctx, projectPath: dir });
    expect(d).not.toBeNull();
    expect(d!.sessionId).toBe(SESS_A); // launching session, not stateSessionId
    expect(d!.agentCount).toBe(2);
    expect(d!.errorAgentCount).toBe(1);
    expect(d!.phaseCount).toBe(2);
    expect(d!.agents).toHaveLength(2);
    expect(d!.status).toBe('completed');
    expect(d!.totalTokens).toBe(42000);
  });

  it('falls back to stateSessionId when scriptPath is unusable', () => {
    const d = parseRunFile(runState('wf_1', SESS_A, { scriptPath: '/elsewhere/x.js' }), ctx);
    expect(d!.sessionId).toBe(SESS_B);
  });

  it('stringifies non-string args and defaults an absent one', () => {
    expect(parseRunFile(runState('wf_1', SESS_A, { args: { a: 1 } }), ctx)!.args).toBe('{"a":1}');
    expect(parseRunFile(runState('wf_1', SESS_A, { args: undefined }), ctx)!.args).toBe('');
  });

  it('resolves startTime through the fallback chain', () => {
    expect(parseRunFile(runState('wf_1', SESS_A, { startTime: 5000 }), ctx)!.startTime).toBe(5000);
    const fromTs = parseRunFile(runState('wf_1', SESS_A, { startTime: undefined }), ctx)!;
    expect(fromTs.startTime).toBe(Date.parse('2026-07-09T17:20:37.164Z'));
    const fromMtime = parseRunFile(runState('wf_1', SESS_A, { startTime: undefined, timestamp: '' }), ctx)!;
    expect(fromMtime.startTime).toBe(999);
  });

  it('returns null for a missing runId or a non-object', () => {
    expect(parseRunFile(runState('', SESS_A), ctx)).toBeNull();
    expect(parseRunFile(null, ctx)).toBeNull();
    expect(parseRunFile('nope', ctx)).toBeNull();
  });

  it('rejects unsafe runIds the detail handler would refuse', () => {
    // Listing them would create rows getWorkflowRun then rejects (unopenable).
    expect(parseRunFile(runState('no-prefix', SESS_A), ctx)).toBeNull();
    expect(parseRunFile(runState('wf_../etc', SESS_A), ctx)).toBeNull();
  });

  it("counts 'failed' agents as errored alongside 'error'", () => {
    const d = parseRunFile(
      runState('wf_1', SESS_A, {
        workflowProgress: [
          { type: 'workflow_agent', index: 1, agentId: 'a1', state: 'error' },
          { type: 'workflow_agent', index: 2, agentId: 'a2', state: 'failed' },
          { type: 'workflow_agent', index: 3, agentId: 'a3', state: 'done' },
        ],
      }),
      ctx
    );
    expect(d!.errorAgentCount).toBe(2);
  });
});

describe('getProjectWorkflows', () => {
  it('groups runs by launching session, newest first', async () => {
    // Two runs launched by A; one's state lives under B (fork).
    writeRun(SESS_A, SESS_A, 'wf_aaa1', { startTime: 3000, workflowName: 'code-review' });
    writeScript(SESS_A, 'code-review', 'wf_aaa1');
    writeTranscript(SESS_A, 'wf_aaa1', ['a1']);

    writeRun(SESS_B, SESS_A, 'wf_bbb2', { startTime: 2000, workflowName: 'code-review' });
    writeScript(SESS_A, 'code-review', 'wf_bbb2');
    writeTranscript(SESS_A, 'wf_bbb2', ['b1']);

    const groups = await getProjectWorkflows(dir);
    const gA = groups.find(g => g.sessionId === SESS_A);
    expect(gA).toBeTruthy();
    expect(gA!.filename).toBe(`${SESS_A}.jsonl`);
    expect(gA!.runs.map(r => r.runId)).toEqual(['wf_aaa1', 'wf_bbb2']); // desc by startTime
    // No stray group for B (state dir) — the run is grouped under its launcher.
    expect(groups.find(g => g.sessionId === SESS_B)).toBeUndefined();
  });

  it('surfaces orphan transcripts as degraded runs', async () => {
    writeScript(SESS_C, 'orphanflow', 'wf_ccc3'); // name recovered from filename
    writeTranscript(SESS_C, 'wf_ccc3', ['c1', 'c2']);

    const groups = await getProjectWorkflows(dir);
    const gC = groups.find(g => g.sessionId === SESS_C);
    expect(gC).toBeTruthy();
    const run = gC!.runs[0];
    expect(run.degraded).toBe(true);
    expect(run.status).toBe('unknown');
    expect(run.workflowName).toBe('orphanflow');
    expect(run.agentCount).toBe(2);
  });

  it('skips malformed run JSON without throwing', async () => {
    const wfDir = join(dir, SESS_A, 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'wf_bad.json'), '{ not json', 'utf-8');
    writeRun(SESS_A, SESS_A, 'wf_ok1', { startTime: 1000 });

    const groups = await getProjectWorkflows(dir);
    const ids = groups.flatMap(g => g.runs.map(r => r.runId));
    expect(ids).toContain('wf_ok1');
    expect(ids).not.toContain('wf_bad');
  });

  it('returns [] for a project with no session dirs', async () => {
    expect(await getProjectWorkflows(join(dir, 'nope'))).toEqual([]);
  });

  it('lists a runId once even when its state file exists under two session dirs', async () => {
    writeRun(SESS_A, SESS_A, 'wf_dup1', { startTime: 1000 });
    writeRun(SESS_B, SESS_A, 'wf_dup1', { startTime: 1000 });

    const groups = await getProjectWorkflows(dir);
    const ids = groups.flatMap(g => g.runs.map(r => r.runId));
    expect(ids.filter(id => id === 'wf_dup1')).toHaveLength(1);
  });
});

describe('getWorkflowRun', () => {
  it('finds a run whose state lives under a different session than the group', async () => {
    // Grouped under A, but state physically under B.
    writeRun(SESS_B, SESS_A, 'wf_x1', { startTime: 3000 });
    writeTranscript(SESS_A, 'wf_x1', ['a1']);

    const d = await getWorkflowRun(dir, SESS_A, 'wf_x1'); // caller passes the group session (A)
    expect(d).not.toBeNull();
    expect(d!.sessionId).toBe(SESS_A); // origin from scriptPath
    expect(d!.agents.length).toBe(2);
    expect(d!.degraded).toBe(false);
  });

  it('recovers a degraded detail for an orphan run', async () => {
    writeScript(SESS_C, 'orphanflow', 'wf_orph');
    writeTranscript(SESS_C, 'wf_orph', ['c1', 'c2']);

    const d = await getWorkflowRun(dir, SESS_C, 'wf_orph');
    expect(d).not.toBeNull();
    expect(d!.degraded).toBe(true);
    expect(d!.orphanAgentIds?.sort()).toEqual(['c1', 'c2']);
    expect(d!.workflowName).toBe('orphanflow');
  });

  it('rejects unsafe run ids and returns null', async () => {
    expect(await getWorkflowRun(dir, SESS_A, '../../../etc/passwd')).toBeNull();
    expect(await getWorkflowRun(dir, SESS_A, 'afd71916')).toBeNull(); // no wf_ prefix
    expect(await getWorkflowRun(dir, SESS_A, 'wf_missing')).toBeNull(); // safe but absent
  });
});
