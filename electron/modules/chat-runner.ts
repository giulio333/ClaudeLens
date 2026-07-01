// Runs Claude Code chat through the official Agent SDK
// (`@anthropic-ai/claude-agent-sdk`) in **streaming input mode** — the mode the
// SDK documents as recommended. Instead of opening a fresh one-shot `query()` per
// turn (single-message input + `resume`), one long-lived `query()` is driven by a
// push-generator: `ChatSession` keeps the session alive across turns, so the
// model context stays warm (no per-turn re-resume) and we get the SDK's native
// control requests — `interrupt()` (a real Stop that keeps the session alive),
// `setModel()` / `setPermissionMode()` mid-session, and queued input.
//
// The binary path (`claude -p`) is headless: a tool that would normally prompt is
// simply denied. The SDK exposes `canUseTool`, fired in the main process whenever
// Claude wants a non-auto-approved tool — we forward it to the renderer, show an
// Allow / Always / Deny dialog, and return the decision. That turns ClaudeLens
// into the interactive terminal experience.
//
// `persistSession` defaults to `true`, so the SDK writes to
// `~/.claude/projects/<hash>/<id>.jsonl` exactly like the CLI — the two stay
// interchangeable. A first turn either resumes an existing session (`resume`,
// without `forkSession`, appends to the same file) or starts a new one with a
// pre-generated `sessionId` so the new transcript id is known up front.
//
// The SDK is ESM-only, so it is loaded with a dynamic `import()` from the
// CommonJS main process (same approach as config-reader.ts / live-monitor.ts).

import { randomUUID } from 'crypto';
import { mapSdkMessageToChat, type ChatMessage } from './session-reader';
import { resolveClaudeExecutablePath } from '../utils';
import type { ToolActivity, ChatTurnSummary } from '../shared/chat-types';
import {
  noteMessage,
  compactBoundaryNote,
  summarizeResult,
  isPromptEcho,
  isSubagentTraffic,
} from './chat-stream';

async function loadSdk() {
  return import('@anthropic-ai/claude-agent-sdk');
}

// Packaged app only: the SDK's CLI binary lives outside app.asar (asarUnpack)
// and the SDK can't find it on its own. Undefined in dev.
const claudeExecutable = resolveClaudeExecutablePath();

// The SDK is ESM-only; deriving its types from the dynamic `import()` (rather than
// a top-level `import type`) avoids the CommonJS→ESM resolution-mode requirement.
// Re-exported so the main process can type its canUseTool plumbing off the same
// source of truth without a direct package import.
type Sdk = Awaited<ReturnType<typeof loadSdk>>;
type QueryOptions = NonNullable<Parameters<Sdk['query']>[0]['options']>;
export type CanUseTool = NonNullable<QueryOptions['canUseTool']>;
export type PermissionResult = Awaited<ReturnType<CanUseTool>>;
export type PermissionUpdate = NonNullable<Parameters<CanUseTool>[2]['suggestions']>[number];
export type PermissionMode = NonNullable<QueryOptions['permissionMode']>;
// The streaming-input element type: what the push-generator must yield.
type SdkUserMessage =
  Parameters<Sdk['query']>[0]['prompt'] extends string | AsyncIterable<infer U> ? U : never;
type SdkQuery = ReturnType<Sdk['query']>;

export interface ChatSessionParams {
  cwd: string;
  /** Resume mode: append to this session's transcript on the first turn. */
  resume?: string;
  /** New-session mode: pre-generated id so the new transcript id is known up front. */
  sessionId?: string;
  model?: string;
  permissionMode: PermissionMode;
  canUseTool: CanUseTool;
  env: Record<string, string | undefined>;
}

// `ToolActivity` and `ChatTurnSummary` live in the shared module (single
// definition for main and renderer); re-exported so existing importers keep
// working unchanged.
export type { ToolActivity, ChatTurnSummary } from '../shared/chat-types';

export interface ChatCallbacks {
  /** Fired with the session id as soon as the SDK reports it (init message). */
  onStarted: (sessionId: string) => void;
  /** Fired with each live text delta (partial assistant message). */
  onChunk: (text: string) => void;
  /** Fired when the model starts generating a tool call's input
   *  (`content_block_start`, elapsedSeconds null) and periodically while the
   *  tool runs (`tool_progress`, elapsedSeconds set). The renderer clears the
   *  indicator when the tool's result lands or the turn ends. */
  onToolActivity: (activity: ToolActivity) => void;
  /** Fired with each fully-formed chat message as the SDK emits it during the
   *  turn (a completed assistant message, or a tool_result-bearing user message).
   *  Lets the renderer build the live turn — tools and all — straight from the
   *  stream, without re-reading the partially-written transcript from disk. */
  onMessage: (message: ChatMessage) => void;
  /** Fired with an error message (result.is_error, or a thrown failure). */
  onError: (message: string) => void;
  /** Fired at the end of each turn (the SDK's `result` message), carrying the
   *  turn's cost/token/model summary read straight from that message. Unlike the
   *  old one-shot `onDone`, the session stays alive — this just means the
   *  in-flight turn finished and the composer can re-enable. */
  onTurnEnd: (summary: ChatTurnSummary) => void;
  /** Fired once when the whole session ends (generator closed, aborted, or a
   *  fatal stream error) — the persistent `query()` is gone. */
  onClosed: () => void;
}

// A long-lived chat session backed by a single streaming-input `query()`. The
// `prompt` is a push-generator (`input()`): each `send()` enqueues a user message
// and wakes the generator, so successive turns ride the SAME query — the session
// context stays warm and the SDK's control requests (interrupt / setModel /
// setPermissionMode) are available. The consume loop translates the SDK message
// stream into the flat callbacks the IPC layer forwards to the renderer.
export class ChatSession {
  /** The resolved session id (the resumed id, or the pre-generated new id). The
   *  main process matches an incoming send to a live session by this id. */
  readonly sessionId: string;

  private queue: SdkUserMessage[] = [];
  // Resolver for the generator's current await — called by `wake()` to release it
  // when a message is enqueued or the session is closed.
  private wakeUp: (() => void) | null = null;
  private closed = false;
  private readonly abort = new AbortController();
  private query: SdkQuery | null = null;
  private model?: string;
  private permissionMode: PermissionMode;
  // Whether the current turn has produced an assistant message yet. Local slash
  // commands (/context, /usage, …) run with no model turn and ride their output
  // on the `result` message — we only surface that when no assistant turn ran, so
  // a normal reply isn't echoed twice. Reset at the end of every turn.
  private sawAssistant = false;

  constructor(params: ChatSessionParams, cb: ChatCallbacks) {
    this.sessionId = params.resume ?? params.sessionId ?? randomUUID();
    this.model = params.model;
    this.permissionMode = params.permissionMode;
    // Kick off the consume loop; it pulls the first enqueued message as soon as
    // the SDK starts reading the generator. Not awaited — it runs for the whole
    // session lifetime.
    void this.consume(params, cb);
  }

  // The streaming-input source. Yields queued user messages, then parks on a
  // promise until `wake()` releases it (a new send, or close). Returning ends the
  // SDK query.
  private async *input(): AsyncGenerator<SdkUserMessage> {
    while (true) {
      while (this.queue.length > 0) yield this.queue.shift()!;
      if (this.closed) return;
      await new Promise<void>(resolve => {
        this.wakeUp = resolve;
      });
    }
  }

  private wake(): void {
    const resolve = this.wakeUp;
    this.wakeUp = null;
    resolve?.();
  }

  /** Queue a user message for the next turn. Safe to call between turns; while a
   *  turn is in flight the SDK processes it after the current one (queued input). */
  send(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    } as SdkUserMessage);
    this.wake();
  }

  /** Switch the model for subsequent turns (a no-op if unchanged). */
  async setModel(model?: string): Promise<void> {
    if (model === this.model) return;
    this.model = model;
    await this.query?.setModel(model);
  }

  /** Switch the permission mode for subsequent turns (a no-op if unchanged). */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (mode === this.permissionMode) return;
    this.permissionMode = mode;
    await this.query?.setPermissionMode(mode);
  }

  /** Stop the in-flight turn but keep the session alive (the SDK emits a `result`,
   *  so the turn ends cleanly and the user can keep chatting). */
  async interrupt(): Promise<void> {
    await this.query?.interrupt();
  }

  /** Tear the session down for good: close the generator and abort the query. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.abort.abort();
    this.wake();
  }

  private async consume(params: ChatSessionParams, cb: ChatCallbacks): Promise<void> {
    let started = false;
    try {
      const sdk = await loadSdk();
      this.query = sdk.query({
        prompt: this.input(),
        options: {
          cwd: params.cwd,
          ...(params.resume && { resume: params.resume }),
          forkSession: false,
          ...(params.sessionId && { sessionId: params.sessionId }),
          ...(this.model && { model: this.model }),
          permissionMode: this.permissionMode,
          includePartialMessages: true,
          canUseTool: params.canUseTool,
          abortController: this.abort,
          env: params.env,
          ...(claudeExecutable && { pathToClaudeCodeExecutable: claudeExecutable }),
        },
      });

      for await (const msg of this.query) {
        // The init message is the first to carry the resolved session id.
        if (!started && msg.type === 'system' && msg.subtype === 'init') {
          started = true;
          cb.onStarted(msg.session_id);
          continue;
        }
        // Sub-agent traffic (Task dispatch forwarded into the main stream): the
        // live turn renders the main conversation only, matching the persisted
        // transcript that skips sidechain lines.
        if (isSubagentTraffic(msg)) continue;
        // Live text deltas (only present with includePartialMessages).
        if (msg.type === 'stream_event') {
          const event = msg.event;
          if (
            event?.type === 'content_block_delta' &&
            event.delta?.type === 'text_delta' &&
            event.delta.text
          ) {
            cb.onChunk(event.delta.text);
          } else if (
            event?.type === 'content_block_start' &&
            event.content_block?.type === 'tool_use'
          ) {
            // The model began writing a tool call's input — text deltas stop
            // here, so surface a "using tool" indicator until the result lands.
            cb.onToolActivity({ toolName: event.content_block.name, elapsedSeconds: null });
          }
          continue;
        }
        // Execution heartbeat for a long-running tool (slow Bash, a Task
        // sub-agent, …) — keeps the indicator alive with the elapsed time.
        if (msg.type === 'tool_progress') {
          cb.onToolActivity({
            toolName: msg.tool_name,
            elapsedSeconds: msg.elapsed_time_seconds,
          });
          continue;
        }
        // Fully-formed messages: a completed assistant turn, or a user message
        // carrying tool_results. We skip the user message that merely echoes the
        // prompt we just sent (it has no tool_result blocks) — the renderer already
        // shows that optimistically, and forwarding it would double the bubble.
        if (msg.type === 'assistant' || msg.type === 'user') {
          const mapped = mapSdkMessageToChat(msg as Parameters<typeof mapSdkMessageToChat>[0]);
          if (mapped && !isPromptEcho(mapped)) {
            if (mapped.role === 'assistant') this.sawAssistant = true;
            cb.onMessage(mapped);
          }
          continue;
        }
        // `/compact` emits no assistant turn — just a boundary event. Surface a
        // short note so the command visibly did something.
        if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
          cb.onMessage(
            noteMessage(
              compactBoundaryNote(msg.compact_metadata?.pre_tokens, msg.compact_metadata?.trigger)
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
          } else if (!this.sawAssistant && msg.subtype === 'success' && msg.result?.trim()) {
            // A local slash command (/context, /usage, …) returned text directly
            // with no model turn — surface it as an assistant note.
            cb.onMessage(noteMessage(msg.result));
          }
          // End of a turn — not the session. Re-enable the composer and reset the
          // per-turn flag so the next turn starts clean; the query stays alive
          // waiting on the generator for the next send.
          this.sawAssistant = false;
          cb.onTurnEnd(summarizeResult(msg));
        }
      }
    } catch (e) {
      // An abort is a deliberate teardown (dispose), not a failure to report.
      if (!this.abort.signal.aborted) {
        cb.onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      this.closed = true;
      cb.onClosed();
    }
  }
}
