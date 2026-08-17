import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// The projects dir is derived from CLAUDE_DIR, a module constant: point it at a
// tmpdir BEFORE importing the module (same scheme as test/plans-unlinked.test.ts).
const configDir = mkdtempSync(join(homedir(), '.cl-tails-test-'));
process.env.CLAUDE_CONFIG_DIR = configDir;

const tails = await import('../electron/modules/session-tails');
const {
  toolArg,
  foldEvents,
  syncSessionTails,
  onTranscriptChanged,
  getSessionActivity,
  resetSessionTails,
  RECENT_WINDOW_MS,
} = tails;
type SessionActivity = import('../electron/modules/session-tails').SessionActivity;
type ActiveSession = import('../electron/modules/sessions-registry-reader').ActiveSession;

const projectsDir = join(configDir, 'projects');

function session(sessionId: string, extra: Partial<ActiveSession> = {}): ActiveSession {
  return {
    pid: 1234,
    sessionId,
    cwd: '/Users/foo/proj',
    status: 'busy',
    source: 'registry',
    ...extra,
  };
}

function line(blocks: unknown[], timestamp = '2026-08-16T10:00:00.000Z'): string {
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp,
      message: { role: 'assistant', model: 'claude-opus-5', content: blocks },
    }) + '\n'
  );
}

const EMPTY: SessionActivity = {
  sessionId: 's1',
  title: null,
  cwd: null,
  recent: [],
  transcriptPath: null,
  activity: null,
  lastTool: null,
  delegates: [],
  lastActivityAt: null,
  toolCount: 0,
  errorCount: 0,
  model: null,
  endedAt: null,
};

beforeEach(() => {
  resetSessionTails();
  rmSync(projectsDir, { recursive: true, force: true });
  mkdirSync(projectsDir, { recursive: true });
});

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(configDir, { recursive: true, force: true });
});

describe('toolArg', () => {
  it('shortens a path to its last two segments', () => {
    expect(toolArg({ file_path: '/Users/foo/Projects/app/src/main.ts' })).toBe('…/src/main.ts');
    expect(toolArg({ file_path: 'src/main.ts' })).toBe('src/main.ts');
  });

  it('flattens and caps a command', () => {
    expect(toolArg({ command: 'npm  test' })).toBe('npm test');
    expect(toolArg({ command: 'x'.repeat(80) })).toHaveLength(64);
  });

  it('returns empty when nothing is worth a line', () => {
    expect(toolArg({ offset: 12, limit: 3 })).toBe('');
    expect(toolArg(undefined)).toBe('');
  });
});

describe('foldEvents', () => {
  it('makes a tool call the current activity', () => {
    const next = foldEvents(EMPTY, [
      {
        id: 'a',
        timestamp: '2026-08-16T10:00:00.000Z',
        type: 'tool_use',
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        model: 'claude-opus-5',
      },
    ]);

    expect(next.activity).toBe('busy');
    expect(next.lastTool).toEqual({ name: 'Bash', arg: 'npm test' });
    expect(next.toolCount).toBe(1);
    expect(next.model).toBe('claude-opus-5');
    expect(next.lastActivityAt).toBe(Date.parse('2026-08-16T10:00:00.000Z'));
  });

  it('clears the tool when its result lands, and counts failures', () => {
    const running = foldEvents(EMPTY, [
      { id: 'a', timestamp: '2026-08-16T10:00:00.000Z', type: 'tool_use', toolName: 'Bash' },
    ]);
    const done = foldEvents(running, [
      { id: 'b', timestamp: '2026-08-16T10:00:05.000Z', type: 'tool_result', isError: true },
    ]);

    // A finished tool is no longer what the session is doing.
    expect(done.lastTool).toBeNull();
    expect(done.errorCount).toBe(1);
    expect(done.toolCount).toBe(1);
    expect(done.lastActivityAt).toBe(Date.parse('2026-08-16T10:00:05.000Z'));
  });

  // Regression: a finished turn used to read "thinking" forever. The parser
  // emits a line's status BEFORE that line's content, so an assistant message
  // closing a turn is `idle` then `text` — and folding state out of the text
  // overwrote the conclusion with the thing that came before it.
  it('lets a turn end, instead of the closing text re-opening it', () => {
    const next = foldEvents(EMPTY, [
      { id: 'a', timestamp: '2026-08-16T10:00:00.000Z', type: 'status_change', content: 'idle' },
      { id: 'b', timestamp: '2026-08-16T10:00:00.000Z', type: 'text', content: 'all done' },
    ]);
    expect(next.activity).toBe('idle');
    // The answer still marks the strip: the session did something.
    expect(next.recent.map(m => m.kind)).toEqual(['text']);
  });

  it('takes the last event of a batch as the current state', () => {
    const next = foldEvents(EMPTY, [
      { id: 'a', timestamp: '2026-08-16T10:00:00.000Z', type: 'status_change', content: 'busy' },
      { id: 'b', timestamp: '2026-08-16T10:00:01.000Z', type: 'status_change', content: 'idle' },
    ]);
    expect(next.activity).toBe('idle');
  });

  it('ignores an unparseable timestamp instead of nulling the stamp', () => {
    const seeded = foldEvents(EMPTY, [
      { id: 'a', timestamp: '2026-08-16T10:00:00.000Z', type: 'text', content: 'hi' },
    ]);
    const next = foldEvents(seeded, [{ id: 'b', timestamp: 'not a date', type: 'text' }]);
    expect(next.lastActivityAt).toBe(Date.parse('2026-08-16T10:00:00.000Z'));
  });
});

// Dispatching a sub-agent is the one thing a session does that its own
// transcript then goes silent about: the agent works in a sidecar the tail
// skips. Payloads below are the shapes observed on a real 2.1.233 run.
describe('foldEvents · sub-agent dispatches', () => {
  const DISPATCH = {
    id: 'a',
    timestamp: '2026-08-16T10:00:00.000Z',
    type: 'tool_use' as const,
    toolName: 'Agent',
    toolUseId: 'toolu_01Hxs93TXkQroZzFVbaoBfhE',
    toolInput: { subagent_type: 'Explore', description: 'Map the reads', prompt: 'Find every…' },
  };

  it('names the dispatched agent by its subagent_type', () => {
    const next = foldEvents(EMPTY, [DISPATCH]);
    expect(next.delegates).toEqual([
      { id: 'toolu_01Hxs93TXkQroZzFVbaoBfhE', name: 'Explore', at: Date.parse(DISPATCH.timestamp) },
    ]);
  });

  it('keeps the delegate open across the async launch ack and the turn ending', () => {
    const next = foldEvents(EMPTY, [
      DISPATCH,
      // Arrives 31ms later: it says the agent STARTED, not that it finished.
      {
        id: 'b',
        timestamp: '2026-08-16T10:00:00.031Z',
        type: 'tool_result',
        toolUseId: DISPATCH.toolUseId,
        content: 'Async agent launched successfully. agentId: ae80291f22a598955',
      },
      { id: 'c', timestamp: '2026-08-16T10:00:04.000Z', type: 'status_change', content: 'idle' },
      { id: 'd', timestamp: '2026-08-16T10:00:04.100Z', type: 'text', content: 'Launched it.' },
    ]);
    // The transcript says the turn is over; the agent is still running.
    expect(next.activity).toBe('idle');
    expect(next.delegates.map(d => d.name)).toEqual(['Explore']);
  });

  it('closes the delegate on the task notification that names its dispatch', () => {
    const open = foldEvents(EMPTY, [DISPATCH]);
    const done = foldEvents(open, [
      {
        id: 'e',
        timestamp: '2026-08-16T10:02:28.000Z',
        type: 'user_message',
        toolUseId: DISPATCH.toolUseId,
        content: 'ae80291f22a598955 completed Agent "Map the reads" finished',
      },
    ]);
    expect(done.delegates).toEqual([]);
  });

  it('ignores a notification for a different dispatch', () => {
    const open = foldEvents(EMPTY, [DISPATCH]);
    const other = foldEvents(open, [
      {
        id: 'f',
        timestamp: '2026-08-16T10:02:28.000Z',
        type: 'user_message',
        toolUseId: 'toolu_someoneElse',
        content: 'unrelated',
      },
    ]);
    expect(other.delegates.map(d => d.name)).toEqual(['Explore']);
  });

  it('closes a synchronous dispatch on its real result', () => {
    const open = foldEvents(EMPTY, [{ ...DISPATCH, toolName: 'Task' }]);
    const done = foldEvents(open, [
      {
        id: 'g',
        timestamp: '2026-08-16T10:01:00.000Z',
        type: 'tool_result',
        toolUseId: DISPATCH.toolUseId,
        content: 'Here is what I found: …',
      },
    ]);
    expect(done.delegates).toEqual([]);
  });

  it('tracks several agents at once and closes them independently', () => {
    const two = foldEvents(EMPTY, [
      DISPATCH,
      { ...DISPATCH, id: 'b', toolUseId: 'toolu_2', toolInput: { subagent_type: 'Plan' } },
    ]);
    expect(two.delegates.map(d => d.name)).toEqual(['Explore', 'Plan']);

    const one = foldEvents(two, [
      {
        id: 'c',
        timestamp: '2026-08-16T10:03:00.000Z',
        type: 'user_message',
        toolUseId: 'toolu_2',
        content: 'done',
      },
    ]);
    expect(one.delegates.map(d => d.name)).toEqual(['Explore']);
  });

  it('falls back to a generic name when the dispatch declares no type', () => {
    const next = foldEvents(EMPTY, [{ ...DISPATCH, toolInput: { prompt: 'do a thing' } }]);
    expect(next.delegates.map(d => d.name)).toEqual(['an agent']);
  });

  it('does not open a delegate for an ordinary tool', () => {
    const next = foldEvents(EMPTY, [
      {
        id: 'a',
        timestamp: '2026-08-16T10:00:00.000Z',
        type: 'tool_use',
        toolName: 'Bash',
        toolUseId: 'toolu_x',
      },
    ]);
    expect(next.delegates).toEqual([]);
  });
});

describe('syncSessionTails / onTranscriptChanged', () => {
  it('tails an existing transcript from its end, not from its history', async () => {
    const dir = join(projectsDir, '-Users-foo-proj');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 's1.jsonl');
    writeFileSync(file, line([{ type: 'text', text: 'old history' }]));

    await syncSessionTails([session('s1')]);
    // Nothing read yet: the pre-existing history is not "what it is doing".
    expect(getSessionActivity()[0]).toMatchObject({ activity: null, transcriptPath: file });

    appendFileSync(
      file,
      line([{ type: 'tool_use', name: 'Edit', input: { file_path: '/a/b/c.ts' } }])
    );
    expect(onTranscriptChanged(file)).toBe(true);
    expect(getSessionActivity()[0]).toMatchObject({
      activity: 'busy',
      lastTool: { name: 'Edit', arg: '…/b/c.ts' },
    });
  });

  it('finds a transcript in the sessions/ layout too', async () => {
    const dir = join(projectsDir, '-Users-foo-proj', 'sessions');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 's2.jsonl');
    writeFileSync(file, '');

    await syncSessionTails([session('s2')]);

    expect(getSessionActivity()[0].transcriptPath).toBe(file);
  });

  // A session's registry file is written at startup, its project dir only at the
  // first message: a brand-new session is live with nothing on disk to tail.
  it('adopts a transcript that appears after the session did', async () => {
    await syncSessionTails([session('s3')]);
    expect(getSessionActivity()[0]).toMatchObject({ transcriptPath: null, activity: null });

    const dir = join(projectsDir, '-Users-foo-proj');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 's3.jsonl');
    writeFileSync(file, line([{ type: 'text', text: 'first answer' }]));

    // The watcher reports the new file: its basename IS the session id.
    expect(onTranscriptChanged(file)).toBe(true);
    // Adopted AND read from byte 0 — the file is new, so all of it is "from now
    // on". The mark proves the read; the state stays null because that line
    // carries no stop_reason, and inventing one is exactly what this module
    // must not do.
    expect(getSessionActivity()[0]).toMatchObject({ transcriptPath: file });
    expect(getSessionActivity()[0].recent).toHaveLength(1);
  });

  it('ignores appends of files no live session owns', async () => {
    const dir = join(projectsDir, '-Users-foo-other');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'someone-else.jsonl');
    writeFileSync(file, line([{ type: 'text', text: 'not ours' }]));

    await syncSessionTails([session('s1')]);

    expect(onTranscriptChanged(file)).toBe(false);
    expect(onTranscriptChanged('/tmp/whatever.txt')).toBe(false);
  });

  it('retains a session that left the registry, and stops tailing it', async () => {
    const dir = join(projectsDir, '-Users-foo-proj');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 's1.jsonl');
    writeFileSync(file, '');

    await syncSessionTails([session('s1')], 1_000);
    expect(getSessionActivity()).toHaveLength(1);

    await syncSessionTails([], 2_000);
    // Still listed, but marked as finished — that IS the "recently ended" lane.
    expect(getSessionActivity()).toMatchObject([{ sessionId: 's1', endedAt: 2_000 }]);
    // The path mapping went with it: a later append is nobody's business.
    appendFileSync(file, line([{ type: 'text', text: 'after death' }]));
    expect(onTranscriptChanged(file)).toBe(false);
  });

  it('forgets an ended session once the retention window passes', async () => {
    await syncSessionTails([session('s1')], 1_000);
    await syncSessionTails([], 2_000);
    expect(getSessionActivity()).toHaveLength(1);

    await syncSessionTails([], 2_000 + RECENT_WINDOW_MS + 1);
    expect(getSessionActivity()).toHaveLength(0);
  });

  it('revives a returning session id with its counters and its cursor', async () => {
    const dir = join(projectsDir, '-Users-foo-proj');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 's1.jsonl');
    writeFileSync(file, '');

    await syncSessionTails([session('s1')], 1_000);
    appendFileSync(file, line([{ type: 'tool_use', name: 'Read' }]));
    onTranscriptChanged(file);
    await syncSessionTails([], 2_000);

    // Same id back (a resumed transcript keeps it).
    await syncSessionTails([session('s1')], 3_000);
    const revived = getSessionActivity()[0];
    expect(revived).toMatchObject({ sessionId: 's1', endedAt: null, toolCount: 1 });

    // And it is tailed again rather than watched in silence.
    appendFileSync(file, line([{ type: 'tool_use', name: 'Bash' }]));
    expect(onTranscriptChanged(file)).toBe(true);
    expect(getSessionActivity()[0].toolCount).toBe(2);
  });

  it('keeps a session that is still live across syncs, cursor included', async () => {
    const dir = join(projectsDir, '-Users-foo-proj');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 's1.jsonl');
    writeFileSync(file, '');

    await syncSessionTails([session('s1')]);
    appendFileSync(file, line([{ type: 'tool_use', name: 'Read' }]));
    onTranscriptChanged(file);

    await syncSessionTails([session('s1'), session('s9')]);

    const s1 = getSessionActivity().find(a => a.sessionId === 's1');
    expect(s1?.toolCount).toBe(1); // not re-read from the top
    expect(getSessionActivity()).toHaveLength(2);
  });

  it('skips process-scan entries, which carry no session id', async () => {
    await syncSessionTails([session('', { source: 'process-scan', status: 'unknown' })]);
    expect(getSessionActivity()).toHaveLength(0);
  });
});
