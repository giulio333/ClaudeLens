import { ClaudeMdLayer, SessionSummary, MemoryTopic, Skill, Agent } from '../../hooks/useIPC'

export type View =
  | { type: 'global-home' }
  | { type: 'overview' }
  | { type: 'global-claudemd' }
  | { type: 'global-skills' }
  | { type: 'skill-detail'; skill: Skill }
  | { type: 'global-agents' }
  | { type: 'agent-detail'; agent: Agent }
  | { type: 'global-mcp' }
  | { type: 'project-skills'; project: { hash: string; realPath: string } }
  | { type: 'project-agents'; project: { hash: string; realPath: string } }
  | { type: 'project-claudemd'; project: { hash: string; realPath: string }; layer: ClaudeMdLayer }
  | { type: 'project-memory'; project: { hash: string; realPath: string } }
  | { type: 'sessions'; project: { hash: string; realPath: string } }
  | { type: 'analytics'; project: { hash: string; realPath: string } }
  | { type: 'chat'; project: { hash: string; realPath: string }; session: SessionSummary }
  | { type: 'memory-topic'; topic: MemoryTopic; content: string }
  | { type: 'ai-assistant'; project: { hash: string; realPath: string } }
  | { type: 'live-monitor'; project: { hash: string; realPath: string } }

export const TYPE_STYLES: Record<string, string> = {
  user:      'bg-blue-950/20 text-blue-400 ring-1 ring-blue-700/30',
  feedback:  'bg-amber-950/20 text-amber-400 ring-1 ring-amber-700/30',
  project:   'bg-emerald-950/20 text-emerald-400 ring-1 ring-emerald-700/30',
  reference: 'bg-violet-950/20 text-violet-400 ring-1 ring-violet-700/30',
}

export const SCOPE_STYLES: Record<string, string> = {
  global:  'bg-blue-950/20 text-blue-400 ring-1 ring-blue-700/30',
  project: 'bg-emerald-950/20 text-emerald-400 ring-1 ring-emerald-700/30',
  local:   'bg-amber-950/20 text-amber-400 ring-1 ring-amber-700/30',
  subdir:  'bg-violet-950/20 text-violet-400 ring-1 ring-violet-700/30',
}
