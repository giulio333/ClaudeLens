import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import type {
  MemoryTopic,
  TopicInput,
  MemoryData,
  ProjectCost,
  PricingMeta,
  ClaudeMdLayer,
  ClaudeMdHierarchy,
  ChatContentBlock,
  ChatMessage,
  SessionSummary,
  SubagentMeta,
  SessionArtifacts,
  DeleteSessionResult,
  ExportSaveResult,
  RuleFile,
  Agent,
  AgentInput,
  Skill,
  SkillFile,
  SkillFileRole,
  SkillInput,
  InstalledPlugin,
  PluginCommand,
  McpServer,
  McpData,
  LiveEvent,
  ActiveSession,
  BgSession,
  Task,
  TaskStatus,
  TaskGroup,
  Plan,
  PlanStatus,
  PlanGroup,
  EffectiveConfig,
  InitInfo,
  SettingsSourceEntry,
  PermissionRequest,
  PermissionDecision,
  ToolActivity,
  ChatTurnSummary,
  ChatChunkEvent,
  ChatToolActivityEvent,
  ChatMessageEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  NotificationEvent,
} from '../types'

// Re-export per backward compatibility — i componenti che importano i tipi da qui continuano a funzionare
export type {
  MemoryTopic,
  TopicInput,
  MemoryData,
  ProjectCost,
  PricingMeta,
  ClaudeMdLayer,
  ClaudeMdHierarchy,
  ChatContentBlock,
  ChatMessage,
  SessionSummary,
  SubagentMeta,
  SessionArtifacts,
  DeleteSessionResult,
  ExportSaveResult,
  RuleFile,
  Agent,
  AgentInput,
  Skill,
  SkillFile,
  SkillFileRole,
  SkillInput,
  InstalledPlugin,
  PluginCommand,
  McpServer,
  McpData,
  LiveEvent,
  ActiveSession,
  BgSession,
  Task,
  TaskStatus,
  TaskGroup,
  Plan,
  PlanStatus,
  PlanGroup,
  EffectiveConfig,
  InitInfo,
  SettingsSourceEntry,
  PermissionRequest,
  PermissionDecision,
  ToolActivity,
  ChatTurnSummary,
  ChatChunkEvent,
  ChatToolActivityEvent,
  ChatMessageEvent,
  ChatDoneEvent,
  ChatErrorEvent,
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
        getPricingMeta: () => Promise<IpcResult<PricingMeta>>
      }
      claudeMd: {
        getGlobal: () => Promise<IpcResult<string | undefined>>
        getHierarchy: (realPath: string) => Promise<IpcResult<ClaudeMdHierarchy>>
        writeGlobal: (content: string) => Promise<IpcResult<null>>
        writeFile: (filePath: string, content: string) => Promise<IpcResult<null>>
        deleteGlobal: () => Promise<IpcResult<null>>
        deleteFile: (filePath: string) => Promise<IpcResult<null>>
      }
      markdownFile: {
        write: (filePath: string, content: string) => Promise<IpcResult<null>>
        delete: (filePath: string, opts?: { pruneEmptyDir?: boolean }) => Promise<IpcResult<null>>
      }
      exportFile: {
        saveMarkdown: (defaultFilename: string, content: string) => Promise<IpcResult<ExportSaveResult>>
        savePdf: (defaultFilename: string, html: string) => Promise<IpcResult<ExportSaveResult>>
      }
      sessions: {
        listByProject: (hash: string) => Promise<IpcResult<SessionSummary[]>>
        getChat: (hash: string, filename: string) => Promise<IpcResult<ChatMessage[]>>
        getSubagents: (hash: string, filename: string) => Promise<IpcResult<SubagentMeta[]>>
        getSubagentTranscript: (hash: string, filename: string, agentId: string) => Promise<IpcResult<ChatMessage[]>>
        getArtifacts: (hash: string, filename: string) => Promise<IpcResult<SessionArtifacts>>
        deleteSession: (paths: string[]) => Promise<IpcResult<DeleteSessionResult>>
        sendMessage: (
          realPath: string,
          sessionId: string,
          message: string,
          model?: string,
          permissionMode?: string
        ) => Promise<IpcResult<null>>
        startMessage: (
          realPath: string,
          message: string,
          model?: string,
          permissionMode?: string
        ) => Promise<IpcResult<null>>
        stopMessage: () => Promise<IpcResult<null>>
        endChat: () => Promise<IpcResult<null>>
        respondPermission: (requestId: string, decision: PermissionDecision) => Promise<IpcResult<null>>
        onPermissionRequest: (cb: (request: PermissionRequest) => void) => () => void
        onChatStarted: (cb: (sessionId: string) => void) => () => void
        onChatChunk: (cb: (event: ChatChunkEvent) => void) => () => void
        onChatToolActivity: (cb: (event: ChatToolActivityEvent) => void) => () => void
        onChatMessage: (cb: (event: ChatMessageEvent) => void) => () => void
        onChatDone: (cb: (event: ChatDoneEvent) => void) => () => void
        onChatError: (cb: (event: ChatErrorEvent) => void) => () => void
      }
      terminal: {
        create: (opts: {
          cwd: string
          resumeSessionId?: string
          attachJobId?: string
          cols?: number
          rows?: number
        }) => Promise<IpcResult<{ id: string; pid: number }>>
        write: (id: string, data: string) => Promise<IpcResult<null>>
        resize: (id: string, cols: number, rows: number) => Promise<IpcResult<null>>
        kill: (id: string) => Promise<IpcResult<null>>
        onData: (cb: (id: string, data: string) => void) => () => void
        onExit: (cb: (id: string, exitCode: number) => void) => () => void
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
        readFile: (skillPath: string, relPath: string) => Promise<IpcResult<string>>
        writeFile: (skillPath: string, relPath: string, content: string) => Promise<IpcResult<null>>
        openFile: (skillPath: string, relPath: string) => Promise<IpcResult<null>>
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
      plugins: {
        getAll: () => Promise<IpcResult<InstalledPlugin[]>>
      }
      ai: {
        run: (instruction: string, inputContent: string, projectPath: string) => Promise<IpcResult<null>>
        stop: () => Promise<IpcResult<null>>
        onChunk: (cb: (chunk: string) => void) => () => void
        onDone: (cb: () => void) => () => void
        onError: (cb: (error: string) => void) => () => void
      }
      settings: {
        getCleanupPeriodDays: () => Promise<IpcResult<number>>
      }
      updates: {
        check: () => Promise<IpcResult<UpdateInfo>>
      }
      config: {
        getEffective: (cwd?: string) => Promise<IpcResult<EffectiveConfig>>
      }
      prefs: {
        getAll: () => Promise<IpcResult<Record<string, unknown>>>
        set: (key: string, value: unknown) => Promise<IpcResult<boolean>>
      }
      notifications: {
        onEvent: (cb: (event: NotificationEvent) => void) => () => void
        clearBadge: () => Promise<IpcResult<boolean>>
      }
      telemetry: {
        isEnabled: () => Promise<IpcResult<boolean>>
        setEnabled: (enabled: boolean) => Promise<IpcResult<boolean>>
        track: (name: string, props?: Record<string, string | number>) => Promise<IpcResult<boolean>>
      }
      onDataChanged: (callback: () => void) => () => void
      live: {
        getActiveSessions: () => Promise<IpcResult<ActiveSession[]>>
        onActiveSessionsChanged: (cb: (sessions: ActiveSession[]) => void) => () => void
        getSessions: () => Promise<IpcResult<BgSession[]>>
        onBgSessionsChanged: (cb: (sessions: BgSession[]) => void) => () => void
        startWatch: (hash: string, sessionId?: string) => Promise<IpcResult<{ started: boolean }>>
        stopWatch: () => Promise<IpcResult<null>>
        onEvent: (cb: (event: unknown) => void) => () => void
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
  return useQuery({
    queryKey: ['memory:projects'],
    queryFn: () => unwrap(window.electronAPI.memory.listProjects()),
  })
}

export function useDuplicateProjects() {
  return useQuery({
    queryKey: ['projects:duplicates'],
    queryFn: () => unwrap(window.electronAPI.projects.detectDuplicates()),
  })
}

/** Calcola il piano di merge (read-only) per una coppia source → dest. */
export function planMerge(sourceHash: string, destHash: string): Promise<MergePlan> {
  return unwrap(window.electronAPI.projects.planMerge(sourceHash, destHash))
}

/** Mutation: esegue il merge e invalida le query sui duplicati/progetti. */
export function useExecuteMerge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sourceHash, destHash }: { sourceHash: string; destHash: string }) =>
      unwrap(window.electronAPI.projects.executeMerge(sourceHash, destHash)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects:duplicates'] })
      qc.invalidateQueries({ queryKey: ['memory:projects'] })
      qc.invalidateQueries({ queryKey: ['cost:summary'] })
    },
  })
}

export function useMemoryProject(hash: string | null) {
  return useQuery({
    queryKey: ['memory:project', hash],
    queryFn: () => unwrap(window.electronAPI.memory.getProject(hash!)),
    enabled: hash !== null,
  })
}

export function useCostSummary() {
  return useQuery({
    queryKey: ['cost:summary'],
    queryFn: () => unwrap(window.electronAPI.cost.getSummary()),
  })
}

export function usePricingMeta() {
  return useQuery({
    queryKey: ['cost:pricingMeta'],
    queryFn: () => unwrap(window.electronAPI.cost.getPricingMeta()),
    staleTime: Infinity,
  })
}

export function useClaudeMdHierarchy(realPath: string | null) {
  return useQuery({
    queryKey: ['claudeMd:hierarchy', realPath],
    queryFn: () => unwrap(window.electronAPI.claudeMd.getHierarchy(realPath!)),
    enabled: realPath !== null,
  })
}

export function useGlobalClaudeMd() {
  return useQuery({
    queryKey: ['claudeMd:global'],
    queryFn: () => unwrap(window.electronAPI.claudeMd.getGlobal()),
  })
}

export function useWriteGlobalClaudeMd() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => unwrap(window.electronAPI.claudeMd.writeGlobal(content)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claudeMd:global'] })
      qc.invalidateQueries({ queryKey: ['claudeMd:hierarchy'] })
    },
  })
}

export function useWriteMarkdownFile(invalidateKeys: string[] = []) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ filePath, content }: { filePath: string; content: string }) =>
      unwrap(window.electronAPI.markdownFile.write(filePath, content)),
    onSuccess: () => {
      invalidateKeys.forEach(k => qc.invalidateQueries({ queryKey: [k] }))
    },
  })
}

export function useDeleteMarkdownFile(invalidateKeys: string[] = []) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ filePath, pruneEmptyDir }: { filePath: string; pruneEmptyDir?: boolean }) =>
      unwrap(window.electronAPI.markdownFile.delete(filePath, pruneEmptyDir ? { pruneEmptyDir } : undefined)),
    onSuccess: () => {
      invalidateKeys.forEach(k => qc.invalidateQueries({ queryKey: [k] }))
    },
  })
}

export function useDeleteClaudeMdFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (filePath: string | null) =>
      unwrap(
        filePath
          ? window.electronAPI.claudeMd.deleteFile(filePath)
          : window.electronAPI.claudeMd.deleteGlobal()
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claudeMd:global'] })
      qc.invalidateQueries({ queryKey: ['claudeMd:hierarchy'] })
    },
  })
}

export function saveMarkdownExport(defaultFilename: string, content: string): Promise<ExportSaveResult> {
  return unwrap(window.electronAPI.exportFile.saveMarkdown(defaultFilename, content))
}

export function savePdfExport(defaultFilename: string, html: string): Promise<ExportSaveResult> {
  return unwrap(window.electronAPI.exportFile.savePdf(defaultFilename, html))
}

export function useWriteClaudeMdFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ filePath, content }: { filePath: string; content: string }) =>
      unwrap(window.electronAPI.claudeMd.writeFile(filePath, content)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claudeMd:global'] })
      qc.invalidateQueries({ queryKey: ['claudeMd:hierarchy'] })
    },
  })
}

export function useProjectRules(realPath: string | null) {
  return useQuery({
    queryKey: ['rules:project', realPath],
    queryFn: () => unwrap(window.electronAPI.rules.getByProject(realPath!)),
    enabled: realPath !== null,
  })
}

export function useSessionList(hash: string | null) {
  return useQuery({
    queryKey: ['sessions:project', hash],
    queryFn: () => unwrap(window.electronAPI.sessions.listByProject(hash!)),
    enabled: hash !== null,
  })
}

export function useProjectTasks(hash: string | null) {
  return useQuery({
    queryKey: ['tasks:project', hash],
    queryFn: () => unwrap(window.electronAPI.tasks.getByProject(hash!)),
    enabled: hash !== null,
  })
}

export function useProjectPlans(hash: string | null) {
  return useQuery({
    queryKey: ['plans:project', hash],
    queryFn: () => unwrap(window.electronAPI.plans.getByProject(hash!)),
    enabled: hash !== null,
  })
}

// Inventario degli artefatti di una sessione (transcript, sub-agenti, task, piani).
// On-demand: abilitato solo quando il dialog di conferma è aperto.
export function useSessionArtifacts(hash: string | null, filename: string | null) {
  return useQuery({
    queryKey: ['sessions:artifacts', hash, filename],
    queryFn: () => unwrap(window.electronAPI.sessions.getArtifacts(hash!, filename!)),
    enabled: hash !== null && filename !== null,
    staleTime: 0,
    gcTime: 0,
  })
}

export function useDeleteSession(hash: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paths: string[]) => unwrap(window.electronAPI.sessions.deleteSession(paths)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions:project', hash] })
      qc.invalidateQueries({ queryKey: ['tasks:project', hash] })
      qc.invalidateQueries({ queryKey: ['plans:project', hash] })
      // The deleted .jsonl is the cost source for this project — refresh the
      // cost rollups it fed so the figures don't keep counting a gone session.
      qc.invalidateQueries({ queryKey: ['cost:summary'] })
      qc.invalidateQueries({ queryKey: ['cost:project', hash] })
    },
  })
}

export function useCleanupPeriodDays() {
  return useQuery({
    queryKey: ['settings:cleanupPeriodDays'],
    queryFn: () => unwrap(window.electronAPI.settings.getCleanupPeriodDays()),
    staleTime: 60_000,
  })
}

// Anonymous usage telemetry (Aptabase) opt-out toggle. Default ON; the toggle
// takes effect immediately in the main process (no restart). See PRIVACY.md.
export function useTelemetryEnabled() {
  return useQuery({
    queryKey: ['telemetry:enabled'],
    queryFn: () => unwrap(window.electronAPI.telemetry.isEnabled()),
    staleTime: Infinity,
  })
}

export function useSetTelemetryEnabled() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => unwrap(window.electronAPI.telemetry.setEnabled(enabled)),
    onSuccess: (_data, enabled) => {
      qc.setQueryData(['telemetry:enabled'], enabled)
    },
  })
}

// ─── Update check (GitHub releases) ──────────────────────────────────────────
// One check per app run (staleTime Infinity); Settings → General re-checks via
// refetch(). Mirrors electron/modules/update-checker.ts. A failed check throws
// — the banner stays silent on error, Settings shows "couldn't check".
export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseName: string | null
  releaseUrl: string
  publishedAt: string | null
}

export function useUpdateCheck() {
  return useQuery({
    queryKey: ['updates:check'],
    queryFn: () => unwrap(window.electronAPI.updates.check()),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

// Per-version "skip" for the update notice, persisted in
// ~/.claudelens/preferences.json so a skipped release stays quiet across
// launches (the next release shows the notice again).
const UPDATE_SKIPPED_KEY = 'cl-update-skipped-version'

export function useSkippedUpdateVersion() {
  return useQuery({
    queryKey: ['prefs:update-skipped'],
    queryFn: async (): Promise<string | null> => {
      const all = await unwrap(window.electronAPI.prefs.getAll())
      const v = all[UPDATE_SKIPPED_KEY]
      return typeof v === 'string' ? v : null
    },
    staleTime: Infinity,
  })
}

export function useSkipUpdateVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (version: string) => unwrap(window.electronAPI.prefs.set(UPDATE_SKIPPED_KEY, version)),
    onSuccess: (_data, version) => {
      qc.setQueryData(['prefs:update-skipped'], version)
    },
  })
}

// Notification preferences (master switch + OS-mirror toggle). Persisted in
// ~/.claudelens/preferences.json via the generic prefs store; the main process
// reads them live when gating each notification (instant, no restart).
export interface NotifyPrefs {
  enabled: boolean
  os: boolean
}
const NOTIFY_ENABLED_KEY = 'cl-notify-enabled'
const NOTIFY_OS_KEY = 'cl-notify-os'

export function useNotifyPrefs() {
  return useQuery({
    queryKey: ['prefs:notify'],
    queryFn: async (): Promise<NotifyPrefs> => {
      const all = await unwrap(window.electronAPI.prefs.getAll())
      return {
        enabled: typeof all[NOTIFY_ENABLED_KEY] === 'boolean' ? (all[NOTIFY_ENABLED_KEY] as boolean) : true,
        os: typeof all[NOTIFY_OS_KEY] === 'boolean' ? (all[NOTIFY_OS_KEY] as boolean) : true,
      }
    },
    staleTime: Infinity,
  })
}

export function useSetNotifyPref() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: 'enabled' | 'os'; value: boolean }) =>
      unwrap(window.electronAPI.prefs.set(key === 'enabled' ? NOTIFY_ENABLED_KEY : NOTIFY_OS_KEY, value)),
    onSuccess: (_data, { key, value }) => {
      qc.setQueryData(['prefs:notify'], (prev: NotifyPrefs | undefined) => ({
        enabled: true,
        os: true,
        ...prev,
        [key]: value,
      }))
    },
  })
}

export function useProjectCost(hash: string | null) {
  return useQuery({
    queryKey: ['cost:project', hash],
    queryFn: () => unwrap(window.electronAPI.cost.getByProject(hash!)),
    enabled: hash !== null,
  })
}

// The transcript `.jsonl` is read through the Agent SDK on every `data:changed`,
// but the live terminal is appending/rewriting that same file continuously.
// Reading mid-write occasionally yields an empty array, which would clobber an
// already-populated view (chat content vanishes, running agents drop out of the
// rail) until the next refetch lands on a clean moment. Treat a transient empty
// result as "no new data" when we already hold a populated value: keep the last
// good data instead of flashing to the empty state. A genuinely empty session
// (prev also empty) is unaffected; a remount always re-reads from scratch.
function keepLastGood<T>(qc: ReturnType<typeof useQueryClient>, key: unknown[], next: T[]): T[] {
  if (next.length > 0) return next
  const prev = qc.getQueryData<T[]>(key)
  return prev && prev.length > 0 ? prev : next
}

export function useChatSession(hash: string, filename: string | null) {
  const qc = useQueryClient()
  const key = ['sessions:chat', hash, filename]
  return useQuery({
    queryKey: key,
    queryFn: async () =>
      keepLastGood(qc, key, await unwrap(window.electronAPI.sessions.getChat(hash, filename!))),
    enabled: filename !== null,
  })
}

export function useSessionSubagents(hash: string, filename: string | null) {
  const qc = useQueryClient()
  const key = ['sessions:subagents', hash, filename]
  return useQuery({
    queryKey: key,
    queryFn: async () =>
      keepLastGood(qc, key, await unwrap(window.electronAPI.sessions.getSubagents(hash, filename!))),
    enabled: filename !== null,
  })
}

export function useSubagentTranscript(hash: string, filename: string | null, agentId: string | null) {
  return useQuery({
    queryKey: ['sessions:subagentTranscript', hash, filename, agentId],
    queryFn: () => unwrap(window.electronAPI.sessions.getSubagentTranscript(hash, filename!, agentId!)),
    enabled: filename !== null && agentId !== null,
  })
}

// Background-agent sessions (~/.claude/jobs + daemon/roster): the main pushes
// the fresh list via watcher; the slow refetch is just a safety net for a lost
// push or a dead pid whose state.json never changed.
export function useLiveSessions() {
  const qc = useQueryClient()
  useEffect(
    () =>
      window.electronAPI.live.onBgSessionsChanged(sessions =>
        qc.setQueryData(['live:sessions'], sessions)
      ),
    [qc]
  )
  return useQuery({
    queryKey: ['live:sessions'],
    queryFn: () => unwrap(window.electronAPI.live.getSessions()),
    refetchInterval: 15000,
  })
}

// Sessioni Claude attive (registro ~/.claude/sessions): il main pusha gli
// aggiornamenti via watcher, il refetch lento fa solo da rete di sicurezza
// (es. watcher perso o pid morto senza unlink del file).
export function useActiveSessions() {
  const qc = useQueryClient()
  useEffect(
    () =>
      window.electronAPI.live.onActiveSessionsChanged(sessions =>
        qc.setQueryData(['live:activeSessions'], sessions)
      ),
    [qc]
  )
  return useQuery({
    queryKey: ['live:activeSessions'],
    queryFn: () => unwrap(window.electronAPI.live.getActiveSessions()),
    refetchInterval: 15000,
  })
}

export function useCreateTopic(hash: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TopicInput) => unwrap(window.electronAPI.memory.createTopic(hash, input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory:project', hash] }),
  })
}

export function useUpdateTopic(hash: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ filename, input }: { filename: string; input: TopicInput }) =>
      unwrap(window.electronAPI.memory.updateTopic(hash, filename, input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory:project', hash] }),
  })
}

export function useDeleteTopic(hash: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (filename: string) => unwrap(window.electronAPI.memory.deleteTopic(hash, filename)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory:project', hash] }),
  })
}

export function useGlobalSkills() {
  return useQuery({
    queryKey: ['skills:global'],
    queryFn: () => unwrap(window.electronAPI.skills.getGlobal()),
  })
}

export function useAllSkills(realPath: string | null) {
  return useQuery({
    queryKey: ['skills:all', realPath],
    queryFn: () => unwrap(window.electronAPI.skills.getAll(realPath!)),
    enabled: realPath !== null,
  })
}

export function useGlobalAgents() {
  return useQuery({
    queryKey: ['agents:global'],
    queryFn: () => unwrap(window.electronAPI.agents.getGlobal()),
  })
}

export function useGlobalMcp() {
  return useQuery({
    queryKey: ['mcp:global'],
    queryFn: () => unwrap(window.electronAPI.mcp.getGlobal()),
  })
}

export function usePlugins() {
  return useQuery({
    queryKey: ['plugins:all'],
    queryFn: () => unwrap(window.electronAPI.plugins.getAll()),
  })
}

export function useProjectAgents(realPath: string | null) {
  return useQuery({
    queryKey: ['agents:project', realPath],
    queryFn: () => unwrap(window.electronAPI.agents.getByProject(realPath!)),
    enabled: realPath !== null,
  })
}

export function useCreateSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ input, projectPath }: { input: SkillInput; projectPath?: string }) =>
      unwrap(window.electronAPI.skills.create(input, projectPath)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills:global'] })
      qc.invalidateQueries({ queryKey: ['skills:all'] })
    },
  })
}

// Lazily read a supporting file's content (only when a bundle file is opened).
export function useSkillFile(skillPath: string | null, file: SkillFile | null) {
  return useQuery({
    queryKey: ['skills:file', skillPath, file?.relPath],
    queryFn: () => unwrap(window.electronAPI.skills.readFile(skillPath!, file!.relPath)),
    enabled: skillPath !== null && file !== null && file.isText,
  })
}

export function useWriteSkillFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ skillPath, relPath, content }: { skillPath: string; relPath: string; content: string }) =>
      unwrap(window.electronAPI.skills.writeFile(skillPath, relPath, content)),
    onSuccess: (_data, { skillPath, relPath }) => {
      qc.invalidateQueries({ queryKey: ['skills:file', skillPath, relPath] })
      qc.invalidateQueries({ queryKey: ['skills:global'] })
      qc.invalidateQueries({ queryKey: ['skills:all'] })
    },
  })
}

// Open a non-text supporting file (image/binary) in the OS default app.
export function useOpenSkillFile() {
  return useMutation({
    mutationFn: ({ skillPath, relPath }: { skillPath: string; relPath: string }) =>
      unwrap(window.electronAPI.skills.openFile(skillPath, relPath)),
  })
}

export function useCreateAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ input, projectPath }: { input: AgentInput; projectPath?: string }) =>
      unwrap(window.electronAPI.agents.create(input, projectPath)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents:global'] })
      qc.invalidateQueries({ queryKey: ['agents:project'] })
    },
  })
}

export function useDispatchBackgroundAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cwd, prompt, name, agent, model }: { cwd: string; prompt: string; name?: string; agent?: string; model?: string }) =>
      unwrap(window.electronAPI.agents.dispatchBg(cwd, prompt, name, agent, model)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['live:sessions'] })
    },
  })
}

export function useDeleteBackgroundAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(window.electronAPI.agents.deleteBg(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['live:sessions'] }),
  })
}

export function useStopBackgroundAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(window.electronAPI.agents.stopBg(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['live:sessions'] }),
  })
}

export function useRespawnBackgroundAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(window.electronAPI.agents.respawnBg(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['live:sessions'] }),
  })
}

export function useAttachBackgroundAgent() {
  return useMutation({
    mutationFn: ({ cwd, id }: { cwd: string; id: string }) =>
      unwrap(window.electronAPI.agents.attachBg(cwd, id)),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (hash: string) => unwrap(window.electronAPI.projects.delete(hash)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory:projects'] }),
  })
}

export function useDataChangedRefetch() {
  const qc = useQueryClient()

  useEffect(() => {
    // Coalesce bursts: during a live chat turn the transcript .jsonl is appended
    // continuously, firing many undebounced data:changed events; each would
    // re-run a full synchronous re-read/parse of the entire file (sessions:chat
    // is an active query). A trailing timer collapses a burst into one pass.
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      qc.invalidateQueries({ queryKey: ['memory:projects'] })
      qc.invalidateQueries({ queryKey: ['memory:project'] })
      qc.invalidateQueries({ queryKey: ['cost:summary'] })
      qc.invalidateQueries({ queryKey: ['cost:project'] })
      qc.invalidateQueries({ queryKey: ['sessions:project'] })
      qc.invalidateQueries({ queryKey: ['sessions:chat'] })
      qc.invalidateQueries({ queryKey: ['sessions:subagents'] })
      qc.invalidateQueries({ queryKey: ['sessions:subagentTranscript'] })
      qc.invalidateQueries({ queryKey: ['claudeMd:hierarchy'] })
      qc.invalidateQueries({ queryKey: ['claudeMd:global'] })
      qc.invalidateQueries({ queryKey: ['rules:project'] })
      qc.invalidateQueries({ queryKey: ['tasks:project'] })
      qc.invalidateQueries({ queryKey: ['plans:project'] })
      qc.invalidateQueries({ queryKey: ['skills:global'] })
      qc.invalidateQueries({ queryKey: ['skills:all'] })
      qc.invalidateQueries({ queryKey: ['agents:global'] })
      qc.invalidateQueries({ queryKey: ['agents:project'] })
      qc.invalidateQueries({ queryKey: ['mcp:global'] })
      qc.invalidateQueries({ queryKey: ['plugins:all'] })
    }
    const unsubscribe = window.electronAPI.onDataChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 200)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [qc])
}

/**
 * Effective Claude Code configuration via the official Agent SDK.
 * Expensive (spawns a one-turn SDK query to read the init message), so it is
 * cached aggressively and intentionally left out of the `data:changed` refetch.
 */
export function useEffectiveConfig(cwd?: string) {
  return useQuery({
    queryKey: ['config:effective', cwd ?? null],
    queryFn: () => unwrap(window.electronAPI.config.getEffective(cwd)),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
