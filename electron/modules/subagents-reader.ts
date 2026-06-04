import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';

// Metadati di un subagent eseguito durante una sessione. Claude Code salva il
// transcript interno di ogni sub-agente in
// `{projectPath}/{sessionId}/subagents/agent-<agentId>.jsonl` (righe con
// isSidechain=true). Il `subagent_type` leggibile NON è nel file del subagent
// (lì c'è solo uno `slug` codename): va correlato al `Task`/`Agent` tool_use del
// padre tramite il prompt. Per questo esponiamo `firstPrompt`, su cui il
// renderer abbina ogni dispatch al suo file (match per prefisso del prompt).
export interface SubagentMeta {
  agentId: string;
  filePath: string;
  /** Prompt iniziale dato al subagente (primo messaggio user). Chiave di correlazione. */
  firstPrompt: string;
  startedAt: string;
  endedAt: string;
  /** Numero di righe chat (user/assistant non-meta) nel transcript interno. */
  messageCount: number;
}

function firstLineText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === 'object') {
        const block = b as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') return block.text;
      }
    }
  }
  return '';
}

function readSubagentFile(filePath: string): SubagentMeta | null {
  let lines: string[];
  try {
    lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
  } catch {
    return null;
  }

  let agentId = basename(filePath).replace(/^agent-/, '').replace(/\.jsonl$/, '');
  let firstPrompt = '';
  let startedAt = '';
  let endedAt = '';
  let messageCount = 0;

  for (const line of lines) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof json.agentId === 'string' && json.agentId) agentId = json.agentId;

    if (json.type !== 'user' && json.type !== 'assistant') continue;
    if (json.isMeta === true) continue;

    const ts = typeof json.timestamp === 'string' ? json.timestamp : '';
    if (ts) {
      if (!startedAt) startedAt = ts;
      endedAt = ts;
    }
    messageCount++;

    if (!firstPrompt && json.type === 'user') {
      const msg = json.message as Record<string, unknown> | undefined;
      const text = firstLineText(msg?.content).trim();
      if (text) firstPrompt = text.slice(0, 400);
    }
  }

  if (messageCount === 0) return null;
  return { agentId, filePath, firstPrompt, startedAt, endedAt, messageCount };
}

// Elenca i subagent di una sessione. `sessionFilename` è il `.jsonl` della
// sessione (es. `<sessionId>.jsonl`); la cartella dei subagent vive accanto, in
// `{projectPath}/{sessionId}/subagents/`.
// La cartella dei subagent vive accanto al `.jsonl` della sessione, in una dir
// che porta il nome del sessionId. Il `.jsonl` può stare nella root del progetto
// o sotto `sessions/` (vedi `findSessionFile`): proviamo entrambe le posizioni.
function subagentsDir(projectPath: string, sessionFilename: string): string | null {
  const sessionId = sessionFilename.replace(/\.jsonl$/, '');
  const candidates = [
    join(projectPath, sessionId, 'subagents'),
    join(projectPath, 'sessions', sessionId, 'subagents'),
  ];
  return candidates.find(existsSync) ?? null;
}

export function readSessionSubagents(projectPath: string, sessionFilename: string): SubagentMeta[] {
  const dir = subagentsDir(projectPath, sessionFilename);
  if (!dir) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const metas: SubagentMeta[] = [];
  for (const entry of entries) {
    const meta = readSubagentFile(join(dir, entry));
    if (meta) metas.push(meta);
  }

  // Ordine cronologico di avvio: rispecchia l'ordine in cui compaiono nella chat.
  metas.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return metas;
}

// Risolve il path assoluto del file transcript di un subagente, validando che
// stia davvero sotto `{projectPath}/{sessionId}/subagents/` (no traversal).
export function resolveSubagentPath(
  projectPath: string,
  sessionFilename: string,
  agentId: string,
): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) return null;
  const dir = subagentsDir(projectPath, sessionFilename);
  if (!dir) return null;
  const candidate = join(dir, `agent-${agentId}.jsonl`);
  if (existsSync(candidate)) return candidate;
  // Alcuni file possono già includere il prefisso nel nome salvato.
  const bare = join(dir, `${agentId}.jsonl`);
  if (existsSync(bare)) return bare;
  return null;
}
