import { existsSync } from 'fs';
import { stat, open } from 'fs/promises';
import { join, basename } from 'path';
import { glob } from 'glob';
import { stripFramingTags } from '../utils';

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
  cacheSavings: number;    // $ risparmiati dai cache read vs. prezzo input pieno
  messageCount: number;
  model?: string;          // modello dominante (retrocompatibilità)
  models: Record<string, number>; // conteggio messaggi per modello
  customTitle?: string;
  aiTitle?: string;
  firstUserMessage?: string;
  template?: string;
}

// ─── Pricing table (prezzi per milione di token) ──────────────────────────────
// Fonte: Anthropic pricing page (https://www.anthropic.com/pricing).
// IMPORTANT: when updating the PRICING table below, bump PRICING_LAST_UPDATED so
// the cost UI can show users how current these estimates are.
export const PRICING_LAST_UPDATED = '2026-05-30';

interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Haiku 4.5
  'claude-haiku-4-5':             { input: 0.80, output: 4.00,  cacheWrite: 1.00,  cacheRead: 0.08 },
  'claude-haiku-4-5-20251001':    { input: 0.80, output: 4.00,  cacheWrite: 1.00,  cacheRead: 0.08 },
  // Haiku 3.5
  'claude-3-5-haiku':             { input: 0.80, output: 4.00,  cacheWrite: 1.00,  cacheRead: 0.08 },
  'claude-3-5-haiku-20241022':    { input: 0.80, output: 4.00,  cacheWrite: 1.00,  cacheRead: 0.08 },
  // Sonnet 4.x
  'claude-sonnet-4':              { input: 3.00, output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-sonnet-4-5':            { input: 3.00, output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-sonnet-4-6':            { input: 3.00, output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  // Sonnet 3.5
  'claude-3-5-sonnet':            { input: 3.00, output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-3-5-sonnet-20241022':   { input: 3.00, output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-3-5-sonnet-20240620':   { input: 3.00, output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  // Opus 4.x
  'claude-opus-4':                { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4-5':              { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4-6':              { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
};

// Fallback: normalizza l'ID modello per trovare una corrispondenza parziale
function getPricing(model: string | undefined): ModelPricing {
  if (!model) return PRICING['claude-sonnet-4-6'];
  if (PRICING[model]) return PRICING[model];

  const m = model.toLowerCase();
  if (m.includes('haiku'))  return PRICING['claude-haiku-4-5'];
  if (m.includes('opus'))   return PRICING['claude-opus-4-6'];
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
  return { lastUpdated: PRICING_LAST_UPDATED, knownModels: Object.keys(PRICING) };
}

/**
 * True only when the model has an exact pricing entry. Models priced via the
 * fuzzy family fallback (or the conservative Sonnet default) return false, so the
 * UI can flag their cost figures as estimates.
 */
export function isModelPriced(model: string | undefined): boolean {
  return !!model && model in PRICING;
}

function calculateCost(
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  model: string | undefined
): number {
  const p = getPricing(model);
  return (
    (inputTokens      / 1_000_000) * p.input      +
    (outputTokens     / 1_000_000) * p.output      +
    (cacheWriteTokens / 1_000_000) * p.cacheWrite  +
    (cacheReadTokens  / 1_000_000) * p.cacheRead
  );
}

/**
 * Dollars saved by reading from the prompt cache instead of paying the full input
 * rate for those tokens. Cache reads bill at ~10% of input, so this is the avoided
 * delta (`input − cacheRead`) — what the session would have cost extra with no cache.
 */
export function calculateCacheSavings(
  cacheReadTokens: number,
  model: string | undefined
): number {
  const p = getPricing(model);
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
  model: string | undefined;  // modello dominante
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
    if (raw.some(b => b !== null && typeof b === 'object' && (b as Record<string, unknown>).type === 'tool_result')) {
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
  if (stripped.startsWith('Caveat:') || stripped.startsWith('[Request interrupted')) return undefined;
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
  const customTitle = json.type === 'custom-title' ? (json.customTitle as string | undefined) : undefined;
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
  const usageKey = usage && (messageId || requestId)
    ? `${messageId ?? ''}:${requestId ?? ''}`
    : undefined;
  // Coerce each usage field through a numeric guard: a non-numeric value (e.g. a
  // string) would pass the `?? 0` nullish check and then poison the running
  // total via string concatenation. Keep a bad field at 0 instead.
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    date,
    customTitle,
    aiTitle,
    firstUserMessage,
    inputTokens:      num(usage?.input_tokens),
    outputTokens:     num(usage?.output_tokens),
    cacheWriteTokens: num(usage?.cache_creation_input_tokens),
    cacheReadTokens:  num(usage?.cache_read_input_tokens),
    model:            model && model !== '<synthetic>' ? model : undefined,
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
  consumed: number;   // bytes already folded into `acc`
  mtimeMs: number;
  // Bytes after the last newline not yet terminated (a half-written final line);
  // a Buffer, not a string, so a multi-byte UTF-8 char split across a read
  // boundary is never decoded mid-sequence (newline 0x0A can't occur inside one).
  partial: Buffer;
  acc: SessionAccumulator;
}

const parseCache = new Map<string, ParseCacheEntry>();

// Observability for tests/diagnostics: lets a test prove an unchanged file is a
// cache hit (no read) and a grown file is read incrementally (not from scratch).
const parseStats = { cacheHits: 0, fullParses: 0, incrementalParses: 0, fileReads: 0 };
export function getParseStats() {
  return { ...parseStats };
}
export function resetParseCache() {
  parseCache.clear();
  parseStats.cacheHits = 0;
  parseStats.fullParses = 0;
  parseStats.incrementalParses = 0;
  parseStats.fileReads = 0;
}

function newAccumulator(): SessionAccumulator {
  return {
    inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0,
    messageCount: 0, date: '', modelCounts: {}, dropped: 0, seenUsage: new Set(),
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
  if (!acc.firstUserMessage && parsed.firstUserMessage) acc.firstUserMessage = parsed.firstUserMessage;
  if (parsed.date) acc.date = parsed.date;

  if (parsed.inputTokens || parsed.outputTokens || parsed.cacheWriteTokens || parsed.cacheReadTokens) {
    if (parsed.usageKey) {
      if (acc.seenUsage.has(parsed.usageKey)) return;
      acc.seenUsage.add(parsed.usageKey);
    }
    acc.messageCount++;
    if (parsed.model) acc.modelCounts[parsed.model] = (acc.modelCounts[parsed.model] ?? 0) + 1;
    acc.inputTokens      += parsed.inputTokens;
    acc.outputTokens     += parsed.outputTokens;
    acc.cacheWriteTokens += parsed.cacheWriteTokens;
    acc.cacheReadTokens  += parsed.cacheReadTokens;
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
    parseCache.delete(filePath);
    return finalize(newAccumulator(), Date.now());
  }
  if (!st.isFile()) {
    parseCache.delete(filePath);
    return finalize(newAccumulator(), st.mtimeMs);
  }

  const cached = parseCache.get(filePath);
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
  parseCache.set(filePath, entry);

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
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

async function findSessionFiles(projectPath: string): Promise<string[]> {
  const sessionsDir = join(projectPath, 'sessions');
  if (existsSync(sessionsDir)) {
    const files = await glob('*.jsonl', { cwd: sessionsDir, absolute: true });
    if (files.length > 0) return files;
  }
  return glob('*.jsonl', { cwd: projectPath, absolute: true });
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
  let inputTokens = 0, outputTokens = 0, cacheWriteTokens = 0, cacheReadTokens = 0;
  let cost = 0;

  const parsed = await mapLimit(files, PARSE_CONCURRENCY, f => parseSession(f));
  for (const s of parsed) {
    inputTokens      += s.inputTokens;
    outputTokens     += s.outputTokens;
    cacheWriteTokens += s.cacheWriteTokens;
    cacheReadTokens  += s.cacheReadTokens;
    // Price each session at its OWN dominant model and sum the dollar costs.
    // Summing tokens across the whole project and applying a single rate (the
    // file-count-dominant model) mispriced any project mixing Opus/Sonnet/Haiku
    // — e.g. many small Haiku subagent files would force a huge Opus session to
    // Haiku rates, or vice versa. Per-session pricing keeps the project rollup
    // consistent with the per-session list (getSessionList).
    cost += calculateCost(s.inputTokens, s.outputTokens, s.cacheWriteTokens, s.cacheReadTokens, s.model);
  }

  return {
    inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens,
    totalTokens: inputTokens + outputTokens, cost, sessionCount: files.length,
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

  const parsed = await mapLimit(files, PARSE_CONCURRENCY, async (filePath): Promise<SessionSummary | null> => {
    try {
      const s = await parseSession(filePath);
      const totalTokens = s.inputTokens + s.outputTokens;
      const estimatedCost = calculateCost(
        s.inputTokens, s.outputTokens, s.cacheWriteTokens, s.cacheReadTokens, s.model
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
        cacheSavings: calculateCacheSavings(s.cacheReadTokens, s.model),
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
  });

  return parsed
    .filter((s): s is SessionSummary => s !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
