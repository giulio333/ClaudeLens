import { useQuery, useMutation, useQueryClient } from 'react-query'
import { useEffect } from 'react'

import type {
  MemoryTopic,
  TopicInput,
  MemoryData,
  ProjectCost,
  ClaudeMdLayer,
  ClaudeMdHierarchy,
  ChatContentBlock,
  ChatMessage,
  SessionSummary,
  RuleFile,
  Agent,
  AgentInput,
  Skill,
  SkillInput,
  McpServer,
  McpData,
  LiveEvent,
  ClaudeProcess,
} from '../types'

// Re-export per backward compatibility — i componenti che importano i tipi da qui continuano a funzionare
export type {
  MemoryTopic,
  TopicInput,
  MemoryData,
  ProjectCost,
  ClaudeMdLayer,
  ClaudeMdHierarchy,
  ChatContentBlock,
  ChatMessage,
  SessionSummary,
  RuleFile,
  Agent,
  AgentInput,
  Skill,
  SkillInput,
  McpServer,
  McpData,
  LiveEvent,
  ClaudeProcess,
}

type IpcResult<T> = { data: T | null; error: string | null }

declare global {
  interface Window {
    electronAPI: {
      memory: {
        listProjects: () => Promise<IpcResult<Array<{ hash: string; realPath: string }>>>
        getProject: (hash: string) => Promise<IpcResult<MemoryData>>
        createTopic: (hash: string, input: TopicInput) => Promise<IpcResult<{ filename: string }>>
        updateTopic: (hash: string, filename: string, input: TopicInput) => Promise<IpcResult<null>>
        deleteTopic: (hash: string, filename: string) => Promise<IpcResult<null>>
      }
      projects: {
        delete: (hash: string) => Promise<IpcResult<null>>
      }
      cost: {
        getSummary: () => Promise<IpcResult<ProjectCost[]>>
        getByProject: (hash: string) => Promise<IpcResult<ProjectCost>>
      }
      claudeMd: {
        getGlobal: () => Promise<IpcResult<string | undefined>>
        getHierarchy: (realPath: string) => Promise<IpcResult<ClaudeMdHierarchy>>
      }
      sessions: {
        listByProject: (hash: string) => Promise<IpcResult<SessionSummary[]>>
        getChat: (hash: string, filename: string) => Promise<IpcResult<ChatMessage[]>>
        openInTerminal: (realPath: string, sessionId: string) => Promise<IpcResult<null>>
        newInTerminal: (realPath: string) => Promise<IpcResult<null>>
      }
      rules: {
        getByProject: (realPath: string) => Promise<IpcResult<RuleFile[]>>
      }
      skills: {
        getGlobal: () => Promise<IpcResult<Skill[]>>
        getAll: (realPath: string) => Promise<IpcResult<Skill[]>>
        create: (input: SkillInput) => Promise<IpcResult<{ filePath: string }>>
      }
      agents: {
        getGlobal: () => Promise<IpcResult<Agent[]>>
        getByProject: (realPath: string) => Promise<IpcResult<Agent[]>>
        create: (input: AgentInput) => Promise<IpcResult<{ filePath: string }>>
      }
      mcp: {
        getGlobal: () => Promise<IpcResult<McpData>>
      }
      ai: {
        run: (instruction: string, inputContent: string, projectPath: string) => Promise<IpcResult<null>>
        stop: () => Promise<IpcResult<null>>
        onChunk: (cb: (chunk: string) => void) => void
        onDone: (cb: () => void) => void
        onError: (cb: (error: string) => void) => void
      }
      onDataChanged: (callback: () => void) => void
      live: {
        getProcesses: () => Promise<IpcResult<ClaudeProcess[]>>
        startWatch: (hash: string) => Promise<IpcResult<{ started: boolean }>>
        stopWatch: () => Promise<IpcResult<null>>
        onEvent: (cb: (event: unknown) => void) => void
      }
    }
  }
}

async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (result.error) throw new Error(result.error)
  return result.data as T
}

export function useMemoryProjects() {
  return useQuery('memory:projects', () =>
    unwrap(window.electronAPI.memory.listProjects())
  )
}

export function useMemoryProject(hash: string | null) {
  return useQuery(
    ['memory:project', hash],
    () => unwrap(window.electronAPI.memory.getProject(hash!)),
    { enabled: hash !== null }
  )
}

export function useCostSummary() {
  return useQuery('cost:summary', () =>
    unwrap(window.electronAPI.cost.getSummary())
  )
}

export function useClaudeMdHierarchy(realPath: string | null) {
  return useQuery(
    ['claudeMd:hierarchy', realPath],
    () => unwrap(window.electronAPI.claudeMd.getHierarchy(realPath!)),
    { enabled: realPath !== null }
  )
}

export function useGlobalClaudeMd() {
  return useQuery('claudeMd:global', () =>
    unwrap(window.electronAPI.claudeMd.getGlobal())
  )
}

export function useProjectRules(realPath: string | null) {
  return useQuery(
    ['rules:project', realPath],
    () => unwrap(window.electronAPI.rules.getByProject(realPath!)),
    { enabled: realPath !== null }
  )
}

export function useSessionList(hash: string | null) {
  return useQuery(
    ['sessions:project', hash],
    () => unwrap(window.electronAPI.sessions.listByProject(hash!)),
    { enabled: hash !== null }
  )
}

export function useProjectCost(hash: string | null) {
  return useQuery(
    ['cost:project', hash],
    () => unwrap(window.electronAPI.cost.getByProject(hash!)),
    { enabled: hash !== null }
  )
}

export function useChatSession(hash: string, filename: string | null) {
  return useQuery(
    ['sessions:chat', hash, filename],
    () => unwrap(window.electronAPI.sessions.getChat(hash, filename!)),
    { enabled: filename !== null }
  )
}

export function useCreateTopic(hash: string) {
  const qc = useQueryClient()
  return useMutation(
    (input: TopicInput) => unwrap(window.electronAPI.memory.createTopic(hash, input)),
    { onSuccess: () => qc.invalidateQueries(['memory:project', hash]) }
  )
}

export function useUpdateTopic(hash: string) {
  const qc = useQueryClient()
  return useMutation(
    ({ filename, input }: { filename: string; input: TopicInput }) =>
      unwrap(window.electronAPI.memory.updateTopic(hash, filename, input)),
    { onSuccess: () => qc.invalidateQueries(['memory:project', hash]) }
  )
}

export function useDeleteTopic(hash: string) {
  const qc = useQueryClient()
  return useMutation(
    (filename: string) => unwrap(window.electronAPI.memory.deleteTopic(hash, filename)),
    { onSuccess: () => qc.invalidateQueries(['memory:project', hash]) }
  )
}

export function useGlobalSkills() {
  return useQuery('skills:global', () =>
    unwrap(window.electronAPI.skills.getGlobal())
  )
}

export function useAllSkills(realPath: string | null) {
  return useQuery(
    ['skills:all', realPath],
    () => unwrap(window.electronAPI.skills.getAll(realPath!)),
    { enabled: realPath !== null }
  )
}

export function useGlobalAgents() {
  return useQuery('agents:global', () =>
    unwrap(window.electronAPI.agents.getGlobal())
  )
}

export function useGlobalMcp() {
  return useQuery('mcp:global', () =>
    unwrap(window.electronAPI.mcp.getGlobal())
  )
}

export function useProjectAgents(realPath: string | null) {
  return useQuery(
    ['agents:project', realPath],
    () => unwrap(window.electronAPI.agents.getByProject(realPath!)),
    { enabled: realPath !== null }
  )
}

export function useCreateSkill() {
  const qc = useQueryClient()
  return useMutation(
    (input: SkillInput) => unwrap(window.electronAPI.skills.create(input)),
    { onSuccess: () => qc.invalidateQueries('skills:global') }
  )
}

export function useCreateAgent() {
  const qc = useQueryClient()
  return useMutation(
    (input: AgentInput) => unwrap(window.electronAPI.agents.create(input)),
    { onSuccess: () => qc.invalidateQueries('agents:global') }
  )
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation(
    (hash: string) => unwrap(window.electronAPI.projects.delete(hash)),
    { onSuccess: () => qc.invalidateQueries('memory:projects') }
  )
}

export function useDataChangedRefetch() {
  const qc = useQueryClient()

  useEffect(() => {
    window.electronAPI.onDataChanged(() => {
      qc.invalidateQueries('memory:projects')
      qc.invalidateQueries('memory:project')
      qc.invalidateQueries('cost:summary')
      qc.invalidateQueries('cost:project')
      qc.invalidateQueries('sessions:project')
      qc.invalidateQueries('sessions:chat')
      qc.invalidateQueries('claudeMd:hierarchy')
      qc.invalidateQueries('claudeMd:global')
      qc.invalidateQueries('rules:project')
      qc.invalidateQueries('skills:global')
      qc.invalidateQueries('skills:all')
      qc.invalidateQueries('agents:global')
      qc.invalidateQueries('agents:project')
      qc.invalidateQueries('mcp:global')
    })
  }, [qc])
}
