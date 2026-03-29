import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean };

export interface ChatMessage {
  uuid: string;
  role: 'user' | 'assistant';
  timestamp: string;
  model?: string;
  content: ChatContentBlock[];
}

function parseContentArray(raw: unknown[]): ChatContentBlock[] {
  const blocks: ChatContentBlock[] = [];

  for (const block of raw) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;

    if (b.type === 'text' && typeof b.text === 'string') {
      if (b.text.trim()) blocks.push({ type: 'text', text: b.text });

    } else if (b.type === 'thinking') {
      const text = typeof b.thinking === 'string' ? b.thinking : '';
      blocks.push({ type: 'thinking', thinking: text });

    } else if (b.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: String(b.id ?? ''),
        name: String(b.name ?? 'tool'),
        input: (b.input as Record<string, unknown>) ?? {},
      });

    } else if (b.type === 'tool_result') {
      const content =
        typeof b.content === 'string' ? b.content :
        Array.isArray(b.content) ? (b.content as Array<{ text?: string }>).map(c => c.text ?? '').join('\n') :
        '';
      blocks.push({
        type: 'tool_result',
        toolUseId: String(b.tool_use_id ?? ''),
        content,
        isError: Boolean(b.is_error),
      });
    }
  }

  return blocks;
}

export function readChatSession(filePath: string): ChatMessage[] {
  if (!existsSync(filePath)) return [];

  const messages: ChatMessage[] = [];

  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line) as Record<string, unknown>;

        // Salta righe non-chat
        if (json.type !== 'user' && json.type !== 'assistant') continue;
        // Salta messaggi di sistema/meta
        if (json.isMeta === true) continue;
        // Salta sidechain (subagent internals)
        if (json.isSidechain === true) continue;

        const msg = json.message as Record<string, unknown> | undefined;
        if (!msg) continue;

        const role = msg.role as 'user' | 'assistant';
        if (role !== 'user' && role !== 'assistant') continue;

        const rawContent = msg.content;
        let blocks: ChatContentBlock[] = [];

        if (typeof rawContent === 'string') {
          // Salta messaggi tecnici (caveat, command, ecc.)
          const stripped = rawContent.replace(/<[^>]+>/g, '').trim();
          if (!stripped) continue;
          blocks = [{ type: 'text', text: stripped }];
        } else if (Array.isArray(rawContent)) {
          blocks = parseContentArray(rawContent);
        }

        if (blocks.length === 0) continue;

        messages.push({
          uuid: String(json.uuid ?? ''),
          role,
          timestamp: String(json.timestamp ?? ''),
          model: msg.model as string | undefined,
          content: blocks,
        });
      } catch {
        // riga non-JSON
      }
    }
  } catch (error) {
    console.error(`Errore leggendo sessione chat ${filePath}: ${error}`);
  }

  return messages;
}

export async function findSessionFile(projectPath: string, filename: string): Promise<string | null> {
  const sessionsDir = join(projectPath, 'sessions');
  const inSessions = join(sessionsDir, filename);
  if (existsSync(inSessions)) return inSessions;

  const inRoot = join(projectPath, filename);
  if (existsSync(inRoot)) return inRoot;

  // Fallback: cerca ricorsivamente
  const found = await glob(`**/${filename}`, { cwd: projectPath, absolute: true });
  return found[0] ?? null;
}
