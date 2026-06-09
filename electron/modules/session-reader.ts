import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import { stripFramingTags } from '../utils';

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

// Built-in slash commands (/context, /usage, /clear, …) run with no model turn,
// and Claude Code persists a placeholder assistant message — `<synthetic>` model,
// text "No response requested." — while discarding the command's real output. The
// placeholder carries no information, so we drop it: the live output (which the
// SDK *does* stream) is shown and pinned by the renderer instead.
function isPlaceholderNote(blocks: ChatContentBlock[]): boolean {
  return (
    blocks.length === 1 &&
    blocks[0].type === 'text' &&
    blocks[0].text.trim() === 'No response requested.'
  );
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
        Array.isArray(b.content)
          ? (b.content as Array<unknown>)
              .map(c => {
                // Nel formato Anthropic gli elementi possono essere stringhe
                // semplici (`["text"]`) o anche `null`: senza guardia sul tipo
                // l'accesso a `c.type` lancerebbe TypeError, scartando l'intero
                // messaggio dal try/catch per-riga.
                if (typeof c === 'string') return c;
                if (c && typeof c === 'object') {
                  const block = c as { type?: string; text?: string; tool_name?: string };
                  return block.type === 'tool_reference' && block.tool_name
                    ? `→ ${block.tool_name}`
                    : (block.text ?? '');
                }
                return '';
              })
              .join('\n')
          : '';
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

// Normalizza un content stringa (messaggi user testuali) in blocchi.
// Preserva i tag noti del flow Claude Code command così il frontend può
// renderizzarli come card dedicata; altrimenti rimuove solo i tag di framing
// noti (caveat, ecc.) lasciando intatta la prosa con `<`/`>` da codice (#93).
function parseStringContent(rawContent: string): ChatContentBlock[] {
  const isCommand = /<(command-name|local-command-stdout)\b/.test(rawContent);
  if (isCommand) return [{ type: 'text', text: rawContent }];
  const stripped = stripFramingTags(rawContent).trim();
  if (!stripped) return [];
  return [{ type: 'text', text: stripped }];
}

export interface ReadChatOptions {
  // I file dei subagent (`subagents/agent-*.jsonl`) hanno ogni riga con
  // isSidechain=true: per leggerne il transcript interno occorre NON saltarli.
  includeSidechain?: boolean;
}

export function readChatSession(filePath: string, options: ReadChatOptions = {}): ChatMessage[] {
  if (!existsSync(filePath)) return [];

  const messages: ChatMessage[] = [];
  // Una sessione ripresa in modalità headless (`claude -p --resume`, lanciato
  // da ClaudeLens) e poi riaperta nella CLI interattiva riscrive lo stesso
  // range di righe nel `.jsonl` con `uuid`/`timestamp` identici (cambia solo
  // `entrypoint`: "sdk-cli" → "cli"). Senza dedup il transcript mostra ogni
  // turno due volte e le key React duplicate rompono la riconciliazione.
  const seenUuids = new Set<string>();

  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line) as Record<string, unknown>;

        // Salta righe non-chat
        if (json.type !== 'user' && json.type !== 'assistant') continue;
        // Salta messaggi di sistema/meta
        if (json.isMeta === true) continue;
        // Salta sidechain (subagent internals) salvo lettura esplicita del transcript
        if (json.isSidechain === true && !options.includeSidechain) continue;

        const msg = json.message as Record<string, unknown> | undefined;
        if (!msg) continue;

        const role = msg.role as 'user' | 'assistant';
        if (role !== 'user' && role !== 'assistant') continue;

        const rawContent = msg.content;
        let blocks: ChatContentBlock[] = [];

        if (typeof rawContent === 'string') {
          blocks = parseStringContent(rawContent);
          if (blocks.length === 0) continue;
        } else if (Array.isArray(rawContent)) {
          blocks = parseContentArray(rawContent);
        }

        if (blocks.length === 0) continue;
        // Salta il placeholder "No response requested." dei comandi locali.
        if (role === 'assistant' && isPlaceholderNote(blocks)) continue;

        // Scarta i duplicati esatti per uuid (vedi nota su sdk-cli/cli sopra).
        // Gli uuid vuoti non vengono deduplicati per non collassare righe
        // distinte che ne fossero prive.
        const uuid = String(json.uuid ?? '');
        if (uuid && seenUuids.has(uuid)) continue;
        if (uuid) seenUuids.add(uuid);

        messages.push({
          uuid,
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

// ──────────────────────────────────────────────────────────────────────────
// POC — lettura dello storico via Agent SDK (`getSessionMessages`) invece del
// parsing diretto del JSONL. Restituisce lo stesso `ChatMessage[]` (riusa
// `parseContentArray`/`parseStringContent`), quindi la UI è invariata. L'SDK
// ricostruisce la catena canonica via `parentUuid` (ordine corretto sui fork,
// dedup sdk-cli/cli, stitching dei resume) ed espone `timestamp`/`model`/`usage`
// nativi — ma TRONCA alla compaction (perde la storia pre-`/compact`).
// L'SDK è ESM-only: caricato con `import()` dinamico dal main CommonJS.
// ──────────────────────────────────────────────────────────────────────────
// Forma minima di un SDKSessionMessage (il tipo dell'SDK è ESM-only e `message`
// è `unknown`); `timestamp` esiste a runtime ma non nel tipo dichiarato.
export type SdkSessionMessage = {
  type: string;
  uuid?: string;
  message?: unknown;
  timestamp?: string;
};

// Mapping di un singolo SDK message → ChatMessage, riusando lo stesso parsing dei
// blocchi del reader da file. Restituisce null per i messaggi non-chat o vuoti.
// Usato sia dalla lettura storica (mapSdkMessagesToChat) sia, in tempo reale, dal
// chat-runner che inoltra ogni messaggio appena l'SDK lo emette nello stream.
export function mapSdkMessageToChat(m: SdkSessionMessage): ChatMessage | null {
  if (m.type !== 'user' && m.type !== 'assistant') return null;
  const msg = m.message as Record<string, unknown> | undefined;
  if (!msg) return null;

  const rawContent = msg.content;
  let blocks: ChatContentBlock[] = [];
  if (typeof rawContent === 'string') blocks = parseStringContent(rawContent);
  else if (Array.isArray(rawContent)) blocks = parseContentArray(rawContent);
  if (blocks.length === 0) return null;
  // Drop the local-command placeholder (see isPlaceholderNote). The live output
  // streamed for the same turn is a distinct, real message and is kept.
  if (m.type === 'assistant' && isPlaceholderNote(blocks)) return null;

  // Built-in slash commands (/context, /usage, …) stream their output as a
  // `<synthetic>`-model assistant message that the SDK emits WITHOUT a timestamp
  // (verified against the live stream). An empty timestamp renders as "Invalid
  // Date" downstream, so fall back to now — for a live-streamed message that is
  // its emission time, which is what we want to show.
  return {
    uuid: String(m.uuid ?? ''),
    role: m.type,
    timestamp: String(m.timestamp ?? '') || new Date().toISOString(),
    model: msg.model as string | undefined,
    content: blocks,
  };
}

// Mapping condiviso SessionMessage[] (SDK) → ChatMessage[]. Usato sia per il
// transcript principale sia per quelli dei sub-agenti.
function mapSdkMessagesToChat(raw: SdkSessionMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const m of raw) {
    const mapped = mapSdkMessageToChat(m);
    if (mapped) messages.push(mapped);
  }
  return messages;
}

export async function readChatSessionViaSdk(sessionId: string): Promise<ChatMessage[]> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  // Senza `dir` l'SDK cerca l'id in tutte le project directory di ~/.claude.
  const raw = (await sdk.getSessionMessages(sessionId, {})) as SdkSessionMessage[];
  return mapSdkMessagesToChat(raw);
}

// Transcript interno di un sub-agente via SDK (`getSubagentMessages`), in luogo
// della lettura diretta del file `subagents/agent-*.jsonl`.
export async function readSubagentTranscriptViaSdk(
  sessionId: string,
  agentId: string,
): Promise<ChatMessage[]> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const raw = (await sdk.getSubagentMessages(sessionId, agentId, {})) as SdkSessionMessage[];
  return mapSdkMessagesToChat(raw);
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
