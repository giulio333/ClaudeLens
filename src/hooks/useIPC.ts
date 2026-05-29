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
  ExportSaveResult,
  RuleFile,
  Agent,
  AgentInput,
  Skill,
  SkillInput,
  McpServer,
  McpData,
  LiveEvent,
  ClaudeProcess,
  BgSession,
  Task,
  TaskStatus,
  TaskGroup,
  Plan,
  PlanStatus,
  PlanGroup,
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
  ExportSaveResult,
  RuleFile,
  Agent,
  AgentInput,
  Skill,
  SkillInput,
  McpServer,
  McpData,
  LiveEvent,
  ClaudeProcess,
  BgSession,
  Task,
  TaskStatus,
  TaskGroup,
  Plan,
  PlanStatus,
  PlanGroup,
}

type IpcResult<T> = { data: T | null; error: string | null }

export interface DuplicateFolder {
  hash: string
  realPath: string
  realPathAuthoritative: boolean
  sessionCount: number
  lastActivity: string | null
  memoryTopicCount: number
  hasMemoryIndex: boolean
}

export interface DuplicateGroup {
  key: string
  name: string
  folders: DuplicateFolder[]
}

export interface SessionMove {
  filename: string
  collides: boolean
  targetName: string
}

export type MemoryActionKind = 'copy' | 'identical' | 'conflict-rename'

export interface MemoryAction {
  filename: string
  kind: MemoryActionKind
  targetName?: string
}

export interface MergeResult {
  movedSessions: number
  renamedSessions: number
  movedSidecars: number
  cwdRewrittenFiles: number
  memoryCopied: number
  memoryRenamed: number
  memorySkipped: number
  sourceDeleted: boolean
  backupPath: string
  warnings: string[]
}

export interface MergePlan {
  source: { hash: string; realPath: string; authoritative: boolean }
  dest: { hash: string; realPath: string; authoritative: boolean }
  cwdRewrite: { from: string; to: string } | null
  sessions: SessionMove[]
  sidecars: { name: string; collides: boolean }[]
  memory: MemoryAction[]
  regenerateIndex: boolean
  sourceEmptyAfter: boolean
  blockers: string[]
  warnings: string[]
}

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
        detectDuplicates: () => Promise<IpcResult<DuplicateGroup[]>>
        planMerge: (sourceHash: string, destHash: string) => Promise<IpcResult<MergePlan>>
        executeMerge: (sourceHash: string, destHash: string) => Promise<IpcResult<MergeResult>>
      }
      cost: {
        getSummary: () => Promise<IpcResult<ProjectCost[]>>
        getByProject: (hash: string) => Promise<IpcResult<ProjectCost>>
      }
      claudeMd: {
        getGlobal: () => Promise<IpcResult<string | undefined>>
        getHierarchy: (realPath: string) => Promise<IpcResult<ClaudeMdHierarchy>>
        writeGlobal: (content: string) => Promise<IpcResult<null>>
        writeFile: (filePath: string, content: string) => Promise<IpcResult<null>>
      }
      markdownFile: {
        write: (filePath: string, content: string) => Promise<IpcResult<null>>
      }
      exportFile: {
        saveMarkdown: (defaultFilename: string, content: string) => Promise<IpcResult<ExportSaveResult>>
        savePdf: (defaultFilename: string, html: string) => Promise<IpcResult<ExportSaveResult>>
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
      tasks: {
        getByProject: (hash: string) => Promise<IpcResult<TaskGroup[]>>
      }
      plans: {
        getByProject: (hash: string) => Promise<IpcResult<PlanGroup[]>>
      }
      skills: {
        getGlobal: () => Promise<IpcResult<Skill[]>>
        getAll: (realPath: string) => Promise<IpcResult<Skill[]>>
        create: (input: SkillInput, projectPath?: string) => Promise<IpcResult<{ filePath: string }>>
      }
      agents: {
        getGlobal: () => Promise<IpcResult<Agent[]>>
        getByProject: (realPath: string) => Promise<IpcResult<Agent[]>>
        create: (input: AgentInput, projectPath?: string) => Promise<IpcResult<{ filePath: string }>>
        dispatchBg: (cwd: string, prompt: string, name?: string, agent?: string, model?: string) => Promise<IpcResult<null>>
        deleteBg: (id: string) => Promise<IpcResult<string>>
        stopBg: (id: string) => Promise<IpcResult<string>>
        respawnBg: (id: string) => Promise<IpcResult<string>>
        attachBg: (cwd: string, id: string) => Promise<IpcResult<null>>
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
      settings: {
        getCleanupPeriodDays: () => Promise<IpcResult<number>>
      }
      onDataChanged: (callback: () => void) => void
      live: {
        getProcesses: () => Promise<IpcResult<ClaudeProcess[]>>
        getSessions: () => Promise<IpcResult<BgSession[]>>
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

export function useDuplicateProjects() {
  return useQuery('projects:duplicates', () =>
    unwrap(window.electronAPI.projects.detectDuplicates())
  )
}

/** Calcola il piano di merge (read-only) per una coppia source → dest. */
export function planMerge(sourceHash: string, destHash: string): Promise<MergePlan> {
  return unwrap(window.electronAPI.projects.planMerge(sourceHash, destHash))
}

/** Mutation: esegue il merge e invalida le query sui duplicati/progetti. */
export function useExecuteMerge() {
  const qc = useQueryClient()
  return useMutation(
    ({ sourceHash, destHash }: { sourceHash: string; destHash: string }) =>
      unwrap(window.electronAPI.projects.executeMerge(sourceHash, destHash)),
    {
      onSuccess: () => {
        qc.invalidateQueries('projects:duplicates')
        qc.invalidateQueries('memory:projects')
        qc.invalidateQueries('cost:summary')
      },
    },
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

export function useWriteGlobalClaudeMd() {
  const qc = useQueryClient()
  return useMutation(
    (content: string) => unwrap(window.electronAPI.claudeMd.writeGlobal(content)),
    {
      onSuccess: () => {
        qc.invalidateQueries('claudeMd:global')
        qc.invalidateQueries('claudeMd:hierarchy')
      },
    }
  )
}

export function useWriteMarkdownFile(invalidateKeys: string[] = []) {
  const qc = useQueryClient()
  return useMutation(
    ({ filePath, content }: { filePath: string; content: string }) =>
      unwrap(window.electronAPI.markdownFile.write(filePath, content)),
    {
      onSuccess: () => {
        invalidateKeys.forEach(k => qc.invalidateQueries(k))
      },
    }
  )
}

export function saveMarkdownExport(defaultFilename: string, content: string): Promise<ExportSaveResult> {
  return unwrap(window.electronAPI.exportFile.saveMarkdown(defaultFilename, content))
}

export function savePdfExport(defaultFilename: string, html: string): Promise<ExportSaveResult> {
  return unwrap(window.electronAPI.exportFile.savePdf(defaultFilename, html))
}

export function useWriteClaudeMdFile() {
  const qc = useQueryClient()
  return useMutation(
    ({ filePath, content }: { filePath: string; content: string }) =>
      unwrap(window.electronAPI.claudeMd.writeFile(filePath, content)),
    {
      onSuccess: () => {
        qc.invalidateQueries('claudeMd:global')
        qc.invalidateQueries('claudeMd:hierarchy')
      },
    }
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

export function useProjectTasks(hash: string | null) {
  return useQuery(
    ['tasks:project', hash],
    () => unwrap(window.electronAPI.tasks.getByProject(hash!)),
    { enabled: hash !== null }
  )
}

export function useProjectPlans(hash: string | null) {
  return useQuery(
    ['plans:project', hash],
    () => unwrap(window.electronAPI.plans.getByProject(hash!)),
    { enabled: hash !== null }
  )
}

export function useCleanupPeriodDays() {
  return useQuery(
    'settings:cleanupPeriodDays',
    () => unwrap(window.electronAPI.settings.getCleanupPeriodDays()),
    { staleTime: 60_000 }
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

export function useLiveSessions() {
  return useQuery(
    'live:sessions',
    () => unwrap(window.electronAPI.live.getSessions()),
    { refetchInterval: 4000 }
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
    ({ input, projectPath }: { input: SkillInput; projectPath?: string }) =>
      unwrap(window.electronAPI.skills.create(input, projectPath)),
    {
      onSuccess: () => {
        qc.invalidateQueries('skills:global')
        qc.invalidateQueries('skills:all')
      },
    }
  )
}

export function useCreateAgent() {
  const qc = useQueryClient()
  return useMutation(
    ({ input, projectPath }: { input: AgentInput; projectPath?: string }) =>
      unwrap(window.electronAPI.agents.create(input, projectPath)),
    {
      onSuccess: () => {
        qc.invalidateQueries('agents:global')
        qc.invalidateQueries('agents:project')
      },
    }
  )
}

export function useDispatchBackgroundAgent() {
  const qc = useQueryClient()
  return useMutation(
    ({ cwd, prompt, name, agent, model }: { cwd: string; prompt: string; name?: string; agent?: string; model?: string }) =>
      unwrap(window.electronAPI.agents.dispatchBg(cwd, prompt, name, agent, model)),
    {
      onSuccess: () => {
        qc.invalidateQueries('live:sessions')
      },
    }
  )
}

export function useDeleteBackgroundAgent() {
  const qc = useQueryClient()
  return useMutation(
    (id: string) => unwrap(window.electronAPI.agents.deleteBg(id)),
    { onSuccess: () => qc.invalidateQueries('live:sessions') }
  )
}

export function useStopBackgroundAgent() {
  const qc = useQueryClient()
  return useMutation(
    (id: string) => unwrap(window.electronAPI.agents.stopBg(id)),
    { onSuccess: () => qc.invalidateQueries('live:sessions') }
  )
}

export function useRespawnBackgroundAgent() {
  const qc = useQueryClient()
  return useMutation(
    (id: string) => unwrap(window.electronAPI.agents.respawnBg(id)),
    { onSuccess: () => qc.invalidateQueries('live:sessions') }
  )
}

export function useAttachBackgroundAgent() {
  return useMutation(
    ({ cwd, id }: { cwd: string; id: string }) =>
      unwrap(window.electronAPI.agents.attachBg(cwd, id))
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
      qc.invalidateQueries('tasks:project')
      qc.invalidateQueries('plans:project')
      qc.invalidateQueries('skills:global')
      qc.invalidateQueries('skills:all')
      qc.invalidateQueries('agents:global')
      qc.invalidateQueries('agents:project')
      qc.invalidateQueries('mcp:global')
    })
  }, [qc])
}
