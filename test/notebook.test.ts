import { describe, it, expect } from 'vitest';
import {
  buildChecks,
  buildNotebook,
  buildPlan,
  describeCall,
  relativeTo,
} from '../src/components/project/notebook/notebook';
import type { ToolGroup } from '../src/components/project/chat/utils';
import type { ActiveSession, SessionActivity, Task } from '../src/types';

// The Notebook reads one session. These pin what it says and, as much, what it
// refuses to say: no sentence invented from a command or a path, no success for
// a call whose result has not come back, no timestamp on a task.

let seq = 0;
function group(
  name: string,
  input: Record<string, unknown>,
  result: 'ok' | 'error' | 'pending' = 'ok'
): ToolGroup {
  const id = `t${++seq}`;
  return {
    use: { type: 'tool_use', id, name, input },
    result:
      result === 'pending'
        ? null
        : { type: 'tool_result', toolUseId: id, content: '', isError: result === 'error' },
  } as unknown as ToolGroup;
}

const bash = (command: string, result: 'ok' | 'error' | 'pending' = 'ok', description?: string) =>
  group('Bash', description ? { command, description } : { command }, result);

function task(over: Partial<Task> & Pick<Task, 'id' | 'subject'>): Task {
  return { description: '', status: 'pending', blocks: [], blockedBy: [], ...over };
}

function active(over: Partial<ActiveSession> = {}): ActiveSession {
  return { pid: 1, sessionId: 's1', cwd: '/p/acme', status: 'busy', source: 'registry', ...over };
}

function activity(over: Partial<SessionActivity> = {}): SessionActivity {
  return {
    sessionId: 's1',
    title: null,
    titleSource: null,
    transcriptPath: null,
    activity: 'busy',
    lastTool: null,
    delegates: [],
    lastActivityAt: null,
    toolCount: 0,
    errorCount: 0,
    model: null,
    context: null,
    spend: null,
    spendEstimated: false,
    tokens: 0,
    cwd: '/p/acme',
    recent: [],
    endedAt: null,
    ...over,
  };
}

const base = { tasks: [] as Task[], realPath: '/p/acme' };

describe('buildChecks', () => {
  it('keeps one row per command, with its runs in order', () => {
    const checks = buildChecks([
      bash('npm run typecheck', 'error'),
      bash('npx vitest run', 'ok'),
      bash('npm run typecheck', 'ok'),
    ]);
    expect(checks.map(c => c.command)).toEqual(['npm run typecheck', 'npx vitest run']);
    expect(checks[0].runs).toEqual(['fail', 'pass']);
    expect(checks[0].verdict).toBe('pass');
  });

  it('ignores commands that only look around', () => {
    expect(buildChecks([bash('ls -la'), bash('git status'), bash('cat package.json')])).toEqual([]);
  });

  it('never calls a call without a result a success', () => {
    const [check] = buildChecks([bash('npm test', 'pending')]);
    expect(check.runs).toEqual(['pending']);
    expect(check.verdict).toBe('pending');
  });
});

describe('buildPlan', () => {
  it('prefers the in-progress task, and says it with the task’s own activeForm', () => {
    const plan = buildPlan([
      task({ id: '1', subject: 'Read the code', status: 'completed' }),
      task({
        id: '2',
        subject: 'Write the test',
        status: 'in_progress',
        activeForm: 'Writing the test',
      }),
      task({ id: '3', subject: 'Run the suite' }),
    ]);
    expect(plan.current).toBe(1);
    expect(plan.nowLabel).toBe('Writing the test');
    expect(plan.next).toBe('Run the suite');
    expect(plan.done).toBe(1);
  });

  it('has no current task once everything is closed, and none when there are no tasks', () => {
    expect(buildPlan([task({ id: '1', subject: 'x', status: 'completed' })]).current).toBe(-1);
    expect(buildPlan([])).toMatchObject({ current: -1, nowLabel: null, next: null, done: 0 });
  });
});

describe('describeCall', () => {
  it('leads with a Bash call’s own description, and never paraphrases a command', () => {
    expect(describeCall(bash('npx vitest run', 'ok', 'Run the suite'))).toEqual({
      lead: 'Run the suite',
      subject: null,
    });
    expect(describeCall(bash('npx vitest run'))).toEqual({
      lead: 'Running',
      subject: 'npx vitest run',
    });
  });

  it('names the file an edit acts on by its base name', () => {
    expect(describeCall(group('Edit', { file_path: '/p/acme/src/a/View.tsx' }))).toEqual({
      lead: 'Editing',
      subject: 'View.tsx',
    });
  });
});

describe('buildNotebook', () => {
  it('says what is in flight, with the description the digest does not carry', () => {
    const call = bash('npx vitest run test/a.test.ts', 'pending', 'Run the new test');
    const model = buildNotebook({
      ...base,
      ownTools: [call],
      active: active(),
      activity: activity({ lastTool: { name: 'Bash', arg: 'npx vitest run test/a.test.ts' } }),
    });
    expect(model.state).toBe('working');
    expect(model.headline.lead).toBe('Run the new test');
    expect(model.note).toBe('npx vitest run test/a.test.ts');
    expect(model.noteKind).toBe('command');
  });

  it('prints no note where the call has no description (an Edit has none)', () => {
    const model = buildNotebook({
      ...base,
      ownTools: [
        group('Edit', { file_path: '/p/acme/src/a.ts', old_string: 'a', new_string: 'b' }),
      ],
      active: active(),
      activity: activity({ lastTool: { name: 'Edit', arg: '…/src/a.ts' } }),
    });
    expect(model.headline).toEqual({ lead: 'Editing', subject: 'a.ts' });
    expect(model.note).toBeNull();
    expect(model.liveFile).toBe('/p/acme/src/a.ts');
  });

  it('thinks when the digest has no call in flight, and quotes the last verdict', () => {
    const model = buildNotebook({
      ...base,
      ownTools: [bash('npm run typecheck', 'error')],
      active: active(),
      activity: activity({ lastTool: null }),
    });
    expect(model.headline.lead).toBe('Thinking');
    expect(model.note).toBe('failed: npm run typecheck');
    expect(model.noteKind).toBe('last result');
  });

  it('names who it waits for while a sub-agent runs, and the question it was given', () => {
    const model = buildNotebook({
      ...base,
      ownTools: [group('Agent', { subagent_type: 'Explore', description: 'Find the tab code' })],
      active: active(),
      activity: activity({ delegates: [{ id: 'd', name: 'Explore', at: 1 }] }),
    });
    expect(model.headline.lead).toBe('Waiting for Explore');
    expect(model.note).toBe('Find the tab code');
  });

  it('says only what the registry knows about a session waiting on you', () => {
    const model = buildNotebook({
      ...base,
      ownTools: [],
      active: active({ status: 'waiting', waitingFor: 'permission prompt' }),
      activity: activity(),
    });
    expect(model.state).toBe('blocked');
    expect(model.headline.lead).toBe('Waiting for you');
    expect(model.note).toBe('permission prompt');
  });

  it('is ended once the registry has dropped the session, and counts its green checks', () => {
    const model = buildNotebook({
      ...base,
      ownTools: [bash('npm test'), bash('npm run lint', 'error')],
      active: undefined,
      activity: activity({ endedAt: 1 }),
    });
    expect(model.state).toBe('ended');
    expect(model.headline.lead).toBe('Session ended');
    expect(model.note).toBe('1 of 2 checks end green');
  });

  it('lists files read and never changed, relative to the project, once', () => {
    const model = buildNotebook({
      ...base,
      ownTools: [
        group('Read', { file_path: '/p/acme/src/a.ts' }),
        group('Read', { file_path: '/p/acme/src/a.ts' }),
        group('Read', { file_path: '/p/acme/src/b.ts' }),
        group('Edit', { file_path: '/p/acme/src/b.ts', old_string: 'x', new_string: 'y' }),
      ],
      active: active(),
      activity: activity(),
    });
    expect(model.reads).toEqual(['src/a.ts']);
    expect(model.changes.map(c => c.path)).toEqual(['/p/acme/src/b.ts']);
  });
});

describe('relativeTo', () => {
  it('trims the project root, and leaves a path outside it alone', () => {
    expect(relativeTo('/p/acme/src/a.ts', '/p/acme')).toBe('src/a.ts');
    expect(relativeTo('/elsewhere/a.ts', '/p/acme')).toBe('/elsewhere/a.ts');
  });
});
