// A fake `window.electronAPI` for renderer tests.
//
// The renderer talks to the main process through exactly one object, injected by
// the preload bridge (`electron/preload.ts`). That single seam is what makes the
// renderer testable without Electron: install a stand-in here and every hook and
// component that reaches for `window.electronAPI` runs unmodified, in jsdom, with
// no `~/.claude` on disk and no IPC.
//
// Two kinds of members, mirroring the real bridge:
//   - request/response methods → `vi.fn()` returning the `{ data, error }`
//     envelope every handler answers with, so a test can assert what the renderer
//     asked for and script what it gets back;
//   - event channels (`on*`) → a `Channel`, which hands back an unsubscribe
//     disposer exactly like the preload `subscribe()` helper. A test drives the
//     renderer by calling `channels.<name>.emit(payload)`.
//
// `Channel.listenerCount` is deliberately exposed: a subscription that outlives
// the component that made it is a real leak class here (the chat channels are
// subscribed mount-only), and it is only observable from this side.
//
// The surface is intentionally partial — it covers what the tests under `test/`
// actually exercise, not all 83 channels. Widen it as tests reach further; the
// cast in `installFakeElectronAPI` is the one place that concession is made.

import { vi } from 'vitest';
import type {
  ChatChunkEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatMessageEvent,
  ChatToolActivityEvent,
  PermissionRequest,
} from '../../electron/shared/chat-types';
import type {
  ActiveSession,
  BgSession,
  EffectiveConfig,
  SessionActivity,
  PurgePlan,
} from '../../src/types';
import type { DerivedDescription } from '../../src/hooks/useIPC';

/** The envelope every IPC handler returns (`electron/main.ts`). */
type IpcResult<T> = { data: T | null; error: string | null };

export const ok = <T>(data: T): IpcResult<T> => ({ data, error: null });
export const fail = <T = never>(error: string): IpcResult<T> => ({ data: null, error });

/** A purge plan with nothing in it — the default answer, overridden per test. */
export const emptyPurgePlan = (over: Partial<PurgePlan> = {}): PurgePlan => ({
  projectPath: null,
  items: [],
  notes: [],
  totalItems: null,
  raw: '',
  ...over,
});

/** One `on*` channel: subscribe returns a disposer, like the preload bridge. */
export class Channel<T> {
  private listeners = new Set<(payload: T) => void>();

  /** Matches the preload signature: `(cb) => unsubscribe`. */
  readonly subscribe = (cb: (payload: T) => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  /** Deliver an event to every current subscriber. */
  emit(payload: T): void {
    // Copy first: a listener may unsubscribe while we iterate.
    for (const cb of [...this.listeners]) cb(payload);
  }

  /** Live subscriptions — asserts that cleanup actually ran. */
  get listenerCount(): number {
    return this.listeners.size;
  }
}

export function createChannels() {
  return {
    chatStarted: new Channel<string>(),
    chatChunk: new Channel<ChatChunkEvent>(),
    chatToolActivity: new Channel<ChatToolActivityEvent>(),
    chatMessage: new Channel<ChatMessageEvent>(),
    chatDone: new Channel<ChatDoneEvent>(),
    chatError: new Channel<ChatErrorEvent>(),
    permissionRequest: new Channel<PermissionRequest>(),
    /** `data:changed` — the watcher event, payload = affected scopes (or null). */
    dataChanged: new Channel<unknown>(),
    /** `live:activeSessions` — the session registry, pushed on status transitions. */
    activeSessions: new Channel<ActiveSession[]>(),
    /** `live:sessionActivity` — the Monitor's tail digests, pushed per append burst. */
    sessionActivity: new Channel<SessionActivity[]>(),
    /** `live:bgSessions` — background agents (jobs + daemon roster). */
    bgSessions: new Channel<BgSession[]>(),
  };
}

export type FakeChannels = ReturnType<typeof createChannels>;

export function createFakeElectronAPI(channels: FakeChannels) {
  const sessions = {
    getChat: vi.fn(async (_hash: string, _filename: string) => ok<ChatMessage[]>([])),
    startMessage: vi.fn(
      async (_realPath: string, _message: string, _model?: string, _permissionMode?: string) =>
        ok(null)
    ),
    sendMessage: vi.fn(
      async (
        _realPath: string,
        _sessionId: string,
        _message: string,
        _model?: string,
        _permissionMode?: string
      ) => ok(null)
    ),
    stopMessage: vi.fn(async () => ok(null)),
    endChat: vi.fn(async () => ok(null)),
    respondPermission: vi.fn(async (_requestId: string, _decision: unknown) => ok(null)),

    onChatStarted: channels.chatStarted.subscribe,
    onChatChunk: channels.chatChunk.subscribe,
    onChatToolActivity: channels.chatToolActivity.subscribe,
    onChatMessage: channels.chatMessage.subscribe,
    onChatDone: channels.chatDone.subscribe,
    onChatError: channels.chatError.subscribe,
    onPermissionRequest: channels.permissionRequest.subscribe,
  };

  const telemetry = {
    track: vi.fn(async (_name: string, _props?: Record<string, string | number>) => ok(null)),
    trackError: vi.fn(
      async (
        _error: { name?: string; message: string; stack?: string },
        _kind?: 'crash' | 'unhandled' | 'handled',
        _severity?: 'fatal' | 'error'
      ) => ok(null)
    ),
  };

  // `claudeCodeVersion` is `claude --version` asked to the CLI on PATH — NOT the
  // SDK handshake's `claude_code_version`, which reports the CLI bundled with the
  // shipped Agent SDK. Settings and the launch notice both read this one.
  const updates = {
    claudeCodeVersion: vi.fn(async () => ok<{ version: string | null }>({ version: null })),
  };

  // Project deletion is delegated to `claude project purge`: `planPurge` is the
  // `--dry-run` plan the confirmation dialog shows, `purge` the execution.
  // `getDescription` is the read-only derivation from the project's CLAUDE.md —
  // there is no writer counterpart on purpose: an edited description is stored
  // in the prefs, never back into that file.
  const projects = {
    getDescription: vi.fn(async (_realPath: string) => ok<DerivedDescription | null>(null)),
    planPurge: vi.fn(async (_hash: string) => ok(emptyPurgePlan())),
    purge: vi.fn(async (_hash: string) => ok({ output: '' })),
  };

  // The effective config, resolved through the Agent SDK. `null` data is a real
  // answer, not a test shortcut — the SDK may not be reachable — and every view
  // that reads it renders around that case.
  const config = {
    getEffective: vi.fn(async (_cwd?: string) => ok<EffectiveConfig | null>(null)),
  };

  const prefs = {
    getAll: vi.fn(async () => ok<Record<string, unknown>>({})),
    set: vi.fn(async (_key: string, _value: unknown) => ok(null)),
  };

  // The Monitor joins two of these by sessionId: the registry says busy/waiting,
  // `getActivity` says at what. They are separate channels in the real bridge for
  // the same reason they are separate here — neither is derived from the other.
  const live = {
    getActiveSessions: vi.fn(async () => ok<ActiveSession[]>([])),
    onActiveSessionsChanged: channels.activeSessions.subscribe,
    getActivity: vi.fn(async () => ok<SessionActivity[]>([])),
    onSessionActivityChanged: channels.sessionActivity.subscribe,
    getSessions: vi.fn(async () => ok<BgSession[]>([])),
    onBgSessionsChanged: channels.bgSessions.subscribe,
  };

  const memory = {
    listProjects: vi.fn(async () => ok<Array<{ hash: string; realPath: string }>>([])),
  };

  return {
    sessions,
    telemetry,
    updates,
    projects,
    config,
    prefs,
    live,
    memory,
    onDataChanged: channels.dataChanged.subscribe,
  };
}

export type FakeElectronAPI = ReturnType<typeof createFakeElectronAPI>;

export interface FakeBridge {
  api: FakeElectronAPI;
  channels: FakeChannels;
  /** Remove the stand-in — call from `afterEach` so tests can't leak into each other. */
  restore: () => void;
}

/**
 * Install a fresh fake bridge on `window.electronAPI` and return the handles a
 * test drives it with. Call once per test; `restore()` in `afterEach`.
 */
export function installFakeElectronAPI(): FakeBridge {
  const channels = createChannels();
  const api = createFakeElectronAPI(channels);

  // The real `window.electronAPI` is the full 83-channel bridge; this fake covers
  // the slice under test, so the assignment is cast. Keeping the cast here — at
  // the single install point — is what lets the tests themselves stay typed.
  const w = window as unknown as { electronAPI?: unknown };
  const previous = w.electronAPI;
  w.electronAPI = api;

  return {
    api,
    channels,
    restore: () => {
      w.electronAPI = previous;
    },
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let uuidCounter = 0;

/** A minimal assistant message, as the stream emits it. */
export function assistantMessage(text: string, uuid?: string): ChatMessage {
  return {
    uuid: uuid ?? `assistant-${++uuidCounter}`,
    role: 'assistant',
    timestamp: new Date(0).toISOString(),
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text }],
  };
}

/** A user message carrying a tool result — what the SDK emits when a tool ends. */
export function toolResultMessage(toolUseId: string, content: string, uuid?: string): ChatMessage {
  return {
    uuid: uuid ?? `tool-result-${++uuidCounter}`,
    role: 'user',
    timestamp: new Date(0).toISOString(),
    content: [{ type: 'tool_result', toolUseId, content, isError: false }],
  };
}

/** A tool-approval request as `canUseTool` forwards it. */
export function permissionRequest(
  requestId: string,
  sessionId: string,
  overrides: Partial<PermissionRequest> = {}
): PermissionRequest {
  return {
    requestId,
    sessionId,
    toolName: 'Bash',
    input: { command: 'ls' },
    toolUseID: `tool-use-${requestId}`,
    ...overrides,
  };
}
