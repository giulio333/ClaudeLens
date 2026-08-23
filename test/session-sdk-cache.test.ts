import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readChatSessionViaSdk,
  readSubagentTranscriptViaSdk,
  getSessionReadCacheStats,
  resetSessionReadCache,
  type SessionSource,
} from '../electron/modules/session-reader';
import {
  readSessionSubagentsViaSdk,
  getSubagentsCacheStats,
  resetSubagentsCache,
} from '../electron/modules/subagents-reader';

// Auth-free integration test against the REAL Agent SDK, like session-sdk-read:
// no model turn, no API key, just files on disk. It covers the two things that
// can silently lose a transcript — the `dir` narrowing hint and the mtime+size
// read cache — plus the sub-agent prompt correlation, which now derives from the
// mapped parent transcript instead of a second raw read of the same file.
const SESSION_ID = '11111111-2222-3333-4444-555555555555';
/** A session in the SAME project that dispatched no sub-agent — the common case,
 *  and the one where an empty scoped read has to be believed rather than retried. */
const SESSION_NO_SUB = '66666666-7777-8888-9999-000000000000';
const AGENT_ID = 'abc123';
const DISPATCH_PROMPT = 'Investigate the flaky test in the parser suite';
const CWD = join(tmpdir(), 'cl-cache-proj');

let home: string;
let projDir: string;
let transcript: string;
let subagentTranscript: string;
let source: SessionSource;

const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;

function jsonl(lines: unknown[]): string {
  return lines.map(l => JSON.stringify(l)).join('\n') + '\n';
}

function userLine(uuid: string, parentUuid: string | null, text: string) {
  return {
    parentUuid,
    isSidechain: false,
    type: 'user',
    uuid,
    cwd: CWD,
    timestamp: '2026-06-17T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  };
}

function assistantLine(uuid: string, parentUuid: string, content: unknown[]) {
  return {
    parentUuid,
    isSidechain: false,
    type: 'assistant',
    uuid,
    cwd: CWD,
    timestamp: '2026-06-17T10:00:01.000Z',
    message: {
      model: 'claude-opus-4-8',
      id: `msg_${uuid}`,
      type: 'message',
      role: 'assistant',
      content,
    },
  };
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'cl-sdk-cache-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  // The SDK derives the project dir name by hashing the cwd (path separators →
  // '-'), which is exactly what `dir` is matched against.
  projDir = join(home, '.claude', 'projects', CWD.replace(/\//g, '-'));
  mkdirSync(join(projDir, SESSION_ID, 'subagents'), { recursive: true });

  transcript = join(projDir, `${SESSION_ID}.jsonl`);
  subagentTranscript = join(projDir, SESSION_ID, 'subagents', `agent-${AGENT_ID}.jsonl`);
  source = { projectDir: projDir, cwd: CWD };
});

/**
 * The transcripts every test reads, back at their starting length.
 *
 * They are fixtures, not accumulated state — but two tests here append to
 * them on purpose (that IS what they assert: a grown transcript must
 * invalidate its cache), and what they leave behind changed the answer for
 * whoever ran next. In file order the growers happen to run last; reordered,
 * a sub-agent that had answered once reported two messages. Written from
 * `beforeEach` alongside the cache resets, so each test starts from the same
 * disk as well as the same cache.
 */
function writeFixtures(): void {
  writeFileSync(
    transcript,
    jsonl([
      { type: 'mode', mode: 'normal', sessionId: SESSION_ID, cwd: CWD },
      userLine('u1', null, 'hello world'),
      assistantLine('a1', 'u1', [
        { type: 'text', text: 'dispatching' },
        { type: 'tool_use', id: 'toolu_1', name: 'Task', input: { prompt: DISPATCH_PROMPT } },
      ]),
    ])
  );

  writeFileSync(
    subagentTranscript,
    jsonl([
      {
        parentUuid: null,
        isSidechain: true,
        type: 'user',
        uuid: 's1',
        cwd: CWD,
        timestamp: '2026-06-17T10:00:02.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'internal sub prompt' }] },
      },
    ])
  );
  // The link back to the dispatching tool_use lives in the sidecar, NOT in the
  // transcript lines: the SDK fills `parent_tool_use_id` from this `toolUseId`
  // (verified against the SDK — a line-level field is ignored). Without it the
  // reader can only fall back to the sub-agent's own first message.
  writeFileSync(
    join(projDir, SESSION_ID, 'subagents', `agent-${AGENT_ID}.meta.json`),
    JSON.stringify({ toolUseId: 'toolu_1', parentAgentId: null })
  );

  // Same project, no `subagents/` dir at all.
  writeFileSync(
    join(projDir, `${SESSION_NO_SUB}.jsonl`),
    jsonl([
      { type: 'mode', mode: 'normal', sessionId: SESSION_NO_SUB, cwd: CWD },
      userLine('n1', null, 'a session that dispatched nothing'),
      assistantLine('n2', 'n1', [{ type: 'text', text: 'answered directly' }]),
    ])
  );
}

beforeEach(() => {
  writeFixtures();
  resetSessionReadCache();
  resetSubagentsCache();
});

afterAll(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realUserProfile;
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('readChatSessionViaSdk — dir narrowing', () => {
  it('finds the transcript when scoped to the project cwd', async () => {
    const messages = await readChatSessionViaSdk(SESSION_ID, source);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('falls back to the unscoped search when the cwd hint is wrong', async () => {
    // resolveRealPath falls back to a lossy hash→path inversion when no
    // transcript carries an authoritative cwd, so a wrong hint is reachable in
    // production. The SDK answers a wrong `dir` with [] rather than an error —
    // without the fallback that would render as an empty session.
    const messages = await readChatSessionViaSdk(SESSION_ID, {
      projectDir: projDir,
      cwd: join(tmpdir(), 'cl-not-a-project'),
    });
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('still works with no source at all (unchanged legacy behaviour)', async () => {
    const messages = await readChatSessionViaSdk(SESSION_ID);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('readChatSessionViaSdk — change-stamped cache', () => {
  it('serves an unchanged transcript without re-reading it', async () => {
    const first = await readChatSessionViaSdk(SESSION_ID, source);
    const second = await readChatSessionViaSdk(SESSION_ID, source);

    // Same instance: the loader never ran a second time.
    expect(second).toBe(first);
    expect(getSessionReadCacheStats().chat).toMatchObject({ hits: 1, misses: 1 });
  });

  it('re-reads after the transcript grows, and shows the new turn', async () => {
    const before = await readChatSessionViaSdk(SESSION_ID, source);
    expect(before).toHaveLength(2);

    appendFileSync(transcript, jsonl([userLine('u2', 'a1', 'a follow-up question')]));

    const after = await readChatSessionViaSdk(SESSION_ID, source);
    expect(after).not.toBe(before);
    expect(after).toHaveLength(3);
    expect(after[2].content).toEqual([{ type: 'text', text: 'a follow-up question' }]);

    // Restore the fixture for the remaining tests.
    writeFileSync(transcript, jsonl([]));
    writeFileSync(
      transcript,
      jsonl([
        { type: 'mode', mode: 'normal', sessionId: SESSION_ID, cwd: CWD },
        userLine('u1', null, 'hello world'),
        assistantLine('a1', 'u1', [
          { type: 'text', text: 'dispatching' },
          { type: 'tool_use', id: 'toolu_1', name: 'Task', input: { prompt: DISPATCH_PROMPT } },
        ]),
      ])
    );
  });

  it('does not cache when the transcript location is unknown', async () => {
    const first = await readChatSessionViaSdk(SESSION_ID, { cwd: CWD });
    const second = await readChatSessionViaSdk(SESSION_ID, { cwd: CWD });

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    expect(getSessionReadCacheStats().chat).toMatchObject({
      hits: 0,
      misses: 0,
      uncacheable: 2,
    });
  });
});

// The `dir` hint only pays off if an EMPTY scoped answer can be believed: the
// common case is a session with no sub-agents, and retrying that unscoped runs
// the cross-project scan the hint exists to avoid — on every flush of a live
// session, since each append invalidates the entry.
describe('dir narrowing — a proven scope spares the cross-project retry', () => {
  it('retries while the scope is unproven', async () => {
    const metas = await readSessionSubagentsViaSdk(SESSION_NO_SUB, source);

    expect(metas).toEqual([]);
    // Nothing has confirmed this cwd yet, so [] is treated as "maybe the hint is
    // wrong" and the unscoped search runs.
    expect(getSessionReadCacheStats().unscopedRetries).toBe(1);
  });

  it('believes an empty scoped read once the same cwd has produced results', async () => {
    // One successful scoped read is the evidence: the SDK does resolve this cwd
    // to a project dir holding our sessions.
    await readChatSessionViaSdk(SESSION_ID, source);
    expect(getSessionReadCacheStats().unscopedRetries).toBe(0);

    const metas = await readSessionSubagentsViaSdk(SESSION_NO_SUB, source);

    expect(metas).toEqual([]);
    expect(getSessionReadCacheStats().unscopedRetries).toBe(0);
  });

  it('still retries for a wrong hint, even after another cwd was proven', async () => {
    await readChatSessionViaSdk(SESSION_ID, source);

    // A different session (so the read actually runs rather than hitting the
    // cache) read through a hint nothing has confirmed.
    const messages = await readChatSessionViaSdk(SESSION_NO_SUB, {
      projectDir: projDir,
      cwd: join(tmpdir(), 'cl-not-a-project'),
    });

    // The evidence is per-cwd: an unproven hint is never trusted, so the
    // transcript is still found.
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(getSessionReadCacheStats().unscopedRetries).toBe(1);
  });
});

describe('readSessionSubagentsViaSdk', () => {
  it('correlates the dispatch prompt from the parent transcript', async () => {
    // Exercises the refactor: the tool_use → prompt map is now built from the
    // MAPPED parent transcript (shared with the chat read) instead of a second
    // raw parse of the same file. If mapping dropped or reshaped the tool_use
    // block, this falls back to the sub-agent's own 'internal sub prompt'.
    const metas = await readSessionSubagentsViaSdk(SESSION_ID, source);
    expect(metas).toHaveLength(1);
    expect(metas[0].agentId).toBe(AGENT_ID);
    expect(metas[0].firstPrompt).toBe(DISPATCH_PROMPT);
    expect(metas[0].messageCount).toBe(1);
  });

  it('preserves the tool_use block the correlation depends on', async () => {
    const messages = await readChatSessionViaSdk(SESSION_ID, source);
    const dispatch = messages
      .flatMap(m => m.content)
      .find(b => b.type === 'tool_use' && b.name === 'Task');

    expect(dispatch).toEqual({
      type: 'tool_use',
      id: 'toolu_1',
      name: 'Task',
      input: { prompt: DISPATCH_PROMPT },
    });
  });

  it('reuses the chat read instead of parsing the parent transcript twice', async () => {
    await readChatSessionViaSdk(SESSION_ID, source);
    await readSessionSubagentsViaSdk(SESSION_ID, source);

    // One miss total: the sub-agent pass was served the parent transcript from
    // the same cache rather than reading the file a second time.
    expect(getSessionReadCacheStats().chat).toMatchObject({ hits: 1, misses: 1 });
  });

  it('serves unchanged sources without re-reading', async () => {
    const first = await readSessionSubagentsViaSdk(SESSION_ID, source);
    const second = await readSessionSubagentsViaSdk(SESSION_ID, source);

    expect(second).toBe(first);
    expect(getSubagentsCacheStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('invalidates when a sub-agent transcript grows', async () => {
    const before = await readSessionSubagentsViaSdk(SESSION_ID, source);
    expect(before[0].messageCount).toBe(1);

    appendFileSync(
      subagentTranscript,
      jsonl([
        {
          parentUuid: 's1',
          isSidechain: true,
          type: 'assistant',
          uuid: 's2',
          cwd: CWD,
          parent_tool_use_id: 'toolu_1',
          timestamp: '2026-06-17T10:00:03.000Z',
          message: {
            model: 'claude-opus-4-8',
            id: 'msg_s2',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'sub answer' }],
          },
        },
      ])
    );

    const after = await readSessionSubagentsViaSdk(SESSION_ID, source);
    expect(after).not.toBe(before);
    expect(after[0].messageCount).toBe(2);
  });
});

describe('readSubagentTranscriptViaSdk', () => {
  it('reads the sub-agent transcript and caches it on the subagents tree', async () => {
    const first = await readSubagentTranscriptViaSdk(SESSION_ID, AGENT_ID, source);
    expect(first.length).toBeGreaterThan(0);
    expect(first[0].role).toBe('user');

    const second = await readSubagentTranscriptViaSdk(SESSION_ID, AGENT_ID, source);
    expect(second).toBe(first);
    expect(getSessionReadCacheStats().subagentTranscript).toMatchObject({ hits: 1, misses: 1 });
  });

  it('falls back to the unscoped read when the cwd hint is wrong', async () => {
    const messages = await readSubagentTranscriptViaSdk(SESSION_ID, AGENT_ID, {
      projectDir: projDir,
      cwd: join(tmpdir(), 'cl-not-a-project'),
    });
    expect(messages.length).toBeGreaterThan(0);
  });
});
