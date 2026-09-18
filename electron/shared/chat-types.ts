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
  | {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      isError: boolean;
      /** Files the command edited, when Claude Code recorded them (Bash only). */
      bashEditDiff?: BashEditDiff;
      /** The page an `Artifact` publish produced, when Claude Code recorded it. */
      artifact?: ArtifactPublish;
    }
  | AdvisorConsult;

/** What a shell command changed on disk, as Claude Code records it on the
 *  result row (`toolUseResult.bashEditDiff`).
 *
 *  An edit made from Bash — `sed -i`, a heredoc, a one-line script — produces
 *  no `Edit` tool call, so without this the transcript shows a command and its
 *  stdout and nothing at all about the files it rewrote (#265). */
export interface BashEditDiff {
  files: BashEditFile[];
  /** Every path the command touched, including the ones `files` omits. */
  changedFiles: string[];
  /** How many changed files are not in `files`, which Claude Code caps. */
  moreFiles: number;
  /** Claude Code could not produce the diff; `files` is then empty and saying
   *  so is the point — an empty list would read as "nothing changed". */
  unavailable?: boolean;
}

export interface BashEditFile {
  filePath: string;
  hunks: BashEditHunk[];
  /** The file did not exist before / does not exist after. Marked rather than
   *  printed: a created file's hunk is the whole file. */
  created?: boolean;
  deleted?: boolean;
}

/** A page published by the `Artifact` tool, as Claude Code records it on the
 *  result row (`toolUseResult`).
 *
 *  The tool is a recurring species in these transcripts, and without this the
 *  publish reads as a generic tool call: the page's title, its link and which
 *  version this was all sit inside a kilobyte of prose about live
 *  subscriptions, and the URL is text rather than a link. Every field here is
 *  one Claude Code already writes — nothing is recovered from that prose. */
export interface ArtifactPublish {
  /** The artifact's own id: stable across every publish to the same page. */
  id: string;
  url: string;
  title: string;
  /** `false` on the publish that created the page, `true` on a republish. */
  updated: boolean;
  /** Which version of the page this publish produced, counting from 1 — the
   *  `(Version N)` of the result prose, on all eight rows that carry both.
   *  Absent on transcripts written before Claude Code recorded it, and then no
   *  version is shown rather than one guessed from the publishes we can see. */
  seq?: number;
  /** `owner`: nobody but the owner can open the page yet. `users`: it is shared. */
  audience?: string;
  /** The local file that was published. It lives in the session scratchpad,
   *  which is reaped within a day or so — so it names the source, never a file
   *  the app can still expect to read. */
  path?: string;
  /** The word chosen for the page's browser-tab icon; first publish only. */
  icon?: string;
}

/** One unified-diff hunk: the `@@ -oldStart,oldLines +newStart,newLines @@`
 *  header and its lines, each still carrying its `+`/`-`/space prefix. */
export interface BashEditHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/** A consult of the harness's `advisor` tool — a stronger reviewer model that
 *  reads the whole conversation and answers back to Claude, not to the user.
 *  The transcript records it as two blocks of the same assistant message: a
 *  `server_tool_use` (name `advisor`, empty input) and an `advisor_tool_result`
 *  whose payload is `advisor_redacted_result` — an `encrypted_content` string.
 *  So the advice itself can never be shown; what we can show is that a consult
 *  happened, how long it took, and what it cost. */
export interface AdvisorConsult {
  type: 'advisor';
  /** `tool_use_id` of the consult (`srvtoolu_…`) — pairs the two blocks. */
  id: string;
  /** Reviewer model, from the `advisor_message` iteration of the turn's usage. */
  model?: string;
  /** The reviewer's own token spend. Absent when the turn holds more than one
   *  consult: the usage object is repeated verbatim on every row of the
   *  assistant message, so the pair's total cannot be split between them. */
  inputTokens?: number;
  outputTokens?: number;
  /** Wall time between the two blocks' rows. Absent on the live stream, where
   *  the messages are mapped one at a time. */
  durationSeconds?: number;
}

/** Message-level token usage (assistant turns only). `input + cacheRead +
 *  cacheWrite` of the latest turn ≈ the current context-window occupancy. */
export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Who sent a message this session did not type: another Claude Code session on
 *  this machine, or an agent running inside this one. Claude Code writes both
 *  as `origin.kind: "peer"` on the delivered row, so `from` is derived rather
 *  than copied — a session is identified by a unix socket and a pid the
 *  receiver verified off it, an agent by the task id of its dispatch. */
export interface InboundOrigin {
  from: 'session' | 'agent';
  /** Display name the sender carried at send time. Sender-supplied, and a
   *  background session renames itself as soon as it has a topic, so this
   *  labels the message and never identifies the sender. */
  name?: string;
  /** Pid the receiver verified off the socket — sessions only, and the only
   *  part of the sender's identity that was checked rather than claimed. */
  pid?: number;
  /** Equal to the `msg_id` the sender's `SendMessage` result carries in its own
   *  transcript: the one join between the two halves of a message. */
  msgId?: string;
  /** Session fingerprints the exchange has already passed through — absent on a
   *  message that opens a chain, one entry longer on each reply. */
  hopChain?: string[];
  /** The message reached a session that was mid-turn, so Claude Code queued it
   *  and the running turn absorbed it. */
  queued?: true;
}

/** A line the harness put in the transcript that is not conversation: a peer
 *  session that went idle, an agent that finished, a turn resumed after a usage
 *  limit. Drawn as a one-line marker — it explains why a turn happened, and it
 *  is not something anyone said.
 *
 *  A finished background task is NOT here: `parseTaskNotification` already
 *  turns `<task-notification>` into its own card, and a second mechanism for
 *  the same row would render it twice. */
export interface SessionNotice {
  kind: 'session-idle' | 'agent-idle' | 'auto-continuation';
  /** What the notice is about: a task id, a session or agent name. */
  subject?: string;
  /** One readable line, taken from the payload's own words. */
  text: string;
}

export interface ChatMessage {
  uuid: string;
  role: 'user' | 'assistant';
  timestamp: string;
  model?: string;
  content: ChatContentBlock[];
  usage?: MessageUsage;
  /** Typed while a turn was already running, and absorbed into it. Claude Code
   *  keeps such a message ONLY in the transcript's `queue-operation` rows, so it
   *  reaches the renderer through `transcript-extras`, not through the SDK read
   *  (#245). Shown as a normal user message wearing a "sent mid-turn" chip. */
  queued?: true;
  /** Base directory of the skill this user message expanded into — recovered
   *  from the `isMeta` expansion row the SDK read drops. Present only on the
   *  `<command-name>`/`tool_result` row that invoked a skill, and it is what
   *  tells a `/foo` skill apart from a built-in command (#246). */
  skillPath?: string;
  /** Set when the message came from another session, or from an agent inside
   *  this one, instead of from the user. Claude Code delivers it as an `isMeta`
   *  user row (receiver idle) or as a `queued_command` attachment (receiver
   *  mid-turn) — the SDK read returns neither, so it arrives through
   *  `transcript-extras`, like `queued` and `skillPath` (#274). */
  inbound?: InboundOrigin;
  /** Set when the row is a harness notice rather than a message. Mutually
   *  exclusive with `inbound`: nobody said it. */
  notice?: SessionNotice;
  /** Reasoning effort the turn ran at (`medium` | `high` | `xhigh` | `max`).
   *  Claude Code writes it on the transcript ROW, next to `uuid`, not inside
   *  `message` — so the SDK read never returns it and it arrives through
   *  `transcript-extras`, like `queued` and `skillPath`. A row's own
   *  `perTurnEffort` wins over the session-level `effort` when set. */
  effort?: string;
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

// ─── Stream event envelopes (`sessions:chat*` channels) ──────────────────────
// Every stream event carries the id of the session that produced it. The main
// process runs one ChatSession at a time today, but that is a convention, not
// a guarantee the channels encode — tagging the envelopes lets the renderer
// drop stale events from a superseded session (and keeps the door open for
// multiple concurrent chats) instead of trusting arrival order.

/** `sessions:chatChunk` — a live assistant text delta. */
export interface ChatChunkEvent {
  sessionId: string;
  text: string;
}

/** `sessions:chatToolActivity` — the tool being prepared or executed. */
export interface ChatToolActivityEvent {
  sessionId: string;
  activity: ToolActivity;
}

/** `sessions:chatMessage` — a fully-formed message emitted during the turn. */
export interface ChatMessageEvent {
  sessionId: string;
  message: ChatMessage;
}

/** `sessions:chatDone` — the turn ended. `summary` is absent when the query
 *  died without a result (fatal stream error). */
export interface ChatDoneEvent {
  sessionId: string;
  summary?: ChatTurnSummary;
}

/** `sessions:chatError` — a turn-level failure. */
export interface ChatErrorEvent {
  sessionId: string;
  error: string;
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
  /** The chat session the approval belongs to ('' if it raced a teardown). */
  sessionId: string;
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
