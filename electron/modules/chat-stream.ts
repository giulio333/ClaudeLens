// Pure helpers for translating the Agent SDK message stream into ClaudeLens
// chat events. Extracted from chat-runner.ts (which owns the long-lived
// session and the consume loop) so the stream-translation rules — the part
// most likely to break silently when the SDK evolves — are unit-testable
// without an SDK session. Covered by test/chat-stream.test.ts.

import { randomUUID } from 'crypto';
import type { ChatMessage, ChatTurnSummary } from '../shared/chat-types';
import { mapSdkMessageToChat, withToolUseResult, type SdkSessionMessage } from './session-reader';

/** A synthetic assistant message carrying a plain note — used to surface output
 *  from slash commands that finish without a model turn (e.g. /context, /usage)
 *  or a system event (e.g. /compact's boundary), so the command isn't silently
 *  muted in the transcript. It renders through the same pipeline as a real turn. */
export function noteMessage(text: string): ChatMessage {
  return {
    uuid: unwrittenUuid(randomUUID()),
    role: 'assistant',
    // Marked `<synthetic>` (the same model tag Claude Code uses for local-command
    // turns) so the renderer can recognise it as slash-command output that never
    // lands on disk, and pin it across the reconcile to the canonical transcript.
    model: '<synthetic>',
    timestamp: new Date().toISOString(),
    content: [{ type: 'text', text }],
  };
}

/** The note text for a `system`/`compact_boundary` event: `/compact` emits no
 *  assistant turn, so this is all the user sees of what the command did. */
export function compactBoundaryNote(preTokens?: number, trigger?: string): string {
  return `Context compacted${preTokens ? ` — was ~${preTokens.toLocaleString()} tokens` : ''}${
    trigger ? ` (${trigger})` : ''
  }.`;
}

/** Pull the turn's cost/token/model summary out of an SDK `result` message. Read
 *  defensively (typed `unknown`): the result is undocumented-internal enough that
 *  a field could be absent at runtime, and a missing one should degrade to 0/[]
 *  rather than throw. The SDK reports session cumulatives here (`usage` is
 *  snake_case BetaUsage; `modelUsage` is keyed by model id). */
export function summarizeResult(msg: unknown): ChatTurnSummary {
  const r = (msg ?? {}) as Record<string, unknown>;
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const modelUsage = (r.modelUsage ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    totalCostUsd: num(r.total_cost_usd),
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheWriteTokens: num(usage.cache_creation_input_tokens),
    numTurns: num(r.num_turns),
    models: Object.keys(modelUsage),
  };
}

/** True for the user message that merely echoes the prompt just sent (no
 *  tool_result blocks). The renderer already shows the prompt optimistically,
 *  so forwarding the echo would double the bubble. */
export function isPromptEcho(mapped: ChatMessage): boolean {
  return mapped.role === 'user' && !mapped.content.some(b => b.type === 'tool_result');
}

/** True for sub-agent traffic: during a Task dispatch the SDK forwards the
 *  subagent's tool_use/tool_result blocks (and stream events) into the main
 *  stream, marked with `parent_tool_use_id`. The live turn renders the main
 *  conversation only — the persisted transcript skips sidechain lines too, so
 *  forwarding these would paint tool cards that vanish at the reconcile to disk. */
export function isSubagentTraffic(msg: object): boolean {
  return (
    'parent_tool_use_id' in msg &&
    (msg as { parent_tool_use_id: unknown }).parent_tool_use_id !== null
  );
}

/** A fully-formed message from the SDK stream, mapped the way the transcript
 *  reader maps the same row. A user message carries the tool's structured
 *  output — `tool_use_result`, the very object Claude Code writes on the row as
 *  `toolUseResult` — so the diff, the line numbers, the published page and the
 *  delivery land on the live turn too, not only when the session is reread. */
export function streamedChatMessage(
  msg: SdkSessionMessage & { tool_use_result?: unknown }
): ChatMessage | null {
  const mapped = mapSdkMessageToChat(msg);
  // A slash command's output (`/context`, `/usage`) streams as a `<synthetic>`
  // turn that Claude Code writes only as a placeholder: its id names no row.
  if (mapped?.role === 'assistant' && mapped.model === '<synthetic>') {
    return { ...mapped, uuid: unwrittenUuid(mapped.uuid) };
  }
  if (!mapped || mapped.role !== 'user' || msg.tool_use_result === undefined) return mapped;
  const content = withToolUseResult(mapped.content, msg.tool_use_result);
  return content === mapped.content ? mapped : { ...mapped, content };
}

/** The user message a send pushes into the SDK's input stream. `uuid` is the id
 *  the renderer gave the prompt's bubble: the SDK writes a supplied uuid as the
 *  transcript row's own, so the bubble on screen and the row on disk are one
 *  message — a highlight made on the prompt survives a reread, and a resume
 *  seed dedupes it. Without one the CLI mints its own. */
export function userTurn(text: string, uuid?: string) {
  return {
    type: 'user' as const,
    message: { role: 'user' as const, content: text },
    parent_tool_use_id: null,
    ...(uuid ? { uuid } : {}),
  };
}

/** The id of a message shown in the live chat that no transcript row carries.
 *  The `__…__` form is the one `isPersistableMessageUuid` refuses, so nothing is
 *  anchored to it — a highlight on it would be orphaned on the first reread. */
function unwrittenUuid(id: string): string {
  return `__${id}__`;
}
