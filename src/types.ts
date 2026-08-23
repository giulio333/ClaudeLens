// Tipi condivisi tra renderer e IPC hooks

export interface MemoryTopic {
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  filename: string;
  createdAt: string;
  updatedAt: string;
  isProjectLevel?: boolean;
  originSessionId?: string;
}

export interface TopicInput {
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  content: string;
  originSessionId?: string;
}

export interface MemoryData {
  index: MemoryTopic[];
  topics: Record<string, string>;
  memoryMd: { content: string; lineCount: number } | null;
  projectLevelIndex: MemoryTopic[];
  projectLevelTopics: Record<string, string>;
  projectLevelMemoryMd: { content: string; lineCount: number } | null;
}

export interface ProjectCost {
  project: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  sessionsCount: number;
}

export interface PricingMeta {
  /** ISO date (YYYY-MM-DD) the pricing table was last verified. */
  lastUpdated: string;
  /** Model IDs priced exactly; anything else is an estimate (fuzzy/default). */
  knownModels: string[];
}

export interface ClaudeMdLayer {
  scope: 'global' | 'project' | 'local' | 'subdir';
  filePath: string;
  content: string;
}

export interface ClaudeMdHierarchy {
  layers: ClaudeMdLayer[];
}

// I tipi della chat (messaggi, stream SDK, permessi) hanno una definizione
// unica condivisa col main process — vedi electron/shared/chat-types.ts.
// Ri-esportati qui così il renderer continua a importarli da './types'.
export type {
  ChatContentBlock,
  ChatMessage,
  MessageUsage,
  ToolActivity,
  ChatTurnSummary,
  ChatChunkEvent,
  ChatToolActivityEvent,
  ChatMessageEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  PermissionSuggestion,
  PermissionRequest,
  PermissionDecision,
} from '../electron/shared/chat-types';

// A normalized session-lifecycle notification pushed from the main process over
// `notifications:event`. Mirrors electron/modules/notifications/types.ts (the two
// tsconfigs don't share imports). The renderer renders it as a transient toast.
export type NotificationKind = 'needs-attention' | 'completed' | 'error';

export interface NotificationEvent {
  id: string;
  kind: NotificationKind;
  sessionId: string;
  cwd: string;
  title: string;
  body?: string;
  createdAt: number;
  source: 'registry' | 'chat';
}

// Metadati di un subagent eseguito durante una sessione (transcript interno in
// `{sessionId}/subagents/agent-*.jsonl`). `firstPrompt` è la chiave con cui il
// renderer correla il subagente al suo `Task`/`Agent` tool_use nella chat.
export interface SubagentMeta {
  agentId: string;
  filePath: string;
  firstPrompt: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
}

export interface SessionSummary {
  filename: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
  cacheSavings: number;
  messageCount: number;
  model?: string;
  models: Record<string, number>;
  customTitle?: string;
  aiTitle?: string;
  firstUserMessage?: string;
  template?: string;
}

export interface ExportSaveResult {
  canceled: boolean;
  filePath: string | null;
}

export type ArtifactKind = 'session' | 'subagents' | 'tasks' | 'plan';

export interface SessionArtifact {
  kind: ArtifactKind;
  label: string;
  path: string;
  isDir: boolean;
  count?: number;
  locked?: boolean;
  shared?: boolean;
  referencedBy?: number;
  defaultSelected: boolean;
}

export interface SessionArtifacts {
  sessionId: string;
  artifacts: SessionArtifact[];
}

/** One path the delete dialog asks for; `required` = the locked session transcript. */
export interface DeleteRequest {
  path: string;
  required?: boolean;
}

/** See `electron/modules/session-deleter.ts` — `absent` is kept apart from `deleted`. */
export type DeleteStatus = 'deleted' | 'absent' | 'refused' | 'failed';

export interface ArtifactOutcome {
  path: string;
  status: DeleteStatus;
  required: boolean;
  reason?: string;
}

export interface DeleteSessionResult {
  outcomes: ArtifactOutcome[];
  deleted: string[];
  warnings: string[];
  /** Every required path is gone — the only field the UI may read as success. */
  succeeded: boolean;
}

/** The plan from `claude project purge --dry-run` — see `electron/modules/project-purger.ts`. */
export interface PurgePlanItem {
  kind: string;
  target: string;
  detail: string;
  count: number;
  targets: string[];
}

/**
 * One project whose state a purge plan would delete. More than one of these means
 * the plan reaches beyond the project the user selected — `claude project purge`
 * acts on a path subtree, not on a project (#224) — and the purge is refused.
 */
export interface PurgePlanProject {
  hash: string;
  target: string;
  /** The real cwd, when the registry could name it. Never derived from the hash. */
  path: string | null;
  requested: boolean;
}

export interface PurgePlan {
  projectPath: string | null;
  items: PurgePlanItem[];
  projects: PurgePlanProject[];
  notes: string[];
  totalItems: number | null;
  raw: string;
}

/** Why a purge was not attempted at all. */
export type PurgeRefusal = 'multiple-projects' | 'unreadable-plan';

export type PurgeStatus = 'clean' | 'partial' | 'unknown' | 'failed' | 'refused';

/** One plan path, checked on disk after the attempt — never inferred from an exit code. */
export interface PurgePathOutcome {
  path: string;
  kind: string;
  status: 'gone' | 'remaining';
}

/**
 * The outcome of a purge. `status` is the only field the UI may read as success,
 * and only as `'clean'`: anything else means an irreversible deletion may have
 * partly happened, which is what a red timeout banner used to hide (#224).
 */
export interface PurgeResult {
  status: PurgeStatus;
  output: string;
  projects: PurgePlanProject[];
  paths: PurgePathOutcome[];
  refusal: PurgeRefusal | null;
  error: string | null;
}

/**
 * What the Live Monitor is attached to. `pending` is the state that did not
 * exist: asked for a session whose transcript has not been created yet, the
 * monitor used to fall back to the project's newest `.jsonl` and report itself
 * started — showing another session's activity under the requested one's name
 * (#194). Now an explicit session id only ever resolves to its own file.
 */
export type LiveWatchState = 'tailing' | 'pending' | 'none';

export interface LiveWatchStatus {
  state: LiveWatchState;
  sessionId: string | null;
  filePath: string | null;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  blocks: string[];
  blockedBy: string[];
  activeForm?: string;
}

export interface TaskGroup {
  sessionId: string;
  filename: string;
  tasks: Task[];
}

// 'unlinked' = markdown presente in ~/.claude/plans che nessuna sessione
// referenzia in un attachment plan_mode/plan_mode_exit (#154).
export type PlanStatus = 'proposed' | 'approved' | 'unlinked';

export interface Plan {
  filePath: string;
  slug: string;
  title: string;
  status: PlanStatus;
  exists: boolean;
  content: string | null;
  timestamp: string;
  gitBranch?: string;
}

export interface PlanGroup {
  sessionId: string;
  filename: string;
  plans: Plan[];
}

// Workflow runs of the Claude Code Workflow tool. Manually mirrored from
// electron/modules/workflows-reader.ts (the established IPC type-sync pattern).
export interface WorkflowAgentRow {
  index: number;
  label: string;
  agentId: string;
  phaseIndex: number;
  phaseTitle: string;
  model: string;
  state: string;
  attempt: number;
  startedAt?: number;
  queuedAt?: number;
  completedAt?: number;
  durationMs?: number;
  tokens?: number;
  toolCalls?: number;
  lastToolName?: string;
  lastToolSummary?: string;
  promptPreview?: string;
  resultPreview?: string;
  error?: string;
}

export interface WorkflowPhase {
  title: string;
  detail?: string;
}

export interface WorkflowRunSummary {
  runId: string;
  sessionId: string;
  workflowName: string;
  status: string;
  degraded: boolean;
  startTime: number;
  timestamp: string;
  durationMs: number;
  agentCount: number;
  errorAgentCount: number;
  phaseCount: number;
  totalTokens: number;
  totalToolCalls: number;
  args: string;
  defaultModel: string;
}

export interface WorkflowGroup {
  sessionId: string;
  filename: string;
  runs: WorkflowRunSummary[];
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  phases: WorkflowPhase[];
  agents: WorkflowAgentRow[];
  logs: string[];
  result: unknown;
  summary: string;
  script: string | null;
  scriptPath: string;
  taskId: string;
  orphanAgentIds?: string[];
}

// Agent teams (in-process teammates coordinated by a team-lead). Manually
// mirrored from electron/modules/teams-reader.ts (the established IPC
// type-sync pattern).
export interface TeamMemberTranscript {
  sessionId: string;
  filename: string;
  agentId: string;
  mtimeMs: number;
}

export interface TeamMemberInfo {
  name: string;
  color: string;
  model: string;
  description: string;
  prompt: string;
  joinedAt: number;
  planModeRequired: boolean;
  permissionMode: string;
  cwd: string;
  source: 'both' | 'config-only' | 'transcript-only';
  transcripts: TeamMemberTranscript[];
  messageCount: number;
  toolCallCount: number;
  totalTokens: number;
}

export interface TeamEvent {
  timestamp: number;
  from: string;
  to: string;
  summary: string;
  text: string;
  kind: 'dispatch' | 'message';
}

export interface TeamSummary {
  teamName: string;
  displayName: string;
  sessionId: string;
  filename: string;
  sessionIds: string[];
  createdAt: number;
  lastActivity: number;
  hasConfig: boolean;
  memberCount: number;
  memberNames: string[];
  memberColors: string[];
  transcriptCount: number;
  /** Usage tokens per member, parallel to memberNames (mtime-cached list scan). */
  memberTokens: number[];
  totalTokens: number;
  messageCount: number;
  leadSessionIdFromConfig: string | null;
}

export interface TeamDetail extends TeamSummary {
  members: TeamMemberInfo[];
  events: TeamEvent[];
  configPath: string | null;
}

export interface RuleFile {
  filename: string;
  content: string;
  paths?: string[];
}

export interface Agent {
  name: string;
  path: string;
  scope: 'global' | 'project' | 'plugin';
  content: string;
  rawContent: string;
  /** Required frontmatter fields that are missing (e.g. ['name', 'description']). Empty = valid. */
  missingRequired: string[];
  /** True if the file name contains spaces — Claude Code requires space-free agent file names. */
  filenameHasSpaces: boolean;
  description?: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  disableModelInvocation?: boolean;
  permissionMode?: string;
  maxTurns?: number;
  skills?: string[];
  mcpServers?: string[];
  background?: boolean;
  isolation?: string;
  memory?: string;
  effort?: string;
  color?: string;
}

/** Role buckets used to group a skill's supporting files in the UI. */
export type SkillFileRole = 'doc' | 'script' | 'template' | 'asset' | 'extension' | 'eval' | 'meta';

/** A supporting file bundled alongside SKILL.md (content loaded lazily). */
export interface SkillFile {
  /** Path relative to the skill directory (POSIX-style, e.g. `references/api.md`). */
  relPath: string;
  role: SkillFileRole;
  /** True when the file is linked from SKILL.md (first-class, intentional). */
  referenced: boolean;
  /** Size in bytes. */
  size: number;
  /** Editable as text in-app; false for images/binaries (preview only). */
  isText: boolean;
}

export interface Skill {
  name: string;
  path: string;
  scope: 'global' | 'project' | 'plugin';
  content: string;
  rawContent: string;
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  context?: string;
  agent?: string;
  hooks?: Record<string, unknown>;
  /** Supporting files bundled alongside SKILL.md (empty for bare skills). */
  files?: SkillFile[];
}

/** A slash command provided by a plugin (`<installPath>/commands/*.md`). */
export interface PluginCommand {
  name: string;
  path: string;
  description?: string;
  content: string;
  rawContent: string;
}

/** A plugin installed at user scope, with the components it provides. */
export interface InstalledPlugin {
  name: string;
  marketplace: string;
  scope: 'user';
  version: string;
  installPath: string;
  description?: string;
  author?: string;
  repo?: string;
  skills: Skill[];
  agents: Agent[];
  commands: PluginCommand[];
}

export interface SkillInput {
  name: string;
  content: string;
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  context?: string;
  agent?: string;
}

// ── Agent Studio ─────────────────────────────────────────────────────────────
// Manually mirrored from electron/modules/studio-compiler.ts + studio-reader.ts
// (schema model shared directly from electron/shared/studio-schema.ts)

export type {
  SchemaTypeName,
  SchemaFieldModel,
  SchemaNodeModel,
} from '../electron/shared/studio-schema';
import type { SchemaNodeModel as StudioSchemaNodeModel } from '../electron/shared/studio-schema';

export interface BlueprintInput {
  name: string;
  description?: string;
  required?: boolean;
}

export interface BlueprintBrief {
  goal: string;
  inputs: BlueprintInput[];
  expectedOutput: string;
  successCriteria: string[];
  onError: string;
}

export interface BlueprintStep {
  id: string;
  prompt: string;
  agentType?: string;
  model?: string;
  effort?: string;
  /** Verbatim JS literal for the agent() `schema` option (structured output). */
  schemaSource?: string;
  /** Editable projection of schemaSource, derived when the literal is fully static. */
  schemaModel?: StudioSchemaNodeModel;
  isolation?: string;
  /** Verbatim source of a computed label (template literal); `id` is a display fallback. */
  dynamicLabel?: string;
  /** Original variable name from a parsed script, preserved on save. */
  resultVar?: string;
  explicitPhase?: boolean;
}

export type PipelineStage =
  { kind: 'agent'; params: string; step: BlueprintStep } | { kind: 'code'; source: string };

export type BlueprintNode =
  | { kind: 'step'; step: BlueprintStep; leading?: string }
  | { kind: 'parallel'; steps: BlueprintStep[]; leading?: string }
  | {
      kind: 'pipeline';
      resultVar: string | null;
      itemsSource: string;
      stages: PipelineStage[];
      leading?: string;
    }
  | { kind: 'log'; message: string; leading?: string }
  | {
      kind: 'code';
      source: string;
      leading?: string;
      /** For a `const NAME = {schema literal}`: the binding name, for display. */
      schemaName?: string;
      /** Editable projection of the schema literal (present only when static). */
      schemaModel?: StudioSchemaNodeModel;
    };

export interface BlueprintPhase {
  title: string;
  detail?: string;
  metaExtra?: Record<string, unknown>;
  leading?: string;
  nodes: BlueprintNode[];
}

export interface Blueprint {
  header?: string;
  name: string;
  description: string;
  version: string;
  brief: BlueprintBrief;
  metaExtras?: Record<string, unknown>;
  preamble?: BlueprintNode[];
  phases: BlueprintPhase[];
  trailer?: string;
}

export interface BlueprintIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  stepId?: string;
  phaseIndex?: number;
}

export interface BlueprintSummary {
  fileName: string;
  name: string;
  description: string;
  version: string;
  phaseCount: number;
  stepCount: number;
  parallelStepCount: number;
  agentTypes: string[];
  updatedAt: string | null;
  structured: boolean;
  /** Verbatim JS nodes (code chips): 0 = fully visual, >0 = hybrid. */
  codeNodeCount: number;
  errorCount: number;
  warningCount: number;
  scope: 'global' | 'project';
  projectPath: string | null;
}

export interface BlueprintDetail {
  blueprint: Blueprint;
  fileName: string;
  scriptPath: string;
  source: string;
  structured: boolean;
  parseError: string | null;
  issues: BlueprintIssue[];
  scope: 'global' | 'project';
  projectPath: string | null;
}

export interface StudioLibrary {
  blueprints: BlueprintSummary[];
  workflowsDir: string;
}

export type McpStatus =
  | 'connected'
  | 'pending'
  | 'needs-auth'
  | 'failed'
  | 'unknown'
  /**
   * Recorded on disk but absent from the last live list. Not "removed": the
   * list Claude Code reports is volatile, so this is an observation.
   */
  | 'unlisted';

export interface McpServer {
  name: string;
  source: 'cloud' | 'local';
  /** Health reported by `claude mcp list` (the source behind `/mcp`). */
  status: McpStatus;
  live: boolean;
  needsAuth: boolean;
  /** Endpoint (cloud) or command line (local), as reported by the CLI. */
  target?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabledInProjects: number;
  disabledInProjects: number;
  disabledProjectPaths: string[];
  enabledProjectPaths: string[];
}

export interface McpData {
  cloudServers: McpServer[];
  localServers: McpServer[];
  /** Names recorded on disk that the last live list did not include. */
  unlistedServers: McpServer[];
  totalProjects: number;
  probe: { command: string; observedAt: number | null; error: string | null };
}

export interface LiveEvent {
  id: string;
  timestamp: string;
  type:
    | 'tool_use'
    | 'tool_result'
    | 'text'
    | 'thinking'
    | 'user_message'
    | 'status_change'
    | 'session_title';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  content?: string;
  isError?: boolean;
  model?: string;
  /** The `tool_use` block id, carried on the call, its result and the
   *  `<task-notification>` of a finished async agent. */
  toolUseId?: string;
}

// Mirrors electron/modules/sessions-registry-reader.ts ActiveSession.
export interface ActiveSession {
  pid: number;
  /** Empty when the entry comes from the process-scanner fallback. */
  sessionId: string;
  cwd: string;
  /** Human-readable name the CLI derives (e.g. "claudelens-b4"). */
  name?: string;
  /** 'interactive' for a terminal session. */
  kind?: string;
  startedAt?: number;
  /** Known values: 'busy', 'waiting', 'idle'. 'unknown' for fallback entries. */
  status: string;
  waitingFor?: string;
  version?: string;
  updatedAt?: number;
  /** Epoch ms of the last status transition (dates the transition INTO the
   *  current status — never proof the session is still alive). */
  statusUpdatedAt?: number;
  source: 'registry' | 'process-scan';
}

/** One mark on a session's activity trace (`electron/modules/session-tails.ts`).
 *  A tool result carries no mark of its own: it would double the call that is
 *  already on the track. */
export type TraceKind = 'tool' | 'text';

export interface TraceMark {
  at: number;
  kind: TraceKind;
  /** Which tool this was, and the one-line subject it acted on — what lets the
   *  Monitor print `Edit MonitorView.tsx` instead of an anonymous bar. Both
   *  absent on a `text` mark: prose has no name and no subject. */
  tool?: string;
  arg?: string;
  /** The call's `tool_use` id, carried only so its result can find it again. */
  id?: string;
  /** Its result came back an error. A verdict on the call, not a second event. */
  failed?: boolean;
}

/** What a live session is doing right now, folded from its transcript tail
 *  (`electron/modules/session-tails.ts`). Joined to `ActiveSession` by
 *  `sessionId` in the renderer: the registry says busy/waiting, this says at what. */
export interface SessionActivity {
  sessionId: string;
  /** The title Claude wrote for this conversation (`ai-title` in the transcript);
   *  null until one has been seen. The only human name a session has — the
   *  registry's `name` is the project plus two random characters. */
  title: string | null;
  transcriptPath: string | null;
  /** 'thinking' | 'busy' | 'idle'; null when nothing has been read yet. */
  activity: string | null;
  lastTool: { name: string; arg: string } | null;
  /** Sub-agents dispatched and not yet seen finishing. A delegating session
   *  writes nothing to its own transcript while the agent works (that goes to a
   *  sidecar the tail skips) and an async dispatch even closes the turn with
   *  `end_turn`, so without this the tail concludes "idle" about a session that
   *  is working. Names come from the dispatch's `subagent_type`. */
  delegates: { id: string; name: string; at: number }[];
  lastActivityAt: number | null;
  toolCount: number;
  errorCount: number;
  model: string | null;
  /** How full the context window is, from the newest assistant turn's prompt.
   *  A LEVEL, not a total — each turn replaces the reading. The one fact here
   *  that is only actionable while the session runs: a session at 94% is about
   *  to compact. Null until a turn with usage has been read. */
  context: { used: number; max: number } | null;
  /** Dollars this session has billed, seeded from a full parse so the figure is
   *  the session's total and not "since ClaudeLens opened". Null when unknown. */
  spend: number | null;
  /** `spend` was priced by family fallback, not an exact table entry. */
  spendEstimated: boolean;
  /** Every token this session has billed, all four kinds. */
  tokens: number;
  /** Session cwd, copied from the registry while live and retained after it
   *  ends (the registry file is gone by then), so a finished card can still say
   *  which project it belonged to. */
  cwd: string | null;
  /** Stamped marks of recent activity — the data behind the Monitor's pulse
   *  strip, and the only field that says at what RHYTHM a session works. */
  recent: TraceMark[];
  /** Epoch ms at which the session left the registry; null while live. Kept for
   *  a short window so a run that just finished is still visible. */
  endedAt: number | null;
}

export interface BgSession {
  id: string;
  sessionId: string;
  name: string;
  state: string;
  tempo: string;
  detail: string;
  intent: string;
  result: string | null;
  cwd: string;
  projectName: string;
  template: string;
  inFlightTasks: number;
  alive: boolean;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
  /** Free-text reason the worker needs human input (rate-limited, awaiting, etc.). Null when no input is needed. */
  needs: string | null;
  /** True when the assistant has emitted an AskUserQuestion that hasn't been answered. */
  hasPendingQuestion: boolean;
}

export interface AgentInput {
  name: string;
  content: string;
  description?: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  background?: boolean;
  isolation?: string;
  memory?: string;
  skills?: string[];
  mcpServers?: string[];
  disableModelInvocation?: boolean;
  effort?: string;
  color?: string;
}

// ─── Effective Claude Code config (read via the official Agent SDK) ───────────

/** Runtime view captured from the SDK `system/init` message. */
export interface InitInfo {
  permissionMode: string;
  model: string;
  cwd: string;
  apiKeySource: string;
  claudeCodeVersion: string;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  slashCommands: string[];
  outputStyle: string;
  skills: string[];
  agents: string[];
  plugins: { name: string; path: string }[];
}

/** One tier of the settings cascade, with its file path when filesystem-backed. */
export interface SettingsSourceEntry {
  source: string;
  path?: string;
  settings: Record<string, unknown>;
}

export interface EffectiveConfig {
  cwd: string;
  init: InitInfo | null;
  initError: string | null;
  effective: Record<string, unknown>;
  provenance: Record<string, { source: string; path?: string }>;
  sources: SettingsSourceEntry[];
  settingsError: string | null;
}
