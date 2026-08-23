import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// The projects dir is derived from CLAUDE_DIR, a module constant: point it at a
// tmpdir BEFORE importing the module (same scheme as test/plans-unlinked.test.ts).
const configDir = mkdtempSync(join(homedir(), '.cl-tails-test-'));
process.env.CLAUDE_CONFIG_DIR = configDir;

const tails = await import('../electron/modules/session-tails');
// The spend seed runs through cost-tracker's parse cache, which is module state
// this file shares across its tests — and it is keyed on the assumption that a
// transcript only ever grows. These tests rewrite the SAME path with different
// content, which breaks that assumption: a shorter parse left cached under the
// path, then a longer file written over it, and the incremental read resumes at
// an offset that now falls mid-line, folding a fragment into nothing. Real
// transcripts are append-only, so the cache is right and the fixture is the odd
// one out; it just has to leave no state behind. Without this the file passed
// only in its declared order (`--sequence.shuffle --sequence.seed=42` was enough
// to reorder two tests and report a seeded session's spend as zero).
const { resetParseCache } = await import('../electron/modules/cost-tracker');
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

/** The lines ONE assistant turn is actually written as: Claude Code emits one
 *  per content block and repeats the whole envelope — usage included — on each,
 *  tagged with the same `message.id`/`requestId`. What a real transcript looks
 *  like, and what the tail used to bill once per block. */
function billedTurnLines(id: string, cacheRead: number, output: number, lines = 2): string {
  return (
    Array.from({ length: lines }, (_, i) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-16T10:00:00.000Z',
        requestId: `req_${id}`,
        message: {
          id: `msg_${id}`,
          role: 'assistant',
          model: 'claude-opus-5',
          content: [{ type: 'text', text: `block ${i}` }],
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: cacheRead,
            output_tokens: output,
          },
        },
      })
    ).join('\n') + '\n'
  );
}

/** An assistant line that billed something — what the spend and the context
 *  reading are both derived from. */
function billedLine(cacheRead: number, output: number): string {
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-16T10:00:00.000Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        content: [],
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: cacheRead,
          output_tokens: output,
        },
      },
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
  context: null,
  spend: null,
  spendEstimated: false,
  tokens: 0,
  endedAt: null,
};

beforeEach(() => {
  resetSessionTails();
  resetParseCache();
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

  // The track stopped being a histogram of anonymous activity: each mark says
  // which tool it was, which is what lets a lane read as "Read · Read · Edit".
  it('names the tool on its mark', () => {
    const next = foldEvents(EMPTY, [
      {
        id: 'a',
        timestamp: '2026-08-16T10:00:00.000Z',
        type: 'tool_use',
        toolName: 'Edit',
        toolUseId: 'toolu_1',
      },
    ]);
    expect(next.recent).toEqual([
      { at: Date.parse('2026-08-16T10:00:00.000Z'), kind: 'tool', tool: 'Edit', id: 'toolu_1' },
    ]);
  });

  // A failure is a verdict on the call, not a second action: marking the result
  // too drew two ticks for one tool and overstated the rhythm — the one thing
  // the track measures. And it is paired BY ID, because "the last tool" is the
  // wrong answer whenever two calls are in flight at once.
  it('flags the call that failed, not the last one, and adds no second mark', () => {
    const running = foldEvents(EMPTY, [
      {
        id: 'a',
        timestamp: '2026-08-16T10:00:00.000Z',
        type: 'tool_use',
        toolName: 'Bash',
        toolUseId: 'toolu_fail',
      },
      {
        id: 'b',
        timestamp: '2026-08-16T10:00:01.000Z',
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'toolu_ok',
      },
    ]);
    const done = foldEvents(running, [
      {
        id: 'c',
        timestamp: '2026-08-16T10:00:09.000Z',
        type: 'tool_result',
        isError: true,
        toolUseId: 'toolu_fail',
      },
    ]);

    expect(done.recent).toHaveLength(2);
    expect(done.recent.find(m => m.tool === 'Bash')?.failed).toBe(true);
    expect(done.recent.find(m => m.tool === 'Read')?.failed).toBeUndefined();
    expect(done.errorCount).toBe(1);
  });
});

// The two figures that are only actionable while a session runs: how full its
// context window is, and what it has cost. Both come from the `usage` of the
// assistant lines the tail was already reading and throwing away.
describe('foldEvents · usage', () => {
  const usage = (over: Partial<import('../electron/modules/transcript-tail').TurnUsage> = {}) => ({
    at: Date.parse('2026-08-16T10:00:00.000Z'),
    model: 'claude-opus-5',
    inputTokens: 10,
    outputTokens: 200,
    cacheWriteTokens: 300,
    cacheReadTokens: 120_000,
    ...over,
  });

  // The distinction the whole design rests on: a prompt is a LEVEL, a bill is a
  // TOTAL. Summing prompts across turns would report a window several times
  // fuller than it is — and each turn's prompt already contains the last one's.
  it('replaces the context reading each turn but accumulates the bill', () => {
    const first = foldEvents(EMPTY, [], [usage()]);
    const second = foldEvents(first, [], [usage({ cacheReadTokens: 150_000 })]);

    // The level is the last reading, not the sum of the two.
    expect(first.context).toEqual({ used: 120_310, max: 1_000_000 });
    expect(second.context).toEqual({ used: 150_310, max: 1_000_000 });
    // The totals are the sum of both turns.
    expect(first.tokens).toBe(120_510);
    expect(second.tokens).toBe(120_510 + 150_510);
    expect(second.spend).toBeGreaterThan(first.spend!);
  });

  // Only the newest line of a batch is the current level, even when one append
  // brings several turns.
  it('takes the last turn of a batch as the level', () => {
    const next = foldEvents(EMPTY, [], [usage({ cacheReadTokens: 9_000 }), usage()]);
    expect(next.context?.used).toBe(120_310);
  });

  // Sonnet's window is 200k, Opus 5's is 1M: the same prompt is a different
  // percentage full, so the window is read off the turn's own model.
  it('sizes the window from the model of the turn that reported it', () => {
    const next = foldEvents(
      EMPTY,
      [],
      [usage({ model: 'claude-sonnet-4-6', cacheReadTokens: 90_000 })]
    );
    expect(next.context).toEqual({ used: 90_310, max: 200_000 });
  });

  // A prompt past 200k proves a larger window whatever the id says — printing
  // "137%" would be the alternative.
  it('never reports a window smaller than the prompt it measured', () => {
    const next = foldEvents(
      EMPTY,
      [],
      [usage({ model: 'mystery-model', cacheReadTokens: 400_000 })]
    );
    expect(next.context?.max).toBe(1_000_000);
    expect(next.context!.used).toBeLessThanOrEqual(next.context!.max);
  });

  // A model with no exact entry in the pricing table is priced by family
  // fallback, and a dollar figure the app cannot stand behind has to say so.
  it('marks a spend it had to estimate', () => {
    const exact = foldEvents(EMPTY, [], [usage()]);
    const guessed = foldEvents(EMPTY, [], [usage({ model: 'claude-opus-9-preview' })]);
    expect(exact.spendEstimated).toBe(false);
    expect(guessed.spendEstimated).toBe(true);
  });

  // The bug this dedupe exists for: one assistant turn reaches the fold as
  // several entries (one per content block, each repeating the same usage), and
  // a total that adds them all bills the turn once per block — 1.86× the tokens
  // `cost-tracker` reports for the same transcript, on the one page that quotes
  // a live session's bill.
  it('bills a turn once however many lines it was written as', () => {
    const turn = usage({ usageKey: 'msg_01:req_01' });
    const once = foldEvents(EMPTY, [], [turn]);
    const repeated = foldEvents(EMPTY, [], [turn, { ...turn }, { ...turn }]);

    expect(repeated.tokens).toBe(once.tokens);
    expect(repeated.spend).toBe(once.spend);
    // The level is the same reading either way — the repeats carry it unchanged.
    expect(repeated.context).toEqual(once.context);
  });

  // The repeated lines can straddle two reads: the file grows between the block
  // that opened the turn and the one that closed it. The memory is the caller's
  // for exactly this reason.
  it('still bills it once when the repeat arrives in the next append', () => {
    const turn = usage({ usageKey: 'msg_01:req_01' });
    const seen: string[] = [];
    const first = foldEvents(EMPTY, [], [turn], seen);
    const second = foldEvents(first, [], [{ ...turn }], seen);

    expect(second.tokens).toBe(first.tokens);
    expect(second.spend).toBe(first.spend);
  });

  // Dedupe is not "the same figures twice": two turns can legitimately bill the
  // identical usage, and only the identity tells them apart.
  it('counts a genuinely new turn that happens to bill the same', () => {
    const seen: string[] = [];
    const first = foldEvents(EMPTY, [], [usage({ usageKey: 'msg_01:req_01' })], seen);
    const second = foldEvents(first, [], [usage({ usageKey: 'msg_02:req_02' })], seen);

    expect(second.tokens).toBe(first.tokens * 2);
  });

  it('leaves both figures untouched when an append carries no turns', () => {
    const seeded = foldEvents(EMPTY, [], [usage()]);
    const after = foldEvents(seeded, [
      { id: 'a', timestamp: '2026-08-16T10:00:03.000Z', type: 'tool_use', toolName: 'Read' },
    ]);
    expect(after.context).toEqual(seeded.context);
    expect(after.spend).toBe(seeded.spend);
    expect(after.tokens).toBe(seeded.tokens);
  });
});

describe('foldEvents', () => {
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
    // The read takes the clock because it enforces the retention window itself:
    // left to the real `Date.now()` it would judge a digest stamped 2_000 to be
    // decades old and drop it.
    expect(getSessionActivity(2_000)).toMatchObject([{ sessionId: 's1', endedAt: 2_000 }]);
    // The path mapping went with it: a later append is nobody's business.
    appendFileSync(file, line([{ type: 'text', text: 'after death' }]));
    expect(onTranscriptChanged(file)).toBe(false);
  });

  it('forgets an ended session once the retention window passes', async () => {
    await syncSessionTails([session('s1')], 1_000);
    await syncSessionTails([], 2_000);
    expect(getSessionActivity(2_000)).toHaveLength(1);

    await syncSessionTails([], 2_000 + RECENT_WINDOW_MS + 1);
    expect(getSessionActivity(2_000 + RECENT_WINDOW_MS + 1)).toHaveLength(0);
  });

  // The case above only expires because a second sync arrives — and in the app
  // that sync rides a registry event, which is exactly what stops coming once
  // the last session ends. So the window has to hold on the read too, or the
  // Monitor keeps a card saying "just ended" for hours.
  it('forgets an ended session even when no further sync ever arrives', async () => {
    await syncSessionTails([session('s1')], 1_000);
    await syncSessionTails([], 2_000);

    expect(getSessionActivity(2_000 + RECENT_WINDOW_MS)).toHaveLength(1);
    expect(getSessionActivity(2_000 + RECENT_WINDOW_MS + 1)).toHaveLength(0);
  });

  it('never expires a live session on a read, however late the clock', async () => {
    await syncSessionTails([session('s1')], 1_000);

    expect(getSessionActivity(1_000 + RECENT_WINDOW_MS * 10)).toMatchObject([
      { sessionId: 's1', endedAt: null },
    ]);
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

  // The cursor starts at EOF, so a session already running has its whole bill
  // behind it. Reporting only what happened after ClaudeLens opened would put a
  // money figure on screen that is silently missing most of the session.
  it('seeds the spend of a session that was already running', async () => {
    const dir = join(projectsDir, '-Users-foo-proj');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 's1.jsonl');
    writeFileSync(file, billedLine(400_000, 5_000));

    await syncSessionTails([session('s1')]);

    const seeded = getSessionActivity()[0];
    expect(seeded.tokens).toBe(405_000);
    expect(seeded.spend).toBeGreaterThan(0);

    // …and the tail adds to it rather than starting over.
    appendFileSync(file, billedLine(10_000, 100));
    onTranscriptChanged(file);
    const after = getSessionActivity()[0];
    expect(after.tokens).toBe(415_100);
    expect(after.spend).toBeGreaterThan(seeded.spend!);
  });

  // End to end on the real path, with the transcript a session actually writes:
  // a turn split over two lines must move the bill once. `cost-tracker` (which
  // seeds the figure) has deduped on this identity since #56, so counting both
  // lines here made the same session cost two different amounts depending on
  // which page you read it from.
  it('bills a multi-line turn once when it arrives through the tail', async () => {
    const dir = join(projectsDir, '-Users-foo-proj');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 's1.jsonl');
    writeFileSync(file, '');

    await syncSessionTails([session('s1')]);
    appendFileSync(file, billedTurnLines('01', 120_000, 500));
    onTranscriptChanged(file);

    const after = getSessionActivity()[0];
    expect(after.tokens).toBe(120_500);
    expect(after.context).toEqual({ used: 120_000, max: 1_000_000 });

    // And a turn whose blocks straddle two appends is still one turn.
    const half = billedTurnLines('02', 130_000, 400, 1);
    appendFileSync(file, half);
    onTranscriptChanged(file);
    appendFileSync(file, half);
    onTranscriptChanged(file);
    expect(getSessionActivity()[0].tokens).toBe(120_500 + 130_400);
  });

  // The one case where seeding would be wrong: a transcript that did not exist at
  // sync time is adopted at offset 0, so the tail reads the whole file itself.
  // Seeding it too would bill every turn twice.
  it('never seeds a cursor that reads the file from the top', async () => {
    const dir = join(projectsDir, '-Users-foo-proj');
    mkdirSync(dir, { recursive: true });

    // Live with nothing on disk yet: no path found, so no seed.
    await syncSessionTails([session('s1')]);
    expect(getSessionActivity()[0].spend).toBeNull();

    const file = join(dir, 's1.jsonl');
    writeFileSync(file, billedLine(400_000, 5_000));
    onTranscriptChanged(file);
    const tailed = getSessionActivity()[0];
    expect(tailed.tokens).toBe(405_000);

    // A later sync must not add the same history a second time.
    await syncSessionTails([session('s1')]);
    expect(getSessionActivity()[0].tokens).toBe(405_000);
    expect(getSessionActivity()[0].spend).toBe(tailed.spend);
  });

  it('skips process-scan entries, which carry no session id', async () => {
    await syncSessionTails([session('', { source: 'process-scan', status: 'unknown' })]);
    expect(getSessionActivity()).toHaveLength(0);
  });
});
