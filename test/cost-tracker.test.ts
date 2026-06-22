import { mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getProjectUsage,
  calculateCostSummary,
  getSessionList,
  getPricingMeta,
  isModelPriced,
  calculateCacheSavings,
  getParseStats,
  resetParseCache,
  PRICING_LAST_UPDATED,
} from '../electron/modules/cost-tracker';

// ─── Pricing constants (mirror of cost-tracker.ts PRICING table) ──────────────
// Per-million-token prices used to derive expected costs in assertions.
const PRICE = {
  sonnet: { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  opus: { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  haiku: { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
};

function expectedCost(
  p: { input: number; output: number; cacheWrite: number; cacheRead: number },
  t: { input: number; output: number; cacheWrite?: number; cacheRead?: number }
): number {
  return (
    (t.input / 1_000_000) * p.input +
    (t.output / 1_000_000) * p.output +
    ((t.cacheWrite ?? 0) / 1_000_000) * p.cacheWrite +
    ((t.cacheRead ?? 0) / 1_000_000) * p.cacheRead
  );
}

// Build a single assistant JSONL line carrying a usage object + model.
function assistantLine(opts: {
  model?: string;
  input?: number;
  output?: number;
  cacheWrite?: number;
  cacheRead?: number;
  timestamp?: string;
  id?: string;
  requestId?: string;
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: opts.timestamp ?? '2026-05-01T10:00:00.000Z',
    requestId: opts.requestId,
    message: {
      id: opts.id,
      model: opts.model,
      usage: {
        input_tokens: opts.input ?? 0,
        output_tokens: opts.output ?? 0,
        cache_creation_input_tokens: opts.cacheWrite ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
      },
    },
  });
}

function writeSession(dir: string, name: string, lines: string[]): void {
  writeFileSync(join(dir, name), lines.join('\n') + '\n', 'utf-8');
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cl-cost-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('getProjectUsage — token summation & known-model cost', () => {
  it('sums input/output/cache tokens across multiple lines and computes Sonnet cost', async () => {
    writeSession(tmp, 'a.jsonl', [
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 1000,
        output: 500,
        cacheWrite: 200,
        cacheRead: 100,
      }),
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 2000,
        output: 1500,
        cacheWrite: 0,
        cacheRead: 400,
      }),
    ]);

    const { usage, sessionCount, cost } = await getProjectUsage(tmp);

    expect(usage.inputTokens).toBe(3000);
    expect(usage.outputTokens).toBe(2000);
    // totalTokens = input + output (cache excluded, per source)
    expect(usage.totalTokens).toBe(5000);
    expect(sessionCount).toBe(1);

    const exp = expectedCost(PRICE.sonnet, {
      input: 3000,
      output: 2000,
      cacheWrite: 200,
      cacheRead: 500,
    });
    expect(cost).toBeCloseTo(exp, 10);
  });

  it('aggregates token totals across multiple session files', async () => {
    writeSession(tmp, 'one.jsonl', [
      assistantLine({ model: 'claude-opus-4-5', input: 100, output: 50 }),
    ]);
    writeSession(tmp, 'two.jsonl', [
      assistantLine({ model: 'claude-opus-4-5', input: 300, output: 150 }),
    ]);

    const { usage, sessionCount, cost } = await getProjectUsage(tmp);

    expect(usage.inputTokens).toBe(400);
    expect(usage.outputTokens).toBe(200);
    expect(sessionCount).toBe(2);
    expect(cost).toBeCloseTo(expectedCost(PRICE.opus, { input: 400, output: 200 }), 10);
  });
});

describe('malformed timestamp does not abort the file (issue #88)', () => {
  it('keeps counting later lines when one line has a non-ISO timestamp', async () => {
    writeSession(tmp, 'a.jsonl', [
      assistantLine({ model: 'claude-sonnet-4-5', input: 1000, output: 500 }),
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 9999,
        output: 9999,
        timestamp: 'not-a-date',
      }),
      assistantLine({ model: 'claude-sonnet-4-5', input: 2000, output: 1500 }),
    ]);

    const { usage } = await getProjectUsage(tmp);

    // The malformed line is still counted (only its date is dropped), and the
    // line after it is NOT lost — before the fix the loop aborted on line 2.
    expect(usage.inputTokens).toBe(1000 + 9999 + 2000);
    expect(usage.outputTokens).toBe(500 + 9999 + 1500);
  });
});

describe('usage dedup by message.id / requestId (issue #56)', () => {
  it('counts a usage carried by repeated message.id+requestId lines only once', async () => {
    // Claude Code emits one line per content block of an assistant turn, each
    // repeating the same message-level usage tagged with the same ids.
    writeSession(tmp, 'dup.jsonl', [
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 6,
        output: 185,
        cacheRead: 16906,
        id: 'msg_01XHZ',
        requestId: 'req_011Cb',
      }),
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 6,
        output: 185,
        cacheRead: 16906,
        id: 'msg_01XHZ',
        requestId: 'req_011Cb',
      }),
    ]);

    const [s] = await getSessionList(tmp);

    expect(s.inputTokens).toBe(6);
    expect(s.outputTokens).toBe(185);
    expect(s.cacheReadTokens).toBe(16906);
    expect(s.messageCount).toBe(1);
  });

  it('counts distinct ids separately and reports unique messageCount', async () => {
    writeSession(tmp, 'mixed.jsonl', [
      // turn A — two duplicated content-block lines
      assistantLine({ model: 'claude-sonnet-4-5', input: 1, output: 10, id: 'a', requestId: 'r1' }),
      assistantLine({ model: 'claude-sonnet-4-5', input: 1, output: 10, id: 'a', requestId: 'r1' }),
      // turn B — single line, different ids
      assistantLine({ model: 'claude-sonnet-4-5', input: 2, output: 20, id: 'b', requestId: 'r2' }),
    ]);

    const [s] = await getSessionList(tmp);

    expect(s.inputTokens).toBe(3); // 1 (A, once) + 2 (B)
    expect(s.outputTokens).toBe(30); // 10 + 20
    expect(s.messageCount).toBe(2); // two unique turns, not three lines
  });

  it('does not dedup lines that lack both message.id and requestId', async () => {
    // Without a stable key we cannot tell duplicates apart, so keep summing.
    writeSession(tmp, 'nokey.jsonl', [
      assistantLine({ model: 'claude-sonnet-4-5', input: 5, output: 5 }),
      assistantLine({ model: 'claude-sonnet-4-5', input: 5, output: 5 }),
    ]);

    const { usage } = await getProjectUsage(tmp);

    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(10);
  });
});

describe('model pricing resolution / fuzzy fallback to Sonnet', () => {
  it('uses the exact-match Opus price for a known Opus id', async () => {
    writeSession(tmp, 'opus.jsonl', [
      assistantLine({ model: 'claude-opus-4-6', input: 1_000_000, output: 0 }),
    ]);
    const { cost } = await getProjectUsage(tmp);
    expect(cost).toBeCloseTo(PRICE.opus.input, 10); // 1M input tokens = exactly $15
  });

  it('fuzzy-matches an unknown id containing "haiku" to Haiku pricing', async () => {
    writeSession(tmp, 'h.jsonl', [
      assistantLine({ model: 'claude-haiku-9-9-future-build', input: 1_000_000, output: 0 }),
    ]);
    const { cost } = await getProjectUsage(tmp);
    expect(cost).toBeCloseTo(PRICE.haiku.input, 10); // $0.80, NOT Sonnet's $3
  });

  it('fuzzy-matches an unknown id containing "opus" to Opus pricing', async () => {
    writeSession(tmp, 'o.jsonl', [
      assistantLine({ model: 'some-opus-vNext', input: 1_000_000, output: 0 }),
    ]);
    const { cost } = await getProjectUsage(tmp);
    expect(cost).toBeCloseTo(PRICE.opus.input, 10);
  });

  it('falls back to Sonnet pricing for a wholly-unknown model id', async () => {
    writeSession(tmp, 'x.jsonl', [
      assistantLine({ model: 'gpt-mystery-model', input: 1_000_000, output: 0 }),
    ]);
    const { cost } = await getProjectUsage(tmp);
    expect(cost).toBeCloseTo(PRICE.sonnet.input, 10); // conservative default = Sonnet $3
  });

  it('falls back to Sonnet pricing when model is absent / <synthetic>', async () => {
    // <synthetic> is coerced to undefined in source; undefined model -> Sonnet
    writeSession(tmp, 'syn.jsonl', [
      assistantLine({ model: '<synthetic>', input: 1_000_000, output: 0 }),
    ]);
    const { cost } = await getProjectUsage(tmp);
    expect(cost).toBeCloseTo(PRICE.sonnet.input, 10);
  });
});

describe('per-session pricing drives project cost', () => {
  it('prices each session at its own dominant model and sums the dollar costs', async () => {
    // 2 tiny opus sessions vs 1 large haiku session: the project rollup must NOT
    // price the ~1M Haiku tokens at the file-count-dominant Opus rate. Each
    // session is priced at its own model and the dollar costs are summed.
    writeSession(tmp, 'o1.jsonl', [
      assistantLine({ model: 'claude-opus-4-5', input: 10, output: 0 }),
    ]);
    writeSession(tmp, 'o2.jsonl', [
      assistantLine({ model: 'claude-opus-4-5', input: 10, output: 0 }),
    ]);
    writeSession(tmp, 'h1.jsonl', [
      assistantLine({ model: 'claude-haiku-4-5', input: 1_000_000, output: 0 }),
    ]);

    const { usage, cost } = await getProjectUsage(tmp);
    expect(usage.inputTokens).toBe(1_000_020);
    // Opus tokens priced at Opus, Haiku tokens priced at Haiku — summed.
    const expected =
      expectedCost(PRICE.opus, { input: 20, output: 0 }) +
      expectedCost(PRICE.haiku, { input: 1_000_000, output: 0 });
    expect(cost).toBeCloseTo(expected, 8);
  });
});

describe('calculateCostSummary', () => {
  it('returns one ProjectCost per non-empty project, sorted by cost desc, skipping zero-token & dotfile dirs', async () => {
    // Cheap project (Sonnet, small)
    const cheap = join(tmp, 'cheap-proj');
    mkdirSync(cheap);
    writeSession(cheap, 's.jsonl', [
      assistantLine({ model: 'claude-sonnet-4-5', input: 1000, output: 100 }),
    ]);

    // Expensive project (Opus, large)
    const pricey = join(tmp, 'pricey-proj');
    mkdirSync(pricey);
    writeSession(pricey, 's.jsonl', [
      assistantLine({ model: 'claude-opus-4-5', input: 1_000_000, output: 500_000 }),
    ]);

    // Empty project (no usage tokens) -> excluded
    const empty = join(tmp, 'empty-proj');
    mkdirSync(empty);
    writeSession(empty, 's.jsonl', [
      JSON.stringify({ type: 'user', timestamp: '2026-05-01T10:00:00.000Z' }),
    ]);

    // Dotfile dir -> excluded by glob '[!.]*'
    const hidden = join(tmp, '.hidden-proj');
    mkdirSync(hidden);
    writeSession(hidden, 's.jsonl', [
      assistantLine({ model: 'claude-opus-4-5', input: 999, output: 999 }),
    ]);

    const result = await calculateCostSummary(tmp);

    expect(result.map(r => r.project)).toEqual(['pricey-proj', 'cheap-proj']);
    expect(result[0].cost).toBeGreaterThan(result[1].cost);

    const cheapRow = result.find(r => r.project === 'cheap-proj')!;
    expect(cheapRow.inputTokens).toBe(1000);
    expect(cheapRow.outputTokens).toBe(100);
    expect(cheapRow.totalTokens).toBe(1100);
    expect(cheapRow.sessionsCount).toBe(1);
    expect(cheapRow.cost).toBeCloseTo(expectedCost(PRICE.sonnet, { input: 1000, output: 100 }), 10);
  });

  it('returns [] for a directory with no projects', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'cl-cost-empty-'));
    try {
      expect(await calculateCostSummary(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('getSessionList', () => {
  it('reports per-session tokens, per-model counts, cost, messageCount and titles', async () => {
    writeSession(tmp, 'sess.jsonl', [
      JSON.stringify({ type: 'custom-title', customTitle: 'My Session' }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-01T09:00:00.000Z',
        message: { content: 'Please refactor the parser' },
      }),
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 1000,
        output: 500,
        timestamp: '2026-05-01T09:00:01.000Z',
      }),
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 2000,
        output: 800,
        cacheRead: 1000,
        timestamp: '2026-05-01T09:00:02.000Z',
      }),
      // a line with zero usage tokens must NOT bump messageCount or model count
      assistantLine({
        model: 'claude-opus-4-5',
        input: 0,
        output: 0,
        timestamp: '2026-05-01T09:00:03.000Z',
      }),
    ]);

    const [s] = await getSessionList(tmp);

    expect(s.filename).toBe('sess.jsonl');
    expect(s.inputTokens).toBe(3000);
    expect(s.outputTokens).toBe(1300);
    expect(s.cacheReadTokens).toBe(1000);
    expect(s.totalTokens).toBe(4300);
    expect(s.messageCount).toBe(2); // only the two lines with non-zero usage
    expect(s.model).toBe('claude-sonnet-4-5'); // dominant; opus had 0 usage so not counted
    expect(s.models).toEqual({ 'claude-sonnet-4-5': 2 });
    expect(s.customTitle).toBe('My Session');
    expect(s.firstUserMessage).toBe('Please refactor the parser');
    expect(s.estimatedCost).toBeCloseTo(
      expectedCost(PRICE.sonnet, { input: 3000, output: 1300, cacheRead: 1000 }),
      10
    );
  });

  it('firstUserMessage strips only framing tags, keeping code/generics (#93)', async () => {
    writeSession(tmp, 'sess.jsonl', [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-01T09:00:00.000Z',
        message: {
          content: '<system-reminder></system-reminder>Compare List<String> to Map<K,V>',
        },
      }),
      assistantLine({ model: 'claude-sonnet-4-5', input: 10, output: 10 }),
    ]);

    const [s] = await getSessionList(tmp);
    expect(s.firstUserMessage).toBe('Compare List<String> to Map<K,V>');
  });

  it('sorts sessions by date descending', async () => {
    writeSession(tmp, 'older.jsonl', [
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 10,
        output: 10,
        timestamp: '2026-04-01T00:00:00.000Z',
      }),
    ]);
    writeSession(tmp, 'newer.jsonl', [
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 10,
        output: 10,
        timestamp: '2026-05-20T00:00:00.000Z',
      }),
    ]);

    const sessions = await getSessionList(tmp);
    expect(sessions.map(s => s.filename)).toEqual(['newer.jsonl', 'older.jsonl']);
  });

  it('prefers a sessions/ subdirectory over project-root .jsonl files', async () => {
    // root file
    writeSession(tmp, 'root.jsonl', [
      assistantLine({ model: 'claude-sonnet-4-5', input: 10, output: 10 }),
    ]);
    // sessions/ subdir file should win
    const sub = join(tmp, 'sessions');
    mkdirSync(sub);
    writeSession(sub, 'inner.jsonl', [
      assistantLine({ model: 'claude-sonnet-4-5', input: 10, output: 10 }),
    ]);

    const sessions = await getSessionList(tmp);
    expect(sessions.map(s => s.filename)).toEqual(['inner.jsonl']);
  });
});

describe('pricing metadata', () => {
  it('exposes an ISO last-updated date and the list of exactly-priced models', () => {
    const meta = getPricingMeta();
    expect(meta.lastUpdated).toBe(PRICING_LAST_UPDATED);
    expect(meta.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.knownModels).toContain('claude-sonnet-4-6');
    expect(meta.knownModels).toContain('claude-opus-4-6');
    expect(meta.knownModels.length).toBeGreaterThan(0);
  });

  it('isModelPriced is true only for exact table entries, not fuzzy/default matches', () => {
    expect(isModelPriced('claude-sonnet-4-6')).toBe(true);
    expect(isModelPriced('claude-opus-4-6')).toBe(true);
    // priced via fuzzy family fallback → not an exact entry
    expect(isModelPriced('claude-sonnet-9-9-future')).toBe(false);
    // unknown → conservative default, still not "priced"
    expect(isModelPriced('gpt-mystery')).toBe(false);
    expect(isModelPriced(undefined)).toBe(false);
    expect(isModelPriced('<synthetic>')).toBe(false);
  });
});

describe('calculateCacheSavings — avoided input cost from cache reads', () => {
  it('is the delta between full input price and the cache-read price', () => {
    // Sonnet: input $3.00, cacheRead $0.30 → saved $2.70 / 1M cached tokens.
    expect(calculateCacheSavings(1_000_000, 'claude-sonnet-4-6')).toBeCloseTo(2.7, 6);
    // Opus: input $15.00, cacheRead $1.50 → saved $13.50 / 1M.
    expect(calculateCacheSavings(1_000_000, 'claude-opus-4-6')).toBeCloseTo(13.5, 6);
  });

  it('is zero with no cache reads and uses the fuzzy/default model fallback', () => {
    expect(calculateCacheSavings(0, 'claude-opus-4-6')).toBe(0);
    // unknown model → conservative Sonnet pricing (same delta as Sonnet)
    expect(calculateCacheSavings(1_000_000, 'gpt-mystery')).toBeCloseTo(2.7, 6);
    expect(calculateCacheSavings(1_000_000, undefined)).toBeCloseTo(2.7, 6);
  });
});

describe('cache-only usage lines are counted (input=output=0)', () => {
  it('counts a turn served entirely from the cache (cacheRead>0, no input/output)', async () => {
    writeSession(tmp, 'cache.jsonl', [
      assistantLine({
        model: 'claude-sonnet-4-5',
        input: 0,
        output: 0,
        cacheRead: 20000,
        id: 'msg_c',
        requestId: 'req_c',
      }),
    ]);

    const [s] = await getSessionList(tmp);

    // Before the fix the `input || output` guard dropped this line entirely, so
    // cache tokens, savings and messageCount were all silently lost.
    expect(s.cacheReadTokens).toBe(20000);
    expect(s.messageCount).toBe(1);
    expect(s.cacheSavings).toBeCloseTo(calculateCacheSavings(20000, 'claude-sonnet-4-5'), 10);
  });

  it('counts a cache-write-only line (cacheWrite>0, no input/output)', async () => {
    writeSession(tmp, 'cw.jsonl', [
      assistantLine({ model: 'claude-sonnet-4-5', input: 0, output: 0, cacheWrite: 5000 }),
    ]);

    const [s] = await getSessionList(tmp);

    expect(s.cacheWriteTokens).toBe(5000);
    expect(s.messageCount).toBe(1);
  });

  it('still ignores a line with all-zero usage (no tokens of any kind)', async () => {
    writeSession(tmp, 'zero.jsonl', [
      assistantLine({ model: 'claude-sonnet-4-5', input: 100, output: 50 }),
      assistantLine({ model: 'claude-opus-4-5', input: 0, output: 0 }), // all zero → skipped
    ]);

    const [s] = await getSessionList(tmp);

    expect(s.messageCount).toBe(1);
    expect(s.models).toEqual({ 'claude-sonnet-4-5': 1 });
  });
});

describe('firstUserMessage skips tool_result turns (not real user input)', () => {
  it('ignores a user turn carrying a tool_result and uses the real first message', async () => {
    writeSession(tmp, 'tr.jsonl', [
      // A user turn that is the system's reply to a tool call — written by Claude
      // Code, not typed by the user — so it must not become the session title.
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-01T09:00:00.000Z',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'x', content: 'ok' },
            { type: 'text', text: 'tool output follows' },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-01T09:01:00.000Z',
        message: { content: 'Fix the bug in the parser' },
      }),
      assistantLine({ model: 'claude-sonnet-4-5', input: 10, output: 10 }),
    ]);

    const [s] = await getSessionList(tmp);

    // Before the fix the tool_result turn's text block ("tool output follows")
    // was taken as the first user message.
    expect(s.firstUserMessage).toBe('Fix the bug in the parser');
  });
});

// ─── Parse cache: incremental, append-only re-reads ───────────────────────────
// The watcher invalidates the session list on every append of the *active*
// session. These cover the mtime/size cache that serves unchanged files with no
// I/O and folds only the appended tail of a grown transcript.
describe('parse cache — append-only incremental parsing', () => {
  it('serves an unchanged transcript from cache on refetch (no re-read)', async () => {
    resetParseCache();
    writeSession(tmp, 'a.jsonl', [
      assistantLine({ model: 'claude-sonnet-4-5', input: 100, output: 50, id: 'm1', requestId: 'r1' }),
    ]);

    const first = await getSessionList(tmp);
    const cold = getParseStats();
    expect(cold.fullParses).toBe(1);
    expect(cold.fileReads).toBe(1);
    expect(cold.cacheHits).toBe(0);

    const second = await getSessionList(tmp);
    const warm = getParseStats();
    expect(warm.cacheHits).toBe(1); // served from cache
    expect(warm.fileReads).toBe(1); // NO additional read
    expect(warm.fullParses).toBe(1); // not re-parsed
    expect(second).toEqual(first); // identical result
  });

  it('reads only the appended tail when the transcript grows', async () => {
    resetParseCache();
    writeSession(tmp, 'a.jsonl', [
      assistantLine({ model: 'claude-sonnet-4-5', input: 100, output: 50, id: 'm1', requestId: 'r1' }),
    ]);
    const [s1] = await getSessionList(tmp);
    expect(s1.inputTokens).toBe(100);
    const before = getParseStats();

    appendFileSync(
      join(tmp, 'a.jsonl'),
      assistantLine({ model: 'claude-sonnet-4-5', input: 200, output: 30, id: 'm2', requestId: 'r2' }) + '\n'
    );
    const [s2] = await getSessionList(tmp);
    const after = getParseStats();

    expect(after.incrementalParses).toBe(before.incrementalParses + 1);
    expect(after.fullParses).toBe(before.fullParses); // NOT a full re-parse
    expect(s2.inputTokens).toBe(300);
    expect(s2.outputTokens).toBe(80);
    expect(s2.messageCount).toBe(2);
  });

  it('incremental folding equals a full parse, deduping across the append boundary', async () => {
    // The duplicate of m1 (same id+requestId) lands in a *later* increment than
    // the original — it must still be counted once (issue #56 across the boundary).
    const l1 = assistantLine({ model: 'claude-opus-4-5', input: 100, output: 50, id: 'm1', requestId: 'r1' });
    const dup = assistantLine({ model: 'claude-opus-4-5', input: 100, output: 50, id: 'm1', requestId: 'r1' });
    const l2 = assistantLine({ model: 'claude-opus-4-5', input: 200, output: 60, id: 'm2', requestId: 'r2' });

    // Incremental: write l1, then append dup, then append l2 — parsing between each.
    resetParseCache();
    writeSession(tmp, 'a.jsonl', [l1]);
    await getSessionList(tmp);
    appendFileSync(join(tmp, 'a.jsonl'), dup + '\n');
    await getSessionList(tmp);
    appendFileSync(join(tmp, 'a.jsonl'), l2 + '\n');
    const [inc] = await getSessionList(tmp);

    // Full: the same final content parsed from scratch in a fresh dir + clean cache.
    const tmp2 = mkdtempSync(join(tmpdir(), 'cl-cost-'));
    resetParseCache();
    writeSession(tmp2, 'a.jsonl', [l1, dup, l2]);
    const [full] = await getSessionList(tmp2);
    rmSync(tmp2, { recursive: true, force: true });

    expect(inc.messageCount).toBe(2); // dup counted once
    expect(inc).toEqual(full);
  });

  it('buffers a half-written final line and folds it once when completed', async () => {
    resetParseCache();
    const file = join(tmp, 'a.jsonl');
    const l1 = assistantLine({ model: 'claude-sonnet-4-5', input: 100, output: 10, id: 'm1', requestId: 'r1' });
    const l2 = assistantLine({ model: 'claude-sonnet-4-5', input: 200, output: 20, id: 'm2', requestId: 'r2' });

    // l1 complete + the first 20 bytes of l2, with no terminating newline.
    writeFileSync(file, l1 + '\n' + l2.slice(0, 20), 'utf-8');
    const [a] = await getSessionList(tmp);
    expect(a.messageCount).toBe(1); // the partial l2 is buffered, not yet counted
    expect(a.inputTokens).toBe(100);

    appendFileSync(file, l2.slice(20) + '\n');
    const [b] = await getSessionList(tmp);
    expect(b.messageCount).toBe(2); // l2 completed and counted exactly once
    expect(b.inputTokens).toBe(300);
  });

  it('falls back to a full re-parse when the transcript shrinks (replaced/truncated)', async () => {
    resetParseCache();
    writeSession(tmp, 'a.jsonl', [
      assistantLine({ model: 'claude-opus-4-5', input: 100, output: 50, id: 'm1', requestId: 'r1' }),
      assistantLine({ model: 'claude-opus-4-5', input: 100, output: 50, id: 'm2', requestId: 'r2' }),
    ]);
    const [s1] = await getSessionList(tmp);
    expect(s1.inputTokens).toBe(200);
    const before = getParseStats();

    // Replace with a shorter, different transcript (smaller byte size).
    writeSession(tmp, 'a.jsonl', [
      assistantLine({ model: 'claude-opus-4-5', input: 7, output: 3, id: 'x1', requestId: 'rx' }),
    ]);
    const [s2] = await getSessionList(tmp);
    const after = getParseStats();

    expect(after.fullParses).toBe(before.fullParses + 1); // re-parsed from byte 0
    expect(after.incrementalParses).toBe(before.incrementalParses); // not treated as a growth
    expect(s2.inputTokens).toBe(7);
    expect(s2.messageCount).toBe(1);
  });

  it('does not re-read a large transcript on an unchanged refetch (perf)', async () => {
    resetParseCache();
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(assistantLine({ model: 'claude-sonnet-4-5', input: 10, output: 5, id: `m${i}`, requestId: `r${i}` }));
    }
    writeSession(tmp, 'big.jsonl', lines);

    const t0 = performance.now();
    const [cold] = await getSessionList(tmp);
    const coldMs = performance.now() - t0;
    expect(cold.messageCount).toBe(5000);
    expect(getParseStats().fileReads).toBe(1);

    const t1 = performance.now();
    const [warm] = await getSessionList(tmp);
    const warmMs = performance.now() - t1;
    const stats = getParseStats();

    expect(stats.fileReads).toBe(1); // hard proof: no second read of 5000 lines
    expect(stats.cacheHits).toBe(1);
    expect(warm.messageCount).toBe(5000);
    expect(warmMs).toBeLessThan(coldMs); // the cache hit is strictly cheaper
    console.log(
      `[perf] cold parse ${coldMs.toFixed(2)}ms → warm refetch ${warmMs.toFixed(2)}ms ` +
        `(${(coldMs / Math.max(warmMs, 0.001)).toFixed(0)}x faster)`
    );
  });
});
