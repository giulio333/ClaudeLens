// Tipi condivisi tra renderer e IPC hooks

export interface MemoryTopic {
  name: string
  description: string
  type: 'user' | 'feedback' | 'project' | 'reference'
  filename: string
  createdAt: string
  updatedAt: string
  isProjectLevel?: boolean
}

export interface TopicInput {
  name: string
  description: string
  type: 'user' | 'feedback' | 'project' | 'reference'
  content: string
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
}
