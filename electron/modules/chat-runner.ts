// Runs a Claude Code chat turn through the official Agent SDK
// (`@anthropic-ai/claude-agent-sdk`) instead of spawning the `claude -p` binary.
// The binary path is headless: a tool that would normally prompt for approval is
// simply denied, so the only ways to let the agent act are a blind bypass or a
// mode that silently blocks. The SDK exposes `canUseTool`, a callback fired in the
// main process whenever Claude wants a non-auto-approved tool — we forward it to
// the renderer, show an Allow / Always / Deny dialog, and return the decision to
// the SDK. That turns ClaudeLens into the interactive terminal experience.
//
// `persistSession` defaults to `true`, so the SDK writes to
// `~/.claude/projects/<hash>/<id>.jsonl` exactly like the CLI — the two stay
// interchangeable. `resume` (without `forkSession`) appends to the same file;
// passing an explicit `sessionId` on a fresh run lets us pre-generate the id and
// avoid any race in the new-chat view.
//
// The SDK is ESM-only, so it is loaded with a dynamic `import()` from the
// CommonJS main process (same approach as config-reader.ts / live-monitor.ts).

import { randomUUID } from 'crypto';
import { mapSdkMessageToChat, type ChatMessage } from './session-reader';

async function loadSdk() {
  return import('@anthropic-ai/claude-agent-sdk');
}

// A synthetic assistant message carrying a plain note — used to surface output
// from slash commands that finish without a model turn (e.g. /context, /usage)
// or a system event (e.g. /compact's boundary), so the command isn't silently
// muted in the transcript. It renders through the same pipeline as a real turn.
function noteMessage(text: string): ChatMessage {
  return {
    uuid: randomUUID(),
    role: 'assistant',
    // Marked `<synthetic>` (the same model tag Claude Code uses for local-command
    // turns) so the renderer can recognise it as slash-command output that never
    // lands on disk, and pin it across the reconcile to the canonical transcript.
    model: '<synthetic>',
    timestamp: new Date().toISOString(),
    content: [{ type: 'text', text }],
  };
}

// The SDK is ESM-only; deriving its types from the dynamic `import()` (rather than
// a top-level `import type`) avoids the CommonJS→ESM resolution-mode requirement.
// Re-exported so the main process can type its canUseTool plumbing off the same
// source of truth without a direct package import.
type Sdk = Awaited<ReturnType<typeof loadSdk>>;
export type CanUseTool = NonNullable<
  NonNullable<Parameters<Sdk['query']>[0]['options']>['canUseTool']
>;
export type PermissionResult = Awaited<ReturnType<CanUseTool>>;
export type PermissionUpdate = NonNullable<Parameters<CanUseTool>[2]['suggestions']>[number];

export interface RunChatParams {
  cwd: string;
  prompt: string;
  /** Resume mode: append to this session's transcript. */
  resume?: string;
  /** New-session mode: pre-generated id so the new transcript id is known up front. */
  sessionId?: string;
  model?: string;
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  canUseTool: CanUseTool;
  abortController: AbortController;
  env: Record<string, string | undefined>;
}

export interface RunChatCallbacks {
  /** Fired with the session id as soon as the SDK reports it (init message). */
  onStarted: (sessionId: string) => void;
  /** Fired with each live text delta (partial assistant message). */
  onChunk: (text: string) => void;
  /** Fired with each fully-formed chat message as the SDK emits it during the
   *  turn (a completed assistant message, or a tool_result-bearing user message).
   *  Lets the renderer build the live turn — tools and all — straight from the
   *  stream, without re-reading the partially-written transcript from disk. */
  onMessage: (message: ChatMessage) => void;
  /** Fired with an error message (result.is_error, or a thrown failure). */
  onError: (message: string) => void;
  /** Fired once when the turn completes (success or handled error). */
  onDone: () => void;
}

// Drives the SDK query to completion, translating its message stream into the
// flat onStarted/onChunk/onError/onDone callbacks the IPC layer forwards to the
// renderer (the same channels the old spawn path used).
export async function runChat(params: RunChatParams, cb: RunChatCallbacks): Promise<void> {
  const sdk = await loadSdk();
  let started = false;
  // Whether the turn produced any assistant message. Local slash commands
  // (/context, /usage, …) run with no model turn and ride their output on the
  // final `result` message — we only surface that when no assistant turn ran,
  // so a normal reply isn't echoed twice.
  let sawAssistant = false;

  try {
    const q = sdk.query({
      prompt: params.prompt,
      options: {
        cwd: params.cwd,
        ...(params.resume && { resume: params.resume }),
        forkSession: false,
        ...(params.sessionId && { sessionId: params.sessionId }),
        ...(params.model && { model: params.model }),
        permissionMode: params.permissionMode,
        includePartialMessages: true,
        canUseTool: params.canUseTool,
        abortController: params.abortController,
        env: params.env,
      },
    });

    for await (const msg of q) {
      // The init message is the first to carry the resolved session id.
      if (!started && msg.type === 'system' && msg.subtype === 'init') {
        started = true;
        cb.onStarted(msg.session_id);
        continue;
      }
      // Live text deltas (only present with includePartialMessages).
      if (msg.type === 'stream_event') {
        const event = msg.event;
        if (
          event?.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          event.delta.text
        ) {
          cb.onChunk(event.delta.text);
        }
        continue;
      }
      // Fully-formed messages: a completed assistant turn, or a user message
      // carrying tool_results. We skip the user message that merely echoes the
      // prompt we just sent (it has no tool_result blocks) — the renderer already
      // shows that optimistically, and forwarding it would double the bubble.
      if (msg.type === 'assistant' || msg.type === 'user') {
        const mapped = mapSdkMessageToChat(msg as Parameters<typeof mapSdkMessageToChat>[0]);
        if (mapped) {
          const isPromptEcho =
            mapped.role === 'user' && !mapped.content.some(b => b.type === 'tool_result');
          if (!isPromptEcho) {
            if (mapped.role === 'assistant') sawAssistant = true;
            cb.onMessage(mapped);
          }
        }
        continue;
      }
      // `/compact` emits no assistant turn — just a boundary event. Surface a
      // short note so the command visibly did something.
      if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
        const pre = msg.compact_metadata?.pre_tokens;
        const trigger = msg.compact_metadata?.trigger;
        cb.onMessage(
          noteMessage(
            `Context compacted${pre ? ` — was ~${pre.toLocaleString()} tokens` : ''}${
              trigger ? ` (${trigger})` : ''
            }.`
          )
        );
        continue;
      }
      if (msg.type === 'result') {
        // A result with is_error surfaces a model/permission failure.
        if (msg.is_error) {
          const detail =
            msg.subtype === 'success'
              ? msg.result
              : (msg.errors?.join('\n') ?? msg.subtype);
          cb.onError(detail || 'The session reported an error.');
        } else if (!sawAssistant && msg.subtype === 'success' && msg.result?.trim()) {
          // A local slash command (/context, /usage, …) returned text directly
          // with no model turn — surface it as an assistant note.
          cb.onMessage(noteMessage(msg.result));
        }
      }
    }
  } catch (e) {
    // An abort is a deliberate stop, not a failure to report.
    if (!params.abortController.signal.aborted) {
      cb.onError(e instanceof Error ? e.message : String(e));
    }
  } finally {
    cb.onDone();
  }
}
