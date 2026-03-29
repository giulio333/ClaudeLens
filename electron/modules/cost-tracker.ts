import { readFileSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { glob } from 'glob';

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
  messageCount: number;
  model?: string;          // modello dominante (retrocompatibilità)
  models: Record<string, number>; // conteggio messaggi per modello
  customTitle?: string;
}

// ─── Pricing table (prezzi per milione di token) ──────────────────────────────
// Fonte: Anthropic pricing page

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
}

interface LineData {
  date: string;
  customTitle: string | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  model: string | undefined;
}

function parseJsonlLine(line: string): LineData | null {
  try {
    const json = JSON.parse(line);
    const date = json.timestamp ? new Date(json.timestamp).toISOString() : '';
    const customTitle = json.type === 'custom-title' ? (json.customTitle as string | undefined) : undefined;
    const usage = json.message?.usage;
    if (!usage && !date && !customTitle) return null;

    const model: string | undefined = json.message?.model;
    return {
      date,
      customTitle,
      inputTokens:      usage?.input_tokens                  ?? 0,
      outputTokens:     usage?.output_tokens                 ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens   ?? 0,
      cacheReadTokens:  usage?.cache_read_input_tokens       ?? 0,
      model:            model && model !== '<synthetic>' ? model : undefined,
    };
  } catch {
    return null;
  }
}

function parseJsonlSession(filePath: string): ParsedSession {
  const result: ParsedSession = {
    inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0,
    messageCount: 0, date: '', model: undefined, models: {}, customTitle: undefined,
  };

  if (!existsSync(filePath)) return result;

  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
    const modelCounts: Record<string, number> = {};

    for (const line of lines) {
      const parsed = parseJsonlLine(line);
      if (!parsed) continue;

      if (parsed.customTitle) result.customTitle = parsed.customTitle;
      if (!result.date && parsed.date) result.date = parsed.date;

      if (parsed.inputTokens || parsed.outputTokens) {
        result.messageCount++;
        if (parsed.model) modelCounts[parsed.model] = (modelCounts[parsed.model] ?? 0) + 1;
        result.inputTokens      += parsed.inputTokens;
        result.outputTokens     += parsed.outputTokens;
        result.cacheWriteTokens += parsed.cacheWriteTokens;
        result.cacheReadTokens  += parsed.cacheReadTokens;
      }
    }

    result.models = modelCounts;
    const entries = Object.entries(modelCounts);
    if (entries.length > 0) result.model = entries.sort((a, b) => b[1] - a[1])[0][0];
    if (!result.date) result.date = statSync(filePath).mtime.toISOString();
  } catch (error) {
    console.error(`Errore leggendo JSONL da ${filePath}: ${error}`);
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function findSessionFiles(projectPath: string): Promise<string[]> {
  const sessionsDir = join(projectPath, 'sessions');
  if (existsSync(sessionsDir)) {
    const files = await glob('*.jsonl', { cwd: sessionsDir, absolute: true });
    if (files.length > 0) return files;
  }
  return glob('*.jsonl', { cwd: projectPath, absolute: true });
}

export async function getProjectUsage(
  projectPath: string
): Promise<{ usage: UsageData; sessionCount: number }> {
  const files = await findSessionFiles(projectPath);
  let inputTokens = 0, outputTokens = 0, cacheWrite = 0, cacheRead = 0;

  for (const f of files) {
    const s = parseJsonlSession(f);
    inputTokens  += s.inputTokens;
    outputTokens += s.outputTokens;
    cacheWrite   += s.cacheWriteTokens;
    cacheRead    += s.cacheReadTokens;
  }

  return {
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    sessionCount: files.length,
  };
}

export async function calculateCostSummary(claudeDir: string): Promise<ProjectCost[]> {
  try {
    const projectDirs = await glob('[!.]*', { cwd: claudeDir, absolute: true });
    const costs: ProjectCost[] = [];

    for (const projectPath of projectDirs) {
      try {
        const files = await findSessionFiles(projectPath);
        let inputTokens = 0, outputTokens = 0, cacheWrite = 0, cacheRead = 0;
        const modelCounts: Record<string, number> = {};

        for (const f of files) {
          const s = parseJsonlSession(f);
          inputTokens  += s.inputTokens;
          outputTokens += s.outputTokens;
          cacheWrite   += s.cacheWriteTokens;
          cacheRead    += s.cacheReadTokens;
          if (s.model) modelCounts[s.model] = (modelCounts[s.model] ?? 0) + 1;
        }

        const totalTokens = inputTokens + outputTokens;
        if (totalTokens === 0) continue;

        const dominantModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        const cost = calculateCost(inputTokens, outputTokens, cacheWrite, cacheRead, dominantModel);

        costs.push({
          project: projectPath.split('/').pop() || 'unknown',
          inputTokens,
          outputTokens,
          totalTokens,
          cost,
          sessionsCount: files.length,
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
  const sessions: SessionSummary[] = [];

  for (const filePath of files) {
    try {
      const s = parseJsonlSession(filePath);
      const totalTokens = s.inputTokens + s.outputTokens;
      const estimatedCost = calculateCost(
        s.inputTokens, s.outputTokens, s.cacheWriteTokens, s.cacheReadTokens, s.model
      );

      sessions.push({
        filename: basename(filePath),
        date: s.date,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheWriteTokens: s.cacheWriteTokens,
        cacheReadTokens: s.cacheReadTokens,
        totalTokens,
        estimatedCost,
        messageCount: s.messageCount,
        model: s.model,
        models: s.models,
        customTitle: s.customTitle,
      });
    } catch {
      // sessione non leggibile
    }
  }

  return sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
