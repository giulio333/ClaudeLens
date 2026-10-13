/** ClaudeLens's AI settings (`cl-ai` in the prefs) and the rules both sides apply
 *  to them: the main validates them on every run, Settings on every read. A value
 *  outside its list falls back to its default instead of throwing, so a stale or
 *  hand-edited preferences file never breaks the panel. */

export type InsightKind = 'summary' | 'todos';
export const INSIGHT_KINDS: readonly InsightKind[] = ['summary', 'todos'];

export const AI_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['id'];

export const AI_EFFORTS = ['low', 'medium', 'high'] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

export type AiLength = 'brief' | 'standard' | 'detailed';
export const AI_LENGTHS: Record<AiLength, number> = { brief: 5, standard: 8, detailed: 15 };

export const AI_LANGUAGES = [
  'English',
  'Italian',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Japanese',
  'Chinese',
] as const;

export const MAX_PROMPT_CHARS = 2000;
export const MAX_LANGUAGE_CHARS = 40;
export const AI_SETTINGS_KEY = 'cl-ai';

// The language goes into the prompt, so it is a name and nothing else.
const LANGUAGE_RE = /^\p{L}[\p{L} -]*$/u;

export interface AiSettings {
  enabled: boolean;
  model: AiModel;
  effort: AiEffort;
  length: AiLength;
  /** `session` writes in the language the user writes in; otherwise a language name. */
  language: string;
  /** `null` is the default prompt. */
  prompts: Record<InsightKind, string | null>;
}

export const DEFAULT_PROMPTS: Record<InsightKind, string> = {
  summary:
    'Summarize this Claude Code session: what was asked, what was done, the decisions taken and the outcome.',
  todos:
    'List the actionable tasks raised in this Claude Code session, whether the user asked for them or Claude proposed them.',
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true,
  model: 'claude-haiku-5-5',
  effort: 'medium',
  length: 'standard',
  language: 'session',
  prompts: { summary: null, todos: null },
};

/** What a run answers: the note lines, and what it cost. */
export interface InsightResult {
  lines: string[];
  /** The digest dropped the start of a session too long for the cap. */
  truncated: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AiModelPrice {
  id: AiModel;
  label: string;
  /** Dollars per million tokens, at the base rate. */
  inputPerM: number;
  outputPerM: number;
}

export function modelLabel(id: string): string {
  return AI_MODELS.find(m => m.id === id)?.label ?? id;
}

export function validLanguage(v: unknown): v is string {
  if (v === 'session') return true;
  return typeof v === 'string' && v.length <= MAX_LANGUAGE_CHARS && LANGUAGE_RE.test(v);
}

function validPrompt(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' && v.length <= MAX_PROMPT_CHARS ? v : null;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function normalizeAiSettings(raw: unknown): AiSettings {
  const r = asRecord(raw);
  const prompts = asRecord(r.prompts);
  const d = DEFAULT_AI_SETTINGS;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    model: oneOf(
      r.model,
      AI_MODELS.map(m => m.id),
      d.model
    ),
    effort: oneOf(r.effort, AI_EFFORTS, d.effort),
    length: oneOf(r.length, Object.keys(AI_LENGTHS) as AiLength[], d.length),
    language: validLanguage(r.language) ? r.language : d.language,
    prompts: { summary: validPrompt(prompts.summary), todos: validPrompt(prompts.todos) },
  };
}
