import { ClaudeMdLayer, SessionSummary, MemoryTopic, Skill, Agent, McpServer, Plan, InstalledPlugin, ChatMessage } from '../../hooks/useIPC'

export type View =
  | { type: 'global-home' }
  | { type: 'overview' }
  | { type: 'global-claudemd' }
  | { type: 'global-skills' }
  | { type: 'skill-detail'; skill: Skill }
  | { type: 'skill-create'; project?: { hash: string; realPath: string } }
  | { type: 'global-agents' }
  | { type: 'agent-detail'; agent: Agent }
  | { type: 'agent-create'; project?: { hash: string; realPath: string } }
  | { type: 'global-mcp' }
  | { type: 'mcp-detail'; server: McpServer; totalProjects: number }
  | { type: 'plugins' }
  | { type: 'plugin-detail'; plugin: InstalledPlugin }
  | { type: 'project-skills'; project: { hash: string; realPath: string } }
  | { type: 'project-agents'; project: { hash: string; realPath: string } }
  | { type: 'project-mcp'; project: { hash: string; realPath: string } }
  | { type: 'project-tasks'; project: { hash: string; realPath: string } }
  | { type: 'project-config'; project: { hash: string; realPath: string } }
  | { type: 'project-plans'; project: { hash: string; realPath: string } }
  | { type: 'plan-detail'; project: { hash: string; realPath: string }; plan: Plan }
  | { type: 'project-claudemd'; project: { hash: string; realPath: string }; layer: ClaudeMdLayer }
  | { type: 'project-memory'; project: { hash: string; realPath: string } }
  | { type: 'sessions'; project: { hash: string; realPath: string } }
  | { type: 'analytics'; project: { hash: string; realPath: string } }
  | { type: 'chat'; project: { hash: string; realPath: string }; session: SessionSummary; from?: 'agents-live' | 'sessions'; initialMessages?: ChatMessage[] }
  | { type: 'new-chat'; project: { hash: string; realPath: string } }
  | { type: 'terminal'; project: { hash: string; realPath: string }; resumeSessionId?: string; attachJobId?: string; from?: 'agents-live' }
  | { type: 'memory-topic'; topic: MemoryTopic; content: string; hash: string }
  | { type: 'ai-assistant'; project: { hash: string; realPath: string } }
  | { type: 'live-monitor'; project: { hash: string; realPath: string } }
  | { type: 'agents-live'; project?: { hash: string; realPath: string } }
  | { type: 'duplicates' }
  | { type: 'settings' }
