// One run of the Notes AI: find the session's transcript, digest it, check what
// the input would cost, ask the model one tool-less turn through the Agent SDK,
// and turn the answer into note lines. The renderer sends a session id and an
// action, nothing else; model, effort, length, language and prompts come from
// the prefs here.
//
// `persistSession: false` and `settingSources: []` are load-bearing: without the
// first a run is written under ~/.claude/projects and lists as a session; without
// the second it loads the project's CLAUDE.md, hooks and settings. `tools: []`
// covers the built-in tools only, so MCP servers are shut out separately.
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import {
  AI_LENGTHS,
  AI_MODELS,
  INSIGHT_KINDS,
  modelLabel,
  type AiEffort,
  type AiModelPrice,
  type AiSettings,
  type InsightKind,
  type InsightResult,
} from '../shared/ai-settings';
import { SYSTEM_PROMPT, buildInsightPrompt, sanitizeInsightOutput } from './ai-insight-prompt';
import { costOfUsage } from './cost-tracker';
import { readTextFile } from './safe-fs';
import { digestTranscriptText } from './session-digest';

export const COST_CAP_USD = 1;
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export interface InsightQueryOptions {
  model: string;
  effort: AiEffort;
  tools: string[];
  maxTurns: number;
  persistSession: boolean;
  settingSources: never[];
  mcpServers: Record<string, never>;
  strictMcpConfig: boolean;
  systemPrompt: string;
  abortController: AbortController;
  env: NodeJS.ProcessEnv;
  pathToClaudeCodeExecutable?: string;
}

/** What a run needs from the outside, injected so tests make no model call. */
export interface InsightDeps {
  query: (args: { prompt: string; options: InsightQueryOptions }) => AsyncIterable<unknown>;
  projectsDir: string;
  readSettings: () => AiSettings;
  env: NodeJS.ProcessEnv;
  executable: () => { pathToClaudeCodeExecutable?: string };
}

interface SdkResult {
  type: 'result';
  subtype: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
}

const inFlight = new Map<string, AbortController>();

export function resetInsights(): void {
  for (const controller of inFlight.values()) controller.abort();
  inFlight.clear();
}

export function cancelInsight(sessionId: unknown): void {
  if (typeof sessionId === 'string') inFlight.get(sessionId)?.abort();
}

export function parseInsightRequest(
  sessionId: unknown,
  kind: unknown
): { sessionId: string; kind: InsightKind } {
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
    throw new Error('Not a session id');
  }
  if (!(INSIGHT_KINDS as readonly unknown[]).includes(kind)) throw new Error('Unknown action');
  return { sessionId, kind: kind as InsightKind };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** By file name, one project level deep: `sessions/` first, as Claude Code's
 *  newer layout puts it there, then the project root. Never recursive, so a
 *  sub-agent sidecar with the same name is not a match. `null` when no project
 *  has it yet. */
export async function findSessionTranscript(
  projectsDir: string,
  sessionId: string
): Promise<string | null> {
  const file = `${sessionId}.jsonl`;
  const hits: string[] = [];
  for (const entry of await readdir(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(projectsDir, entry.name);
    for (const candidate of [join(dir, 'sessions', file), join(dir, file)]) {
      if (await isFile(candidate)) {
        hits.push(candidate);
        break;
      }
    }
  }
  if (hits.length === 0) return null;
  if (hits.length > 1) throw new Error('More than one transcript has this session id.');
  return hits[0];
}

function inputCost(tokens: number, model: string): number {
  return costOfUsage(
    { inputTokens: tokens, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
    model
  );
}

async function firstResult(messages: AsyncIterable<unknown>): Promise<SdkResult> {
  for await (const msg of messages) {
    if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'result') {
      return msg as SdkResult;
    }
  }
  throw new Error('The run ended without an answer.');
}

function resultError(r: SdkResult): string | null {
  if (r.subtype !== 'success') return r.errors?.join('; ') || `The run stopped: ${r.subtype}`;
  return r.is_error ? r.result || 'The model answered with an error.' : null;
}

async function ask(
  kind: InsightKind,
  sessionId: string,
  deps: InsightDeps,
  abort: AbortController
) {
  const settings = deps.readSettings();
  if (!settings.enabled) throw new Error('AI is turned off in Settings → AI.');
  // The registry publishes a new session before Claude Code writes its file.
  const file = await findSessionTranscript(deps.projectsDir, sessionId);
  const digest = file ? digestTranscriptText(await readTextFile(file)) : null;
  if (!digest || digest.turns === 0) throw new Error('This session has nothing to read yet.');
  if (inputCost(digest.estimatedTokens, settings.model) > COST_CAP_USD) {
    throw new Error(
      `This session is too large for ${modelLabel(settings.model)} under the $${COST_CAP_USD} cap. Switch to Haiku 5.5 in Settings → AI.`
    );
  }
  if (abort.signal.aborted) throw new Error('Cancelled.');
  const r = await firstResult(
    deps.query({
      prompt: buildInsightPrompt(kind, settings, digest.text),
      options: {
        model: settings.model,
        effort: settings.effort,
        tools: [],
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
        systemPrompt: SYSTEM_PROMPT,
        abortController: abort,
        env: deps.env,
        ...deps.executable(),
      },
    })
  );
  return { settings, digest, r };
}

export async function runInsight(
  sessionIdIn: unknown,
  kindIn: unknown,
  deps: InsightDeps
): Promise<InsightResult> {
  const { sessionId, kind } = parseInsightRequest(sessionIdIn, kindIn);
  if (inFlight.has(sessionId)) throw new Error('A run is already going for this session.');
  const abort = new AbortController();
  inFlight.set(sessionId, abort);
  try {
    const { settings, digest, r } = await ask(kind, sessionId, deps, abort);
    const error = resultError(r);
    if (error) throw new Error(error);
    const u = r.usage ?? {};
    return {
      lines: sanitizeInsightOutput(kind, r.result ?? '', AI_LENGTHS[settings.length]),
      truncated: digest.truncated,
      model: settings.model,
      inputTokens:
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : 0,
    };
  } catch (e) {
    if (abort.signal.aborted) throw new Error('Cancelled.', { cause: e });
    throw e;
  } finally {
    if (inFlight.get(sessionId) === abort) inFlight.delete(sessionId);
  }
}

/** Each model's base rate, per million tokens. Priced on 1,000 tokens and scaled,
 *  so the long-prompt surcharge (above 100K on Haiku 5.5) stays out of the figure. */
export function aiModelPrices(): AiModelPrice[] {
  const per = (inputTokens: number, outputTokens: number, model: string) =>
    Math.round(
      costOfUsage({ inputTokens, outputTokens, cacheWriteTokens: 0, cacheReadTokens: 0 }, model) *
        1000 *
        1e6
    ) / 1e6;
  return AI_MODELS.map(m => ({
    id: m.id,
    label: m.label,
    inputPerM: per(1000, 0, m.id),
    outputPerM: per(0, 1000, m.id),
  }));
}

export const sdkQuery: InsightDeps['query'] = async function* (args) {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  yield* sdk.query(args);
};
