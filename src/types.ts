// Tipi condivisi tra renderer e IPC hooks

export interface MemoryTopic {
  name: string
  description: string
  type: 'user' | 'feedback' | 'project' | 'reference'
  filename: string
  createdAt: string
  updatedAt: string
  isProjectLevel?: boolean
  originSessionId?: string
}

export interface TopicInput {
  name: string
  description: string
  type: 'user' | 'feedback' | 'project' | 'reference'
  content: string
  originSessionId?: string
}

export interface MemoryData {
  index: MemoryTopic[]
  topics: Record<string, string>
  memoryMd: { content: string; lineCount: number } | null
  projectLevelIndex: MemoryTopic[]
  projectLevelTopics: Record<string, string>
  projectLevelMemoryMd: { content: string; lineCount: number } | null
}

export interface ProjectCost {
  project: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  sessionsCount: number
}

export interface PricingMeta {
  /** ISO date (YYYY-MM-DD) the pricing table was last verified. */
  lastUpdated: string
  /** Model IDs priced exactly; anything else is an estimate (fuzzy/default). */
  knownModels: string[]
}

export interface ClaudeMdLayer {
  scope: 'global' | 'project' | 'local' | 'subdir'
  filePath: string
  content: string
}

export interface ClaudeMdHierarchy {
  layers: ClaudeMdLayer[]
}

export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }

export interface ChatMessage {
  uuid: string
  role: 'user' | 'assistant'
  timestamp: string
  model?: string
  content: ChatContentBlock[]
}

// Metadati di un subagent eseguito durante una sessione (transcript interno in
// `{sessionId}/subagents/agent-*.jsonl`). `firstPrompt` è la chiave con cui il
// renderer correla il subagente al suo `Task`/`Agent` tool_use nella chat.
export interface SubagentMeta {
  agentId: string
  filePath: string
  firstPrompt: string
  startedAt: string
  endedAt: string
  messageCount: number
}

export interface SessionSummary {
  filename: string
  date: string
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  totalTokens: number
  estimatedCost: number
  messageCount: number
  model?: string
  models: Record<string, number>
  customTitle?: string
  aiTitle?: string
  firstUserMessage?: string
  template?: string
}

export interface ExportSaveResult {
  canceled: boolean
  filePath: string | null
}

export type ArtifactKind = 'session' | 'subagents' | 'tasks' | 'plan'

export interface SessionArtifact {
  kind: ArtifactKind
  label: string
  path: string
  isDir: boolean
  count?: number
  locked?: boolean
  shared?: boolean
  referencedBy?: number
  defaultSelected: boolean
}

export interface SessionArtifacts {
  sessionId: string
  artifacts: SessionArtifact[]
}

export interface DeleteSessionResult {
  deleted: string[]
  warnings: string[]
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface Task {
  id: string
  subject: string
  description: string
  status: TaskStatus
  blocks: string[]
  blockedBy: string[]
  activeForm?: string
}

export interface TaskGroup {
  sessionId: string
  filename: string
  tasks: Task[]
}

export type PlanStatus = 'proposed' | 'approved'

export interface Plan {
  filePath: string
  slug: string
  title: string
  status: PlanStatus
  exists: boolean
  content: string | null
  timestamp: string
  gitBranch?: string
}

export interface PlanGroup {
  sessionId: string
  filename: string
  plans: Plan[]
}

export interface RuleFile {
  filename: string
  content: string
  paths?: string[]
}

export interface Agent {
  name: string
  path: string
  scope: 'global' | 'project'
  content: string
  rawContent: string
  /** Required frontmatter fields that are missing (e.g. ['name', 'description']). Empty = valid. */
  missingRequired: string[]
  /** True if the file name contains spaces — Claude Code requires space-free agent file names. */
  filenameHasSpaces: boolean
  description?: string
  model?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  disableModelInvocation?: boolean
  permissionMode?: string
  maxTurns?: number
  skills?: string[]
  mcpServers?: string[]
  background?: boolean
  isolation?: string
  memory?: string
  effort?: string
  color?: string
}

export interface Skill {
  name: string
  path: string
  scope: 'global' | 'project'
  content: string
  rawContent: string
  description?: string
  argumentHint?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  allowedTools?: string[]
  model?: string
  context?: string
  agent?: string
  hooks?: Record<string, unknown>
}

export interface SkillInput {
  name: string
  content: string
  description?: string
  argumentHint?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  allowedTools?: string[]
  model?: string
  context?: string
  agent?: string
}

export interface McpServer {
  name: string
  source: 'cloud' | 'local'
  command?: string
  args?: string[]
  env?: Record<string, string>
  enabledInProjects: number
  disabledInProjects: number
  disabledProjectPaths: string[]
  enabledProjectPaths: string[]
}

export interface McpData {
  cloudServers: McpServer[]
  localServers: McpServer[]
  totalProjects: number
}

export interface LiveEvent {
  id: string
  timestamp: string
  type: 'tool_use' | 'tool_result' | 'text' | 'thinking' | 'user_message' | 'status_change'
  toolName?: string
  toolInput?: Record<string, unknown>
  content?: string
  isError?: boolean
  model?: string
}

export interface ClaudeProcess {
  pid: number
  cwd: string
  cmdline: string
}

export interface BgSession {
  id: string
  sessionId: string
  name: string
  state: string
  tempo: string
  detail: string
  intent: string
  result: string | null
  cwd: string
  projectName: string
  template: string
  inFlightTasks: number
  alive: boolean
  pid: number | null
  createdAt: string
  updatedAt: string
  /** Free-text reason the worker needs human input (rate-limited, awaiting, etc.). Null when no input is needed. */
  needs: string | null
  /** True when the assistant has emitted an AskUserQuestion that hasn't been answered. */
  hasPendingQuestion: boolean
}

export interface AgentInput {
  name: string
  content: string
  description?: string
  model?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode?: string
  maxTurns?: number
  background?: boolean
  isolation?: string
  memory?: string
  skills?: string[]
  mcpServers?: string[]
  disableModelInvocation?: boolean
  effort?: string
  color?: string
}

// ─── Effective Claude Code config (read via the official Agent SDK) ───────────

/** Runtime view captured from the SDK `system/init` message. */
export interface InitInfo {
  permissionMode: string
  model: string
  cwd: string
  apiKeySource: string
  claudeCodeVersion: string
  tools: string[]
  mcpServers: { name: string; status: string }[]
  slashCommands: string[]
  outputStyle: string
  skills: string[]
  agents: string[]
  plugins: { name: string; path: string }[]
}

/** One tier of the settings cascade, with its file path when filesystem-backed. */
export interface SettingsSourceEntry {
  source: string
  path?: string
  settings: Record<string, unknown>
}

export interface EffectiveConfig {
  cwd: string
  init: InitInfo | null
  initError: string | null
  effective: Record<string, unknown>
  provenance: Record<string, { source: string; path?: string }>
  sources: SettingsSourceEntry[]
  settingsError: string | null
}
