import { stat, open } from 'fs/promises';
import { join, basename, dirname, resolve, sep } from 'path';
import { glob } from 'glob';
import { stripFramingTags } from '../utils';
import { listProjectSessionFiles } from './session-files';

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ProjectCost {
  project: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  sessionsCount: number;
}

export interface SessionSummary {
  filename: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
  cacheSavings: number; // $ risparmiati dai cache read vs. prezzo input pieno
  messageCount: number;
  model?: string; // modello dominante (retrocompatibilità)
  models: Record<string, number>; // conteggio messaggi per modello
  customTitle?: string;
  aiTitle?: string;
  firstUserMessage?: string;
  template?: string;
}

// ─── Pricing table (prezzi per milione di token) ──────────────────────────────
// Source: the official pricing page, https://docs.claude.com/en/docs/about-claude/pricing
// IMPORTANT: when updating the PRICING table below, bump PRICING_LAST_UPDATED so
// the cost UI can show users how current these estimates are.
//
// `cacheWrite` is the **5-minute** cache write rate (1.25x base input). The 1-hour
// rate (2x) is deliberately not modelled: a transcript records a single
// `cache_creation_input_tokens` figure and does not say which TTL produced it,
// so picking the shorter — and far more common — one is the honest default.
export const PRICING_LAST_UPDATED = '2026-08-08';

interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Haiku 3.5 — retired except on Bedrock / Google Cloud
  'claude-3-5-haiku': { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
  // Haiku 4.5 — NOT the same as Haiku 3.5, which is what this used to charge
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  // Sonnet 3.5 — no longer listed on the pricing page; kept for old transcripts
  'claude-3-5-sonnet': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-3-5-sonnet-20240620': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  // Sonnet 4.x  (Sonnet 5 is scheduled — see SCHEDULED below)
  'claude-sonnet-4': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  // Opus 4 / 4.1 — retired, and the only Opus models still on the old rates
  'claude-opus-4': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4-1': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  // Opus 4.5 onwards — a 3x price cut this table used to miss entirely, charging
  // every one of these at the retired Opus 4 rate.
  'claude-opus-4-5': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-5': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  // Fable 5 / Mythos 5 — neither id contains a known family word, so both used to
  // land on the conservative Sonnet default at a third of their real price.
  'claude-fable-5': { input: 10.0, output: 50.0, cacheWrite: 12.5, cacheRead: 1.0 },
  'claude-mythos-5': { input: 10.0, output: 50.0, cacheWrite: 12.5, cacheRead: 1.0 },
};

/** A published rate that changes on a date. `from` is the first day (UTC,
 *  inclusive) the prices apply; entries are ordered newest first. */
interface PriceSchedule {
  from: string;
  prices: ModelPricing;
}

// Sonnet 5 launched on introductory pricing that expires. A single static rate
// would misprice one side of the cutover, and this app reconstructs HISTORICAL
// cost — so each session is priced at the rate in force when it ran.
const SCHEDULED: Record<string, PriceSchedule[]> = {
  'claude-sonnet-5': [
    { from: '2026-09-01', prices: { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 } },
    // Introductory pricing, in effect through 2026-08-31.
    { from: '0000-01-01', prices: { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 } },
  ],
};

/** `claude-sonnet-4-5-20250929` → `claude-sonnet-4-5`. Claude Code records
 *  resolved model ids that often carry a release date the table does not
 *  enumerate; without this they all fell through to the fuzzy family match. */
function withoutDateSuffix(model: string): string {
  return model.replace(/-\d{8}$/, '');
}

/** The day used to resolve a scheduled rate: the session's own timestamp, or
 *  today when it is missing (`date` can legitimately be ''). */
function pricingDay(at: string | undefined): string {
  const day = at?.slice(0, 10) ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date().toISOString().slice(0, 10);
}

function scheduledPricing(key: string, at: string | undefined): ModelPricing | undefined {
  const schedule = SCHEDULED[key];
  if (!schedule) return undefined;
  const day = pricingDay(at);
  return (schedule.find(entry => entry.from <= day) ?? schedule[schedule.length - 1]).prices;
}

/**
 * Prices for a model, at the time `at` (ISO timestamp of the session).
 *
 * Exact id → date-stripped id → fuzzy family match → conservative Sonnet default.
 * The fuzzy anchors point at the CURRENT generation of each family: anchoring
 * `opus` on a retired model is what made every unlisted Opus cost 3x too much.
 */
function getPricing(model: string | undefined, at?: string): ModelPricing {
  if (!model) return PRICING['claude-sonnet-4-6'];

  for (const key of [model, withoutDateSuffix(model)]) {
    const scheduled = scheduledPricing(key, at);
    if (scheduled) return scheduled;
    if (PRICING[key]) return PRICING[key];
  }

  const m = model.toLowerCase();
  if (m.includes('haiku')) return PRICING['claude-haiku-4-5'];
  if (m.includes('opus')) return PRICING['claude-opus-5'];
  if (m.includes('fable')) return PRICING['claude-fable-5'];
  if (m.includes('mythos')) return PRICING['claude-mythos-5'];
  if (m.includes('sonnet')) return PRICING['claude-sonnet-4-6'];

  // Default conservativo: Sonnet
  return PRICING['claude-sonnet-4-6'];
}

export interface PricingMeta {
  /** ISO date (YYYY-MM-DD) the PRICING table was last verified. */
  lastUpdated: string;
  /** Model IDs with an exact entry in the table (everything else is estimated). */
  knownModels: string[];
}

/** Metadata for the cost UI: how current the table is and which models it prices exactly. */
export function getPricingMeta(): PricingMeta {
  return {
    lastUpdated: PRICING_LAST_UPDATED,
    knownModels: [...Object.keys(PRICING), ...Object.keys(SCHEDULED)].sort(),
  };
}

/**
 * True only when the model has an exact pricing entry (flat or scheduled).
 * Models priced via the fuzzy family fallback (or the conservative Sonnet
 * default) return false, so the UI can flag their cost figures as estimates.
 *
 * Deliberately exact on the id as written, with no date-suffix normalization:
 * `getPricing` does normalize, so the worst this can do is call an exactly
 * priced model an estimate — an honest understatement, never the reverse.
 */
export function isModelPriced(model: string | undefined): boolean {
  return !!model && (model in PRICING || model in SCHEDULED);
}

/** `at`: ISO timestamp of the session, so a model whose published rate changed
 *  is billed at the rate in force when it ran. */
function calculateCost(
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  model: string | undefined,
  at?: string
): number {
  const p = getPricing(model, at);
  return (
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    (cacheWriteTokens / 1_000_000) * p.cacheWrite +
    (cacheReadTokens / 1_000_000) * p.cacheRead
  );
}

/**
 * Dollars for one turn's usage, at the rate its model had when it ran.
 *
 * Exported for the **Monitor's tail** (`session-tails.ts`), which prices each
 * assistant line as it appends: a live session's spend cannot come from
 * `calculateCostSummary`, whose unit is a whole project. Same pricing table and
 * the same `at` resolution as every other figure in the app, so the Monitor and
 * the project views can never quote two different prices for one turn.
 */
export function costOfUsage(
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  },
  model: string | undefined,
  at?: string
): number {
  return calculateCost(
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheWriteTokens,
    usage.cacheReadTokens,
    model,
    at
  );
}

/**
 * What one transcript has spent so far, and on how many tokens.
 *
 * The Monitor's tail starts at EOF — it reports what happens from now on — so a
 * session that was already running when ClaudeLens opened would report the cost
 * of the last few turns as if it were the session's total. A money figure that
 * is silently partial is worse than none, so the cursor seeds itself from here
 * once, and the tail keeps it current afterwards.
 *
 * Cheap because it is the same cached `parseSession` the project views use: an
 * unchanged transcript costs one `stat`, a grown one only its tail.
 */
export async function readSessionSpend(
  filePath: string
): Promise<{ costUsd: number; tokens: number; model: string | undefined }> {
  const parsed = await parseSession(filePath);
  return {
    costUsd: costOfUsage(parsed, parsed.model, parsed.date),
    tokens:
      parsed.inputTokens + parsed.outputTokens + parsed.cacheWriteTokens + parsed.cacheReadTokens,
    model: parsed.model,
  };
}

/**
 * Dollars saved by reading from the prompt cache instead of paying the full input
 * rate for those tokens. Cache reads bill at ~10% of input, so this is the avoided
 * delta (`input − cacheRead`) — what the session would have cost extra with no cache.
 */
export function calculateCacheSavings(
  cacheReadTokens: number,
  model: string | undefined,
  at?: string
): number {
  const p = getPricing(model, at);
  return (cacheReadTokens / 1_000_000) * (p.input - p.cacheRead);
}

// ─── JSONL parsing ────────────────────────────────────────────────────────────

interface ParsedSession {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  messageCount: number;
  date: string;
  model: string | undefined; // modello dominante
  models: Record<string, number>;
  customTitle?: string;
  aiTitle?: string;
  firstUserMessage?: string;
  template?: string;
}

interface LineData {
  date: string;
  customTitle: string | undefined;
  aiTitle: string | undefined;
  firstUserMessage: string | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  model: string | undefined;
  // Stable identity of the message-level usage, used to dedup repeated lines.
  usageKey: string | undefined;
}

function extractFirstUserText(json: Record<string, unknown>): string | undefined {
  if (json.type !== 'user') return undefined;
  if (json.isMeta === true || json.isSidechain === true) return undefined;
  const msg = json.message as Record<string, unknown> | undefined;
  if (!msg) return undefined;
  const raw = msg.content;

  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else if (Array.isArray(raw)) {
    // A user turn carrying a tool_result is the system's reply to a tool call,
    // not text the user typed — never treat it as the "first user message".
    // session-reader absorbs these into the preceding assistant turn the same way.
    if (
      raw.some(
        b =>
          b !== null &&
          typeof b === 'object' &&
          (b as Record<string, unknown>).type === 'tool_result'
      )
    ) {
      return undefined;
    }
    for (const block of raw) {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          text = b.text;
          break;
        }
      }
    }
  }

  // Salta messaggi tecnici (caveat, comandi, tool_result) rimuovendo solo i tag
  // di framing noti, così prosa con `<`/`>` da codice resta intatta (#93).
  const stripped = stripFramingTags(text).trim();
  if (!stripped) return undefined;
  if (stripped.startsWith('Caveat:') || stripped.startsWith('[Request interrupted'))
    return undefined;
  return stripped;
}

// Extracts the relevant fields from an already-parsed JSONL object. Returns null
// for well-formed lines that carry nothing we track (kept separate from JSON
// parse failures, which the caller counts and logs).
function extractLineData(json: any): LineData | null {
  // Guard against malformed timestamps: `new Date('not-a-date').toISOString()`
  // throws RangeError, which (called outside the per-line JSON.parse try) would
  // abort the whole file and under-count every later line (issue #88).
  const d = json.timestamp ? new Date(json.timestamp) : null;
  const date = d && !isNaN(d.getTime()) ? d.toISOString() : '';
  const customTitle =
    json.type === 'custom-title' ? (json.customTitle as string | undefined) : undefined;
  const aiTitle = json.type === 'ai-title' ? (json.aiTitle as string | undefined) : undefined;
  const firstUserMessage = extractFirstUserText(json as Record<string, unknown>);
  const usage = json.message?.usage;
  if (!usage && !date && !customTitle && !aiTitle && !firstUserMessage) return null;

  const model: string | undefined = json.message?.model;
  // Claude Code writes one JSONL line per content block of an assistant turn
  // (text + tool_use, …) and each repeats the same message-level usage, tagged
  // with the same message.id / requestId. Build a stable key so the caller can
  // count each unique turn once instead of inflating tokens/cost (issue #56).
  const messageId: string | undefined = json.message?.id;
  const requestId: string | undefined = json.requestId;
  const usageKey =
    usage && (messageId || requestId) ? `${messageId ?? ''}:${requestId ?? ''}` : undefined;
  // Coerce each usage field through a numeric guard: a non-numeric value (e.g. a
  // string) would pass the `?? 0` nullish check and then poison the running
  // total via string concatenation. Keep a bad field at 0 instead.
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    date,
    customTitle,
    aiTitle,
    firstUserMessage,
    inputTokens: num(usage?.input_tokens),
    outputTokens: num(usage?.output_tokens),
    cacheWriteTokens: num(usage?.cache_creation_input_tokens),
    cacheReadTokens: num(usage?.cache_read_input_tokens),
    model: model && model !== '<synthetic>' ? model : undefined,
    usageKey,
  };
}

// Running accumulator for one session: the parsed totals plus the bookkeeping
// (`seenUsage`, `modelCounts`, the trailing incomplete line) needed to keep
// parsing *incrementally* as the transcript grows, without re-reading from byte 0.
interface SessionAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  messageCount: number;
  date: string;
  modelCounts: Record<string, number>;
  customTitle?: string;
  aiTitle?: string;
  firstUserMessage?: string;
  dropped: number;
  // Usage identities already counted, so a repeated content-block line for the
  // same turn isn't double-counted (issue #56) — carried across increments.
  seenUsage: Set<string>;
}

// Cached parse state per transcript file. JSONL transcripts are append-only, so
// an unchanged file (same mtime+size) is served from `acc` with no I/O, and a
// grown file is read only from `consumed` onward — the dominant win when the
// watcher invalidates the session list on every append of the *active* session.
interface ParseCacheEntry {
  consumed: number; // bytes already folded into `acc`
  mtimeMs: number;
  // Bytes after the last newline not yet terminated (a half-written final line);
  // a Buffer, not a string, so a multi-byte UTF-8 char split across a read
  // boundary is never decoded mid-sequence (newline 0x0A can't occur inside one).
  partial: Buffer;
  acc: SessionAccumulator;
}

// Grouped by containing directory (dir → transcript path → entry) rather than a
// flat path→entry map, so a scan can drop the entries of files that disappeared
// in O(files in that dir) instead of walking the whole cache — see `retainSessions`.
// Directory keys go through `resolve()` because they are compared against paths
// built with `join()`, and glob returns POSIX separators even on Windows.
const parseCache = new Map<string, Map<string, ParseCacheEntry>>();

// Observability for tests/diagnostics: lets a test prove an unchanged file is a
// cache hit (no read), a grown file is read incrementally (not from scratch), and
// a vanished transcript stops being cached (`cachedFiles` / `evictions`).
const parseStats = {
  cacheHits: 0,
  fullParses: 0,
  incrementalParses: 0,
  fileReads: 0,
  evictions: 0,
};

export function getParseStats() {
  let cachedFiles = 0;
  for (const byFile of parseCache.values()) cachedFiles += byFile.size;
  return { ...parseStats, cachedFiles };
}

export function resetParseCache() {
  parseCache.clear();
  parseStats.cacheHits = 0;
  parseStats.fullParses = 0;
  parseStats.incrementalParses = 0;
  parseStats.fileReads = 0;
  parseStats.evictions = 0;
}

function dirKey(path: string): string {
  return resolve(dirname(path));
}

function cacheGet(filePath: string): ParseCacheEntry | undefined {
  return parseCache.get(dirKey(filePath))?.get(filePath);
}

function cacheSet(filePath: string, entry: ParseCacheEntry): void {
  const key = dirKey(filePath);
  const byFile = parseCache.get(key);
  if (byFile) byFile.set(filePath, entry);
  else parseCache.set(key, new Map([[filePath, entry]]));
}

function cacheDelete(filePath: string): void {
  const key = dirKey(filePath);
  const byFile = parseCache.get(key);
  if (!byFile) return;
  if (byFile.delete(filePath)) parseStats.evictions++;
  if (byFile.size === 0) parseCache.delete(key);
}

// Drop the cached parses of transcripts that are no longer in `dir`. `live` comes
// from the glob every scan already runs, which IS the complete set of transcripts
// in that directory — so anything cached under it and missing from the list is
// provably gone (session deleted in-app, project merged elsewhere, or Claude
// Code's `cleanupPeriodDays` retention). Without this the entry survives for the
// life of the process: `parseSession` only evicts a path someone asks for again,
// and nobody ever asks for a deleted transcript. That matters because an entry
// holds its `seenUsage` set — one string per assistant turn of the transcript.
function retainSessions(dir: string, live: string[]): void {
  const key = resolve(dir);
  const byFile = parseCache.get(key);
  if (!byFile) return;
  const keep = new Set(live);
  for (const path of byFile.keys()) {
    if (!keep.has(path)) {
      byFile.delete(path);
      parseStats.evictions++;
    }
  }
  if (byFile.size === 0) parseCache.delete(key);
}

// Per-directory pruning never fires for a project directory that vanished whole
// (deleted or merged away): nothing scans it again. The project-dir glob in
// `calculateCostSummary` is the live set at that level, so drop every cached
// directory that isn't one of them (or its `sessions/` subdir). Scoped to `root`
// so summarizing one projects dir can never evict entries cached under another.
function retainProjects(root: string, liveProjectDirs: string[]): void {
  const keep = new Set<string>();
  for (const dir of liveProjectDirs) {
    keep.add(resolve(dir));
    keep.add(resolve(join(dir, 'sessions')));
  }
  const prefix = resolve(root) + sep;
  for (const [key, byFile] of parseCache) {
    if (keep.has(key) || !key.startsWith(prefix)) continue;
    parseStats.evictions += byFile.size;
    parseCache.delete(key);
  }
}

function newAccumulator(): SessionAccumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    messageCount: 0,
    date: '',
    modelCounts: {},
    dropped: 0,
    seenUsage: new Set(),
  };
}

// Fold a single complete JSONL line into the accumulator (mutates `acc`). Mirrors
// the per-line logic of the old synchronous parser, line-for-line.
function foldLine(line: string, acc: SessionAccumulator): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let json: any;
  try {
    json = JSON.parse(trimmed);
  } catch {
    acc.dropped++;
    return;
  }
  const parsed = extractLineData(json);
  if (!parsed) return;

  if (parsed.customTitle) acc.customTitle = parsed.customTitle;
  if (parsed.aiTitle) acc.aiTitle = parsed.aiTitle;
  if (!acc.firstUserMessage && parsed.firstUserMessage)
    acc.firstUserMessage = parsed.firstUserMessage;
  if (parsed.date) acc.date = parsed.date;

  if (
    parsed.inputTokens ||
    parsed.outputTokens ||
    parsed.cacheWriteTokens ||
    parsed.cacheReadTokens
  ) {
    if (parsed.usageKey) {
      if (acc.seenUsage.has(parsed.usageKey)) return;
      acc.seenUsage.add(parsed.usageKey);
    }
    acc.messageCount++;
    if (parsed.model) acc.modelCounts[parsed.model] = (acc.modelCounts[parsed.model] ?? 0) + 1;
    acc.inputTokens += parsed.inputTokens;
    acc.outputTokens += parsed.outputTokens;
    acc.cacheWriteTokens += parsed.cacheWriteTokens;
    acc.cacheReadTokens += parsed.cacheReadTokens;
  }
}

// Project the running accumulator into the immutable ParsedSession the callers
// consume. `models` is copied so a later incremental fold can't mutate a result
// already handed out.
function finalize(acc: SessionAccumulator, mtimeMs: number): ParsedSession {
  const entries = Object.entries(acc.modelCounts);
  return {
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheWriteTokens: acc.cacheWriteTokens,
    cacheReadTokens: acc.cacheReadTokens,
    messageCount: acc.messageCount,
    date: acc.date || new Date(mtimeMs).toISOString(),
    model: entries.length > 0 ? entries.sort((a, b) => b[1] - a[1])[0][0] : undefined,
    models: { ...acc.modelCounts },
    customTitle: acc.customTitle,
    aiTitle: acc.aiTitle,
    firstUserMessage: acc.firstUserMessage,
  };
}

// Parse a session transcript, reusing cached work. Three paths:
//   • unchanged (mtime+size match)  → serve `acc`, zero I/O      (cacheHits)
//   • grown (append-only)           → read & fold only the tail  (incrementalParses)
//   • new / truncated / replaced    → read & fold from byte 0     (fullParses)
// Assumes append-only writes (Claude Code never rewrites a transcript's prefix);
// any size shrink or same-size-different-mtime falls back to a full re-parse.
async function parseSession(filePath: string): Promise<ParsedSession> {
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(filePath);
  } catch {
    cacheDelete(filePath);
    return finalize(newAccumulator(), Date.now());
  }
  if (!st.isFile()) {
    cacheDelete(filePath);
    return finalize(newAccumulator(), st.mtimeMs);
  }

  const cached = cacheGet(filePath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.consumed === st.size) {
    parseStats.cacheHits++;
    return finalize(cached.acc, st.mtimeMs);
  }

  const incremental = !!cached && st.size > cached.consumed;
  const entry: ParseCacheEntry = incremental
    ? cached!
    : { consumed: 0, mtimeMs: st.mtimeMs, partial: Buffer.alloc(0), acc: newAccumulator() };
  if (incremental) parseStats.incrementalParses++;
  else parseStats.fullParses++;

  const droppedBefore = entry.acc.dropped;
  const len = st.size - entry.consumed;
  let chunk = Buffer.alloc(0);
  if (len > 0) {
    try {
      const fh = await open(filePath, 'r');
      try {
        const buf = Buffer.allocUnsafe(len);
        const { bytesRead } = await fh.read(buf, 0, len, entry.consumed);
        chunk = buf.subarray(0, bytesRead);
        parseStats.fileReads++;
      } finally {
        await fh.close();
      }
    } catch (error) {
      console.error(`Errore leggendo JSONL da ${filePath}: ${error}`);
      return finalize(entry.acc, st.mtimeMs);
    }
  }

  // Fold every newline-terminated line; keep the trailing remainder (a partial
  // final line) buffered for the next increment. Splitting on the newline *byte*
  // is UTF-8-safe (0x0A never appears inside a multi-byte sequence).
  const combined = Buffer.concat([entry.partial, chunk]);
  let start = 0;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i] === 0x0a) {
      foldLine(combined.toString('utf-8', start, i), entry.acc);
      start = i + 1;
    }
  }

  entry.partial = combined.subarray(start);
  entry.consumed += chunk.length;
  entry.mtimeMs = st.mtimeMs;
  cacheSet(filePath, entry);

  const newlyDropped = entry.acc.dropped - droppedBefore;
  if (newlyDropped > 0) {
    console.warn(`[cost-tracker] skipped ${newlyDropped} malformed JSONL line(s) in ${filePath}`);
  }

  return finalize(entry.acc, st.mtimeMs);
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Map with bounded concurrency: parses sessions in parallel (the I/O win) while
// capping open file descriptors, so a project with hundreds of transcripts can't
// hit EMFILE on the cold pass. Order is preserved.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const PARSE_CONCURRENCY = 8;

// Enumerate a project's transcripts. Doubles as the pruning point for the parse
// cache: each glob is the live set of its directory, so `retainSessions` can drop
// what has since been deleted. Both candidate directories are pruned — a project
// whose `sessions/` was emptied falls through to the root glob, and its stale
// `sessions/` entries would otherwise never be revisited.
async function findSessionFiles(projectPath: string): Promise<string[]> {
  return listProjectSessionFiles(projectPath, retainSessions);
}

interface ProjectAggregate {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
  sessionCount: number;
}

// Aggrega token e costo di un progetto usando la pricing table per-modello
// (modello dominante + cache token), così summary e per-progetto coincidono.
async function aggregateProject(projectPath: string): Promise<ProjectAggregate> {
  const files = await findSessionFiles(projectPath);
  let inputTokens = 0,
    outputTokens = 0,
    cacheWriteTokens = 0,
    cacheReadTokens = 0;
  let cost = 0;

  const parsed = await mapLimit(files, PARSE_CONCURRENCY, f => parseSession(f));
  for (const s of parsed) {
    inputTokens += s.inputTokens;
    outputTokens += s.outputTokens;
    cacheWriteTokens += s.cacheWriteTokens;
    cacheReadTokens += s.cacheReadTokens;
    // Price each session at its OWN dominant model and sum the dollar costs.
    // Summing tokens across the whole project and applying a single rate (the
    // file-count-dominant model) mispriced any project mixing Opus/Sonnet/Haiku
    // — e.g. many small Haiku subagent files would force a huge Opus session to
    // Haiku rates, or vice versa. Per-session pricing keeps the project rollup
    // consistent with the per-session list (getSessionList).
    cost += calculateCost(
      s.inputTokens,
      s.outputTokens,
      s.cacheWriteTokens,
      s.cacheReadTokens,
      s.model,
      s.date
    );
  }

  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens,
    cost,
    sessionCount: files.length,
  };
}

export async function getProjectUsage(
  projectPath: string
): Promise<{ usage: UsageData; sessionCount: number; cost: number }> {
  const a = await aggregateProject(projectPath);
  return {
    usage: { inputTokens: a.inputTokens, outputTokens: a.outputTokens, totalTokens: a.totalTokens },
    sessionCount: a.sessionCount,
    cost: a.cost,
  };
}

export async function calculateCostSummary(claudeDir: string): Promise<ProjectCost[]> {
  try {
    const projectDirs = await glob('[!.]*', { cwd: claudeDir, absolute: true });
    // Whole-project pruning: a project deleted or merged away is never scanned
    // again, so per-directory pruning can't reach its cached transcripts.
    retainProjects(claudeDir, projectDirs);
    const costs: ProjectCost[] = [];

    for (const projectPath of projectDirs) {
      try {
        const a = await aggregateProject(projectPath);
        if (a.totalTokens === 0) continue;

        costs.push({
          project: basename(projectPath) || 'unknown',
          inputTokens: a.inputTokens,
          outputTokens: a.outputTokens,
          totalTokens: a.totalTokens,
          cost: a.cost,
          sessionsCount: a.sessionCount,
        });
      } catch {
        // progetto non leggibile
      }
    }

    return costs.sort((a, b) => b.cost - a.cost);
  } catch (error) {
    console.error(`Errore calcolando i costi: ${error}`);
    return [];
  }
}

export async function getSessionList(projectPath: string): Promise<SessionSummary[]> {
  const files = await findSessionFiles(projectPath);

  const parsed = await mapLimit(
    files,
    PARSE_CONCURRENCY,
    async (filePath): Promise<SessionSummary | null> => {
      try {
        const s = await parseSession(filePath);
        const totalTokens = s.inputTokens + s.outputTokens;
        const estimatedCost = calculateCost(
          s.inputTokens,
          s.outputTokens,
          s.cacheWriteTokens,
          s.cacheReadTokens,
          s.model,
          s.date
        );

        return {
          filename: basename(filePath),
          date: s.date,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
          cacheWriteTokens: s.cacheWriteTokens,
          cacheReadTokens: s.cacheReadTokens,
          totalTokens,
          estimatedCost,
          cacheSavings: calculateCacheSavings(s.cacheReadTokens, s.model, s.date),
          messageCount: s.messageCount,
          model: s.model,
          models: s.models,
          customTitle: s.customTitle,
          aiTitle: s.aiTitle,
          firstUserMessage: s.firstUserMessage,
          template: s.template,
        };
      } catch {
        // sessione non leggibile
        return null;
      }
    }
  );

  return (
    parsed
      .filter((s): s is SessionSummary => s !== null)
      // NaN-safe: an empty/invalid `date` makes `new Date(x).getTime()` NaN and the
      // comparator NaN → arbitrary order. Treat an unparseable date as oldest.
      .sort((a, b) => {
        const tb = new Date(b.date).getTime();
        const ta = new Date(a.date).getTime();
        return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
      })
  );
}
