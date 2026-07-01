// Chat types shared between the Electron main process and the renderer.
//
// The two tsconfigs can't import across their roots (`tsconfig.electron.json`
// has `rootDir: "electron"`, the renderer includes only `src/`), so these
// shapes used to be defined twice — once in `electron/modules/*` and once,
// hand-mirrored, in `src/types.ts` — with nothing catching drift between the
// copies. This module is the single definition: it lives under `electron/` to
// satisfy the main build's rootDir, and `src/types.ts` re-exports it for the
// renderer (a type-only import, erased at build time, so neither bundle gains
// runtime code from the other side).
//
// Keep this file type-only: no imports, no values. It is compiled under both
// module systems (CommonJS main, ESNext renderer) and must stay inert.

export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean };

/** Message-level token usage (assistant turns only). `input + cacheRead +
 *  cacheWrite` of the latest turn ≈ the current context-window occupancy. */
export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatMessage {
  uuid: string;
  role: 'user' | 'assistant';
  timestamp: string;
  model?: string;
  content: ChatContentBlock[];
  usage?: MessageUsage;
}

/** Live tool indicator for the in-flight turn (`sessions:chatToolActivity`):
 *  emitted when the model starts writing a tool call's input (elapsedSeconds
 *  null) and periodically while the tool runs (elapsedSeconds set, from the
 *  SDK's `tool_progress`). */
export interface ToolActivity {
  toolName: string;
  elapsedSeconds: number | null;
}

/** End-of-turn metadata for the in-app SDK chat, derived from the SDK's
 *  `result` message (NOT from disk) and carried on `sessions:chatDone`. Cost
 *  and token counts are cumulative for the session (the SDK reports session
 *  totals on each result). */
export interface ChatTurnSummary {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  numTurns: number;
  /** Models used so far (the keys of the SDK's `modelUsage`). */
  models: string[];
}

/** A `PermissionUpdate` suggestion from the SDK — the rule(s) to persist when
 *  the user picks "Always allow". Shape is opaque to the renderer; it
 *  round-trips back to the SDK verbatim, so it stays loosely typed here. */
export type PermissionSuggestion = Record<string, unknown>;

/** A tool-approval request forwarded from the main process (`canUseTool`). The
 *  renderer renders an Allow / Always / Deny dialog and answers with
 *  `respondPermission(requestId, decision)`. */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  /** Full prompt sentence from the bridge (e.g. "Claude wants to read foo.txt"). */
  title?: string;
  /** Short noun phrase for the action (e.g. "Read file"). */
  displayName?: string;
  /** Human-readable subtitle. */
  description?: string;
  /** The tool input (e.g. `{ command }` for Bash). */
  input: Record<string, unknown>;
  /** Permission rules to persist on "Always allow". */
  suggestions?: PermissionSuggestion[];
  /** Path that triggered the request, when applicable. */
  blockedPath?: string;
  /** Why the request was triggered. */
  decisionReason?: string;
  toolUseID: string;
}

/** The renderer's verdict on a `PermissionRequest`, returned to the SDK. */
export type PermissionDecision =
  | { kind: 'allow'; input: Record<string, unknown> }
  | { kind: 'always'; input: Record<string, unknown>; suggestions?: PermissionSuggestion[] }
  | { kind: 'deny'; message?: string };
