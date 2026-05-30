import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getProjectUsage,
  calculateCostSummary,
  getSessionList,
  getPricingMeta,
  isModelPriced,
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
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: opts.timestamp ?? '2026-05-01T10:00:00.000Z',
    message: {
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

describe('dominant-model selection drives project cost', () => {
  it('prices aggregate tokens using the most frequent model in the file set', async () => {
    // 2 opus sessions vs 1 haiku session -> dominant = opus
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
    // all input tokens priced at Opus rate because Opus is dominant
    expect(cost).toBeCloseTo(expectedCost(PRICE.opus, { input: 1_000_020, output: 0 }), 8);
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
