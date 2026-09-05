import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import { stripFramingTags } from '../utils';
import { StampCache, firstFileStamp, treeStamp } from './session-read-cache';
import type { ChatContentBlock, ChatMessage, MessageUsage } from '../shared/chat-types';

// The message shapes live in the shared module (single definition for main and
// renderer); re-exported here so existing `./session-reader` importers keep
// working unchanged.
export type { ChatContentBlock, ChatMessage, MessageUsage } from '../shared/chat-types';

/** Parse the message-level `usage` block (Anthropic field names) if present. */
function parseUsage(msg: Record<string, unknown>): MessageUsage | undefined {
  const u = msg.usage as Record<string, unknown> | undefined;
  if (!u) return undefined;
  return {
    inputTokens: Number(u.input_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Number(u.cache_creation_input_tokens ?? 0),
  };
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
      // Mirror the text handling: skip empty/whitespace-only thinking blocks so
      // they don't survive as zero-content entries that defeat the empty-message
      // filter downstream.
      if (typeof b.thinking === 'string' && b.thinking.trim()) {
        blocks.push({ type: 'thinking', thinking: b.thinking });
      }
    } else if (b.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: String(b.id ?? ''),
        name: String(b.name ?? 'tool'),
        input: (b.input as Record<string, unknown>) ?? {},
      });
    } else if (b.type === 'tool_result') {
      const content =
        typeof b.content === 'string'
          ? b.content
          : Array.isArray(b.content)
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

  try {
    return parseChatSessionText(readFileSync(filePath, 'utf-8'), options);
  } catch (error) {
    console.error(`Errore leggendo sessione chat ${filePath}: ${error}`);
    return [];
  }
}

/**
 * The line-by-line half of `readChatSession`, over text already in memory.
 *
 * Exported because `session-search` reads each transcript ONCE — raw, for its
 * cheap substring reject — and must parse the survivors from that same string
 * rather than opening the file a second time. Sharing the function (instead of
 * the search growing its own line loop) is what keeps the two from drifting on
 * the rules that decide what a message even IS here: meta and sidechain lines
 * skipped, the `No response requested.` placeholder dropped, uuid-deduped
 * sdk-cli/cli rewrites collapsed. A search that applied a different set would
 * quote text the transcript view then refuses to show.
 */
export function parseChatSessionText(raw: string, options: ReadChatOptions = {}): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // Una sessione ripresa in modalità headless (`claude -p --resume`, lanciato
  // da ClaudeLens) e poi riaperta nella CLI interattiva riscrive lo stesso
  // range di righe nel `.jsonl` con `uuid`/`timestamp` identici (cambia solo
  // `entrypoint`: "sdk-cli" → "cli"). Senza dedup il transcript mostra ogni
  // turno due volte e le key React duplicate rompono la riconciliazione.
  const seenUuids = new Set<string>();

  const lines = raw.split('\n').filter(l => l.trim());

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
        usage: parseUsage(msg),
      });
    } catch {
      // riga non-JSON
    }
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
    usage: parseUsage(msg),
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

/**
 * Where a session's transcripts live on disk, so a read can be narrowed and
 * change-detected. Both fields are optional: with neither, the readers behave
 * exactly as before (search every project, never cache).
 */
export interface SessionSource {
  /** `~/.claude/projects/<hash>` — used to fingerprint the transcript files. */
  projectDir?: string;
  /**
   * The project's REAL cwd, which is what the SDK's `dir` option wants (verified
   * against the SDK: `dir` has `listSessions({ dir })` semantics, so passing
   * `~/.claude/projects/<hash>` finds nothing). Use `resolveRealPath`.
   */
  cwd?: string;
}

/** The two places Claude Code puts a session transcript, in the order
 *  `cost-tracker`'s `findSessionFiles` and `findSessionFile` below probe them. */
function transcriptCandidates(projectDir: string, sessionId: string): string[] {
  return [
    join(projectDir, `${sessionId}.jsonl`),
    join(projectDir, 'sessions', `${sessionId}.jsonl`),
  ];
}

/** `subagents/` sidecar dir of a session, whose tree feeds the sub-agent readers. */
export function subagentsDirFor(projectDir: string, sessionId: string): string {
  return join(projectDir, sessionId, 'subagents');
}

/** Change fingerprint of a session's own transcript; `null` when we don't know
 *  where it is (no `projectDir`, or the file isn't in either usual place), which
 *  disables caching for that read rather than risking a stale transcript. */
export async function sessionTranscriptStamp(
  sessionId: string,
  source: SessionSource
): Promise<string | null> {
  if (!source.projectDir) return null;
  return firstFileStamp(transcriptCandidates(source.projectDir, sessionId));
}

/** Cache key. Scoped by project dir as well as id so an entry can never be
 *  reused across projects — a duplicate-merge moves transcripts between project
 *  dirs and preserves their mtime, which would otherwise look unchanged. */
export function sessionCacheKey(sessionId: string, source: SessionSource): string {
  return `${source.projectDir ?? ''}\u0000${sessionId}`;
}

/**
 * The cwds whose `dir` hint has been OBSERVED to work: a scoped read for it came
 * back non-empty at least once, so the SDK does resolve it to a project dir that
 * holds our sessions.
 *
 * This is what lets an empty scoped read be believed instead of retried (see
 * `canTrustEmptyScoped`). It is deliberately empirical rather than derived —
 * checking `pathToHash(cwd) === basename(projectDir)` would bake in an
 * assumption about how the SDK turns a `dir` into a project dir (Claude Code
 * folds both '/' and '.' into '-', which is exactly the kind of detail that
 * drifts), and being wrong there would HIDE a transcript. An observation cannot
 * be wrong about the only thing we ask of it.
 */
const verifiedCwds = new Set<string>();

/** How many reads fell back to the cross-project scan. Diagnostics only, but it
 *  is what the tests assert on: "this read did NOT pay the unscoped scan" has no
 *  other observable signature. */
let unscopedRetries = 0;

export function markScopeVerified(cwd: string | undefined, gotResults: boolean): void {
  if (cwd && gotResults) verifiedCwds.add(cwd);
}

export function noteUnscopedRetry(): void {
  unscopedRetries++;
}

/**
 * Can an empty scoped read be taken at face value, instead of retried without
 * `dir`? Only with two pieces of evidence, both observed:
 *
 *  - the hint has already produced results for this cwd (`verifiedCwds`);
 *  - the source we fingerprinted really is under `projectDir` — a non-null
 *    stamp — so the scoped and the unscoped read are looking at the same files.
 *
 * Anything short of that retries: the hint must only ever save work, never hide
 * a transcript. Getting this right matters because the common case IS the empty
 * one — most sessions have no sub-agents, so `listSubagents` legitimately
 * returns [] and the retry would pay the full ~38 ms cross-project scan on every
 * flush of a live session, which is the exact cost this cache exists to remove.
 */
export function canTrustEmptyScoped(source: SessionSource, stamp: string | null): boolean {
  return stamp !== null && !!source.cwd && verifiedCwds.has(source.cwd);
}

/**
 * `getSessionMessages`, narrowed to one project when the cwd is known.
 *
 * Without `dir` the SDK scans EVERY project dir under ~/.claude to locate the
 * id — measured at ~38 ms of the ~74 ms total on a registry of 150 projects.
 * A wrong `dir` makes the SDK return an empty array rather than raise, and
 * `resolveRealPath` falls back to a lossy hash→path inversion when no transcript
 * carries an authoritative cwd, so an empty narrowed read is retried unscoped
 * unless the scope is already proven. The hint can then only ever save work,
 * never hide a transcript.
 */
async function getSessionMessagesScoped(
  sessionId: string,
  source: SessionSource,
  stamp: string | null
): Promise<SdkSessionMessage[]> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  if (source.cwd) {
    const scoped = (await sdk.getSessionMessages(sessionId, {
      dir: source.cwd,
    })) as SdkSessionMessage[];
    markScopeVerified(source.cwd, scoped.length > 0);
    if (scoped.length > 0 || canTrustEmptyScoped(source, stamp)) return scoped;
  }
  noteUnscopedRetry();
  return (await sdk.getSessionMessages(sessionId, {})) as SdkSessionMessage[];
}

// Bound 4: ChatView is keyed per filename so one session is focused at a time,
// but `sessions:getSubagents` shares this cache (it derives the dispatch prompts
// from the parent transcript) and Mission Control can have a second session in
// view, so a bound of 2 thrashes as soon as three are in play — and a thrash
// here costs a whole re-read. Each entry is a mapped transcript, so the ceiling
// stays a handful of them rather than growing with history size.
const chatCache = new StampCache<ChatMessage[]>(4);

export async function readChatSessionViaSdk(
  sessionId: string,
  source: SessionSource = {}
): Promise<ChatMessage[]> {
  const stamp = await sessionTranscriptStamp(sessionId, source);
  return chatCache.read(sessionCacheKey(sessionId, source), stamp, async () =>
    mapSdkMessagesToChat(await getSessionMessagesScoped(sessionId, source, stamp))
  );
}

// Transcript interno di un sub-agente via SDK (`getSubagentMessages`), in luogo
// della lettura diretta del file `subagents/agent-*.jsonl`.
//
// Keyed on the WHOLE `subagents/` tree, not the one agent's file: the SDK doesn't
// expose which file backs an agentId (a teammate's is `agent-a<name>-*.jsonl`,
// a workflow's is nested under `workflows/<runId>/`), so guessing it risks
// serving a stale transcript. Stamping the tree over-invalidates a little —
// another agent's append misses this one's entry — and never goes stale.
const subagentTranscriptCache = new StampCache<ChatMessage[]>(4);

export async function readSubagentTranscriptViaSdk(
  sessionId: string,
  agentId: string,
  source: SessionSource = {}
): Promise<ChatMessage[]> {
  const stamp = source.projectDir
    ? await treeStamp(subagentsDirFor(source.projectDir, sessionId))
    : null;
  // An empty tree stamp is "no files under subagents/", which is presence
  // evidence of nothing — so it must not license trusting an empty scoped read.
  const presence = stamp ? stamp : null;
  const key = `${sessionCacheKey(sessionId, source)}\u0000${agentId}`;
  return subagentTranscriptCache.read(key, stamp, async () => {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    if (source.cwd) {
      const scoped = (await sdk.getSubagentMessages(sessionId, agentId, {
        dir: source.cwd,
      })) as SdkSessionMessage[];
      markScopeVerified(source.cwd, scoped.length > 0);
      if (scoped.length > 0 || canTrustEmptyScoped(source, presence)) {
        return mapSdkMessagesToChat(scoped);
      }
    }
    noteUnscopedRetry();
    const raw = (await sdk.getSubagentMessages(sessionId, agentId, {})) as SdkSessionMessage[];
    return mapSdkMessagesToChat(raw);
  });
}

/** Test/diagnostics hook: proves an unchanged transcript is served without a
 *  read, and that a proven `dir` scope spares the cross-project scan. */
export function getSessionReadCacheStats() {
  return {
    chat: chatCache.stats(),
    subagentTranscript: subagentTranscriptCache.stats(),
    unscopedRetries,
  };
}

export function resetSessionReadCache(): void {
  chatCache.reset();
  subagentTranscriptCache.reset();
  verifiedCwds.clear();
  unscopedRetries = 0;
}

export async function findSessionFile(
  projectPath: string,
  filename: string
): Promise<string | null> {
  const sessionsDir = join(projectPath, 'sessions');
  const inSessions = join(sessionsDir, filename);
  if (existsSync(inSessions)) return inSessions;

  const inRoot = join(projectPath, filename);
  if (existsSync(inRoot)) return inRoot;

  // Fallback: cerca ricorsivamente
  const found = await glob(`**/${filename}`, { cwd: projectPath, absolute: true });
  return found[0] ?? null;
}
