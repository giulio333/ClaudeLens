import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  useMemoryProject,
  useSessionList,
  useClaudeMdHierarchy,
  useProjectRules,
  useGlobalMcp,
  useAllSkills,
  useGlobalAgents,
  useProjectAgents,
  useCleanupPeriodDays,
  ClaudeProcess,
} from '../../../hooks/useIPC'
import { View } from '../types'
import { fmt, fmtModel, sessionTitle } from '../utils'
import type { SessionSummary } from '../../../types'
import { Lens } from './Lens'
import { McpServerGrid } from '../mcp/McpServerGrid'
import { AgentsLiveView } from '../agents-live/AgentsLiveView'
import { TasksSection } from '../tasks/TasksSection'
import { projectDisplayName } from '../shared/projectName'
import { PlansSection } from '../plans/PlansSection'
import { ProjectConfigView } from '../settings/ProjectConfigView'
import { usePinnedProjects } from '../../../hooks/usePinnedProjects'
import { usePinnedSessions } from '../../../hooks/usePinnedSessions'
import { useSessionTags } from '../../../hooks/useSessionTags'
import { PinIcon } from '../shared/SearchPopover'
import { TagChip } from '../sessions/TagChip'
import { TagBar } from '../sessions/TagBar'
import { TagPicker } from '../sessions/TagPicker'
import { DeleteSessionDialog } from '../shared/DeleteSessionDialog'

export type ProjectSection = 'overview' | 'sessions' | 'memory' | 'skills' | 'agents' | 'mcp' | 'live-agents' | 'tasks' | 'plans' | 'config'

type Project = { hash: string; realPath: string }

function formatTokens(n: number): { value: string; unit: string } {
  if (n >= 1_000_000_000) return { value: (n / 1_000_000_000).toFixed(1), unit: 'b' }
  if (n >= 1_000_000)     return { value: (n / 1_000_000).toFixed(1), unit: 'm' }
  if (n >= 1_000)         return { value: Math.round(n / 1_000).toString(), unit: 'k' }
  return { value: String(n), unit: '' }
}

function relIso(iso: string): string {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const diff = Math.floor((Date.now() - t) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 86400 * 14) return `${Math.floor(diff / 86400)}d`
  return `${Math.floor(diff / (86400 * 7))}w`
}

function shortWhen(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function modelFamily(m?: string): '' | 'opus' | 'haiku' {
  if (!m) return ''
  if (m.includes('opus')) return 'opus'
  if (m.includes('haiku')) return 'haiku'
  return ''
}

const DAY_MS = 86_400_000
const DEFAULT_RETENTION_DAYS = 30
const MAX_STAT_BARS = 12

type StatMetric = 'sessions' | 'tokens' | 'avg'

type TimelineBucket = {
  key: string
  label: string
  sessions: number
  tokens: number
}

function normalizeRetentionDays(days: number): number {
  return Number.isFinite(days) && days > 0 ? Math.max(1, Math.round(days)) : DEFAULT_RETENTION_DAYS
}

function fmtBucketDate(ms: number): string {
  return new Date(ms).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

function bucketLabel(startMs: number, endMs: number): string {
  const start = fmtBucketDate(startMs)
  const end = fmtBucketDate(Math.max(startMs, endMs - 1))
  return start === end ? start : `${start} - ${end}`
}

function buildTimelineBuckets(sessions: SessionSummary[], days: number): TimelineBucket[] {
  const bucketCount = Math.min(MAX_STAT_BARS, Math.max(1, Math.ceil(days)))
  const now = Date.now()
  const windowMs = days * DAY_MS
  const startMs = now - windowMs
  const bucketMs = windowMs / bucketCount
  const buckets = Array.from({ length: bucketCount }, (_, i) => {
    const from = startMs + i * bucketMs
    const to = i === bucketCount - 1 ? now : startMs + (i + 1) * bucketMs
    return {
      key: `${Math.round(from)}-${Math.round(to)}`,
      label: bucketLabel(from, to),
      sessions: 0,
      tokens: 0,
    }
  })

  for (const s of sessions) {
    const t = new Date(s.date).getTime()
    if (isNaN(t) || t < startMs || t > now) continue
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((t - startMs) / bucketMs)))
    buckets[idx].sessions += 1
    buckets[idx].tokens += s.totalTokens
  }

  return buckets
}

function bucketValue(bucket: TimelineBucket, metric: StatMetric): number {
  if (metric === 'sessions') return bucket.sessions
  if (metric === 'tokens') return bucket.tokens
  return bucket.sessions > 0 ? bucket.tokens / bucket.sessions : 0
}

function bucketTooltip(bucket: TimelineBucket, metric: StatMetric): string {
  if (metric === 'sessions') return `${bucket.label} · ${fmt(bucket.sessions)} sessions · ${fmt(bucket.tokens)} tok`
  if (metric === 'tokens') return `${bucket.label} · ${fmt(bucket.tokens)} tok · ${fmt(bucket.sessions)} sessions`
  const avg = bucket.sessions > 0 ? Math.round(bucket.tokens / bucket.sessions) : 0
  return `${bucket.label} · ${fmt(avg)} tok/session · ${fmt(bucket.sessions)} sessions`
}

function Bars({ buckets, metric }: { buckets: TimelineBucket[]; metric: StatMetric }) {
  const [active, setActive] = useState<{ index: number; text: string } | null>(null)
  const values = buckets.map(bucket => bucketValue(bucket, metric))
  const max = Math.max(...values, 1)
  const peakIdx = values.indexOf(Math.max(...values))
  const gridStyle: CSSProperties = { gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }
  return (
    <div className="cl-bars" style={gridStyle}>
      {buckets.map((bucket, i) => {
        const value = values[i] ?? 0
        const tooltip = bucketTooltip(bucket, metric)
        return (
          <span
            key={bucket.key}
            className={`cl-stat-bar${value > 0 && i === peakIdx ? ' peak' : ''}`}
            tabIndex={0}
            title={tooltip}
            aria-label={tooltip}
            onMouseEnter={() => setActive({ index: i, text: tooltip })}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive({ index: i, text: tooltip })}
            onBlur={() => setActive(null)}
          >
            <span
              className="cl-stat-bar-fill"
              style={{ height: `${value > 0 ? Math.max((value / max) * 100, 6) : 0}%` }}
            />
          </span>
        )
      })}
      {active && (
        <span
          className="cl-bars-tip"
          style={{ left: `${((active.index + 0.5) / Math.max(buckets.length, 1)) * 100}%` }}
        >
          {active.text}
        </span>
      )}
    </div>
  )
}

const MEM_PREVIEW_MAX = 70

const CLAUDE_MD_SCOPE_LABEL: Record<'global' | 'project' | 'local' | 'subdir', string> = {
  project: 'Project',
  local: 'Local',
  subdir: 'Subdir',
  global: 'Global',
}

// Ripulisce la sintassi markdown e tronca per un'anteprima pulita su una riga.
function memPreview(raw: string): string {
  const clean = raw
    .replace(/```[\s\S]*?```/g, ' ')        // blocchi di codice
    .replace(/`([^`]+)`/g, '$1')             // codice inline
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')   // immagini
    .replace(/\[\[([^\]]+)\]\]/g, '$1')      // wikilink
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // link markdown
    .replace(/^#{1,6}\s+/gm, '')             // heading
    .replace(/[*_~>#]/g, '')                 // enfasi e marcatori
    .replace(/\s+/g, ' ')                    // collassa whitespace
    .trim()
  return clean.length > MEM_PREVIEW_MAX
    ? clean.slice(0, MEM_PREVIEW_MAX).trimEnd() + '…'
    : clean
}

export function ProjectView({
  project,
  section,
  onNavigate,
  onOpenProjectSearch,
}: {
  project: Project
  section: ProjectSection
  onNavigate: (v: View) => void
  onOpenProjectSearch: (rect: DOMRect) => void
}) {
  const { isPinned, togglePin } = usePinnedProjects()
  const pinnedNow = isPinned(project.hash)
  const { isPinned: isSessionPinned } = usePinnedSessions()
  const { tags: projectTags, tagCounts, tagsForSession, renameTag, deleteTag } = useSessionTags(project.hash)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const { data: memory } = useMemoryProject(project.hash)
  const { data: sessions = [] } = useSessionList(project.hash)
  const { data: claudeMd } = useClaudeMdHierarchy(project.realPath)
  const { data: rules = [] } = useProjectRules(project.realPath)
  const { data: mcpData } = useGlobalMcp()
  const { data: allSkills = [] } = useAllSkills(project.realPath)
  const { data: globalAgents = [] } = useGlobalAgents()
  const { data: projectAgents = [] } = useProjectAgents(project.realPath)
  const { data: cleanupDays = 30 } = useCleanupPeriodDays()

  // ── Live process ──
  const [procs, setProcs] = useState<ClaudeProcess[]>([])
  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const r = await window.electronAPI.live.getProcesses()
        if (alive && r.data) setProcs(r.data)
      } catch { /* ignore */ }
    }
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  const liveProc = procs.find(p => p.cwd === project.realPath)
  const liveStart = useMemo(() => Date.now(), [liveProc?.pid])
  const [, tick] = useState(0)
  useEffect(() => {
    if (!liveProc) return
    const t = setInterval(() => tick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [liveProc])
  const liveSec = liveProc ? Math.floor((Date.now() - liveStart) / 1000) : 0
  const liveUptime = `${Math.floor(liveSec / 60)}m ${liveSec % 60}s`

  // ── Derived ──
  const projectName = projectDisplayName(project.realPath)
  const retentionDays = normalizeRetentionDays(cleanupDays)
  const statsSessions = useMemo(() => {
    const now = Date.now()
    const cutoff = now - retentionDays * DAY_MS
    return sessions.filter(s => {
      const t = new Date(s.date).getTime()
      return !isNaN(t) && t >= cutoff && t <= now
    })
  }, [sessions, retentionDays])
  const sessionCount = statsSessions.length
  const totalTokens = statsSessions.reduce((s, x) => s + x.totalTokens, 0)
  const totalCost = statsSessions.reduce((s, x) => s + x.estimatedCost, 0)
  const tokensFmt = formatTokens(totalTokens)
  const avgTokens = sessionCount > 0 ? formatTokens(Math.round(totalTokens / sessionCount)) : { value: '0', unit: '' }
  const allSessionCount = sessions.length
  const olderSessionCount = Math.max(0, allSessionCount - sessionCount)
  const retentionLabel = retentionDays === 1 ? 'last 24h' : `last ${retentionDays}d`
  const lastActive = sessions[0]?.date
  const statBuckets = useMemo(() => buildTimelineBuckets(statsSessions, retentionDays), [statsSessions, retentionDays])

  const pinnedSessions = useMemo(
    () => sessions.filter(s => isSessionPinned(project.hash, s.filename)),
    [sessions, project.hash, isSessionPinned],
  )
  const hasPinnedSession = pinnedSessions.length > 0
  const visibleSessions = useMemo(() => {
    if (!tagFilter) return sessions
    return sessions.filter(s => tagsForSession(s.filename).includes(tagFilter))
  }, [sessions, tagFilter, tagsForSession])
  useEffect(() => {
    if (tagFilter && !projectTags.some(t => t.name === tagFilter)) setTagFilter(null)
  }, [tagFilter, projectTags])

  const memTopics = useMemo(
    () => [...(memory?.index ?? []), ...(memory?.projectLevelIndex ?? [])],
    [memory],
  )
  const topicContent = (filename: string) =>
    memory?.topics[filename] ?? memory?.projectLevelTopics[filename] ?? ''

  const enabledMcp = useMemo(() => {
    const all = [...(mcpData?.cloudServers ?? []), ...(mcpData?.localServers ?? [])]
    return all.filter(s => !s.disabledProjectPaths.includes(project.realPath))
  }, [mcpData, project.realPath])

  const claudeMdLayers = claudeMd?.layers.length ?? 0
  const claudeMdLayerList = useMemo(() => {
    const order = { project: 0, local: 1, subdir: 2, global: 3 } as const
    return [...(claudeMd?.layers ?? [])].sort((a, b) => order[a.scope] - order[b.scope])
  }, [claudeMd])
  const skillCount = allSkills.length
  const agents = useMemo(() => {
    const seen = new Map<string, typeof globalAgents[number]>()
    for (const a of [...projectAgents, ...globalAgents]) if (!seen.has(a.name)) seen.set(a.name, a)
    return [...seen.values()]
  }, [projectAgents, globalAgents])
  const agentCount = agents.length
  const memoryCount = memTopics.length

  return (
    <div style={{ position: 'relative' }}>
      {/* ─── HERO ─────────────────────────────────────── */}
      <section className={`cl-hero${liveProc ? ' is-live' : ''}`}>
        <Lens />
        <div className="cl-hero-actions">
          <button
            type="button"
            className={`cl-btn cl-btn--icon${pinnedNow ? ' is-pinned' : ''}`}
            title={pinnedNow ? 'Unpin project' : 'Pin project'}
            aria-label={pinnedNow ? 'Unpin project' : 'Pin project'}
            aria-pressed={pinnedNow}
            onClick={() => togglePin(project.hash)}
          >
            <PinIcon filled={pinnedNow} />
            <span>{pinnedNow ? 'Pinned' : 'Pin'}</span>
          </button>
          <button className="cl-btn" type="button" onClick={() => window.electronAPI.sessions.newInTerminal(project.realPath)}>
            Open in Claude Code
          </button>
        </div>

        <div className="cl-eyebrow">
          <span className="pip" />
          <span title={project.realPath}>Project · {project.realPath}</span>
        </div>

        <button
          className="cl-h-name"
          type="button"
          onClick={e => onOpenProjectSearch(e.currentTarget.getBoundingClientRect())}
          aria-haspopup="dialog"
        >
          <span className="label-name">{projectName}</span><span className="glyph">.</span>
          <span className="chev">↓</span>
        </button>

        <div className="cl-h-meta">
          <span><b>{fmt(sessionCount)}</b> sessions / {retentionDays}d</span>
          <span className="sep">·</span>
          <span><b>{tokensFmt.value}{tokensFmt.unit}</b> tokens</span>
          {lastActive && <><span className="sep">·</span><span>last active <b>{relIso(lastActive)} ago</b></span></>}
          {liveProc && <span className="tag"><span className="led" /> 1 session running</span>}
        </div>
      </section>

      {/* ─── SECTION CONTENT ──────────────────────────── */}
      {section === 'overview' && (
        <>
          <section className="cl-stats">
            <div className="cl-stat">
              <span className="lbl">Sessions</span>
              <div className="num">{fmt(sessionCount)}</div>
              <Bars buckets={statBuckets} metric="sessions" />
              <div className="delta">
                {retentionLabel}{olderSessionCount > 0 ? ` · ${fmt(olderSessionCount)} older` : ' · full retention'}
              </div>
            </div>
            <div className="cl-stat">
              <span className="lbl">Tokens</span>
              <div className="num">{tokensFmt.value}<small>{tokensFmt.unit}</small></div>
              <Bars buckets={statBuckets} metric="tokens" />
              <div className="delta">est. ${totalCost.toFixed(2)} · {retentionLabel}</div>
            </div>
            <div className="cl-stat">
              <span className="lbl">Avg / session</span>
              <div className="num">{avgTokens.value}<small>{avgTokens.unit || 'tok'}</small></div>
              <Bars buckets={statBuckets} metric="avg" />
              <div className="delta">across {fmt(sessionCount)} sessions</div>
            </div>
            <div className="cl-stat live">
              <span className="lbl"><span className="pulse" /> Live</span>
              {liveProc ? (
                <>
                  <div className="pid">PID {liveProc.pid}</div>
                  <div className="cmd">{liveProc.cmdline || 'claude'}</div>
                  <div className="uptime">↑ {liveUptime} · attached</div>
                </>
              ) : (
                <div className="idle">No live session</div>
              )}
            </div>
          </section>

          <PinnedSessionsSection
            sessions={pinnedSessions}
            projectHash={project.hash}
            cleanupDays={cleanupDays}
            onOpen={s => onNavigate({ type: 'chat', project, session: s })}
          />

          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Sessions</h2>
              <span className="ct">{Math.min(5, sessions.length)} of {sessions.length}</span>
              <button className="all" type="button" onClick={() => onNavigate({ type: 'sessions', project })}>View all</button>
            </div>
            <SessionRows sessions={sessions.slice(0, 5)} projectHash={project.hash} cleanupDays={cleanupDays} onOpen={s => onNavigate({ type: 'chat', project, session: s })} />
          </section>

          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Memory</h2>
              <span className="ct">{Math.min(4, memTopics.length)} of {memoryCount}</span>
              <button className="all" type="button" onClick={() => onNavigate({ type: 'project-memory', project })}>View all</button>
            </div>
            <MemoryRows
              topics={memTopics.slice(0, 4)}
              onOpen={t => onNavigate({ type: 'memory-topic', topic: t, content: topicContent(t.filename), hash: project.hash })}
            />
          </section>

          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>CLAUDE.md</h2>
              <span className="ct">{claudeMdLayers} {claudeMdLayers === 1 ? 'layer' : 'layers'} · global → project → local → subdir</span>
            </div>
            {claudeMdLayers === 0 ? (
              <div className="cl-empty">No CLAUDE.md instructions for this project.</div>
            ) : (
              <div className="cl-tile-grid">
                {claudeMdLayerList.map((l, i) => {
                  const lines = l.content.split('\n').length
                  const path = l.scope === 'global'
                    ? '~/.claude/CLAUDE.md'
                    : l.filePath.startsWith(project.realPath + '/')
                      ? l.filePath.slice(project.realPath.length + 1)
                      : l.filePath
                  return (
                    <button key={l.filePath} type="button" className={`cl-tile ${i === 0 ? 'accent' : ''}`}
                      onClick={() => l.scope === 'global'
                        ? onNavigate({ type: 'global-claudemd' })
                        : onNavigate({ type: 'project-claudemd', project, layer: l })}>
                      <span className="glyph">M</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="t-name">{CLAUDE_MD_SCOPE_LABEL[l.scope]}</div>
                        <div className="t-desc">{path}</div>
                      </div>
                      <span className="t-meta"><b>{lines}</b> lines</span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className="cl-config-strip">
            <button className={`item ${skillCount ? 'on' : ''}`} type="button" onClick={() => onNavigate({ type: 'project-skills', project })}>
              <span className="pip" /><span>Skills</span><span className="num">{skillCount}</span>
            </button>
            <button className={`item ${agentCount ? 'on' : ''}`} type="button" onClick={() => onNavigate({ type: 'project-agents', project })}>
              <span className="pip" /><span>Agents</span><span className="num">{agentCount}</span>
            </button>
            <button className={`item ${enabledMcp.length ? 'on' : ''}`} type="button" onClick={() => onNavigate({ type: 'project-mcp', project })}>
              <span className="pip" /><span>MCP</span><span className="num">{enabledMcp.length}</span>
            </button>
            <button className={`item ${rules.length ? 'on' : ''}`} type="button" onClick={() => onNavigate({ type: 'project-mcp', project })}>
              <span className="pip" /><span>Rules</span><span className="num">{rules.length} active</span>
            </button>
          </section>
        </>
      )}

      {section === 'sessions' && (
        <>
          <PinnedSessionsSection
            sessions={pinnedSessions}
            projectHash={project.hash}
            cleanupDays={cleanupDays}
            onOpen={s => onNavigate({ type: 'chat', project, session: s })}
            style={{ paddingTop: 38 }}
          />
          <section className="cl-section" style={{ paddingTop: hasPinnedSession ? undefined : 38 }}>
            <div className="cl-sec-head">
              <h2>Sessions</h2>
              <span className="ct">
                {tagFilter
                  ? `${visibleSessions.length} tagged #${tagFilter}`
                  : `${sessions.length} total · sorted by last activity`}
              </span>
            </div>
            <TagBar
              tags={projectTags}
              counts={tagCounts}
              activeTag={tagFilter}
              totalCount={sessions.length}
              onSelect={setTagFilter}
              onRename={renameTag}
              onDelete={deleteTag}
            />
            {visibleSessions.length === 0 ? (
              <div className="cl-empty">
                {tagFilter ? `No sessions tagged #${tagFilter}.` : 'No sessions yet.'}
              </div>
            ) : (
              <SessionRows sessions={visibleSessions} projectHash={project.hash} cleanupDays={cleanupDays} onOpen={s => onNavigate({ type: 'chat', project, session: s })} />
            )}
          </section>
        </>
      )}

      {section === 'memory' && (
        <section className="cl-section" style={{ paddingTop: 38 }}>
          <div className="cl-sec-head">
            <h2>Project memory</h2>
            <span className="ct">MEMORY.md · {memoryCount} {memoryCount === 1 ? 'topic' : 'topics'}</span>
          </div>
          {memTopics.length === 0 ? (
            <div className="cl-empty">No memory topics yet.</div>
          ) : (
            <div className="cl-tile-grid">
              {memTopics.map((t, i) => (
                <button key={t.filename} type="button" className={`cl-tile ${i === 0 ? 'accent' : ''}`}
                  onClick={() => onNavigate({ type: 'memory-topic', topic: t, content: topicContent(t.filename), hash: project.hash })}>
                  <span className="glyph">{(t.name[0] ?? '?').toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="t-name">{t.name}</div>
                    <div className="t-desc">{t.description ? memPreview(t.description) : '—'}</div>
                  </div>
                  <span className="t-meta"><b>{t.type}</b></span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {section === 'skills' && (
        <section className="cl-section" style={{ paddingTop: 38 }}>
          <div className="cl-sec-head">
            <h2>Skills</h2>
            <span className="ct">{skillCount} available</span>
            <button className="all" type="button" onClick={() => onNavigate({ type: 'skill-create', project })}>+ New</button>
          </div>
          {skillCount === 0 ? (
            <div className="cl-empty">No skills available for this project.</div>
          ) : (
            <div className="cl-tile-grid">
              {allSkills.map((s, i) => (
                <button key={s.path} type="button" className={`cl-tile ${i === 0 ? 'accent' : ''}`}
                  onClick={() => onNavigate({ type: 'skill-detail', skill: s })}>
                  <span className="glyph">{(s.name[0] ?? '?').toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="t-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      /{s.name}
                      <span
                        title={s.scope === 'project' ? 'Defined in this project (.claude/skills)' : 'Defined globally (~/.claude/skills)'}
                        style={{
                          fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          letterSpacing: '0.05em',
                          lineHeight: 1.4,
                          background: s.scope === 'project' ? 'var(--cl-accent-soft)' : 'color-mix(in srgb, var(--cl-ink-3) 14%, transparent)',
                          color: s.scope === 'project' ? 'var(--cl-accent-ink)' : 'var(--cl-ink-3)',
                        }}
                      >
                        {s.scope}
                      </span>
                    </div>
                    <div className="t-desc">{s.description || '—'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {section === 'agents' && (
        <section className="cl-section" style={{ paddingTop: 38 }}>
          <div className="cl-sec-head">
            <h2>Agents</h2>
            <span className="ct">{agentCount} available · delegate-and-summarize</span>
            <button className="all" type="button" onClick={() => onNavigate({ type: 'agent-create', project })}>+ New</button>
          </div>
{agentCount === 0 ? (
            <div className="cl-empty">No agents available for this project.</div>
          ) : (
            <div className="cl-tile-grid">
              {agents.map((a, i) => {
                const glyphs = ['◐', '◑', '◒', '◓']
                const mode = a.disableModelInvocation ? 'manual' : 'auto'
                const issues = [
                  ...(a.missingRequired.length > 0
                    ? [{ label: `missing ${a.missingRequired.join(', ')}`, title: `Missing required frontmatter: ${a.missingRequired.join(', ')}` }]
                    : []),
                  ...(a.filenameHasSpaces
                    ? [{ label: 'spaces in filename', title: 'Claude Code requires agent file names without spaces — this agent may not be loaded.' }]
                    : []),
                ]
                return (
                  <button key={a.path} type="button" className={`cl-tile ${i === 0 ? 'accent' : ''}`}
                    onClick={() => onNavigate({ type: 'agent-detail', agent: a })}>
                    <span className="glyph">{glyphs[i % glyphs.length]}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="t-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {a.name}
                        <span
                          title={a.scope === 'project' ? 'Defined in this project (.claude/agents)' : 'Defined globally (~/.claude/agents)'}
                          style={{
                            fontSize: 10,
                            fontFamily: 'var(--font-mono)',
                            padding: '1px 5px',
                            borderRadius: 4,
                            letterSpacing: '0.05em',
                            lineHeight: 1.4,
                            background: a.scope === 'project' ? 'var(--cl-accent-soft)' : 'color-mix(in srgb, var(--cl-ink-3) 14%, transparent)',
                            color: a.scope === 'project' ? 'var(--cl-accent-ink)' : 'var(--cl-ink-3)',
                          }}
                        >
                          {a.scope}
                        </span>
                        {issues.map(issue => (
                          <span
                            key={issue.label}
                            title={issue.title}
                            style={{ fontSize: 10, fontFamily: 'var(--font-mono)', background: 'color-mix(in srgb, #f59e0b 20%, transparent)', color: '#f59e0b', padding: '1px 5px', borderRadius: 4, letterSpacing: '0.05em', lineHeight: 1.4 }}
                          >
                            {issue.label}
                          </span>
                        ))}
                      </div>
                      <div className="t-desc">{a.description || '—'}</div>
                    </div>
                    <span className="t-meta">{a.model ? `${fmtModel(a.model)} · ` : ''}<b>{mode}</b></span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {section === 'mcp' && (
        <section className="cl-section" style={{ paddingTop: 38 }}>
          {enabledMcp.length === 0 ? (
            <>
              <div className="cl-sec-head">
                <h2>MCP servers</h2>
                <span className="ct">0 active · project-scoped</span>
                <button className="all" type="button" onClick={() => onNavigate({ type: 'global-mcp' })}>Manage</button>
              </div>
              <div className="cl-empty">No MCP servers active for this project.</div>
            </>
          ) : (
            <McpServerGrid
              servers={enabledMcp}
              onSelect={s => onNavigate({ type: 'mcp-detail', server: s, totalProjects: s.enabledInProjects + s.disabledInProjects })}
              headerAction={
                <button className="all" type="button" onClick={() => onNavigate({ type: 'global-mcp' })}>Manage</button>
              }
            />
          )}

          <div className="cl-sec-head" style={{ marginTop: 42 }}>
            <h2>Conditional rules</h2>
            <span className="ct">{rules.length} {rules.length === 1 ? 'rule' : 'rules'} · path-scoped</span>
          </div>
          {rules.length === 0 ? (
            <div className="cl-empty">No conditional rules.</div>
          ) : (
            <div className="cl-rules">
              {rules.map(r => (
                <div key={r.filename} className="cl-rule">
                  <span className="rname">{r.filename}</span>
                  <span className="rwhen">{r.paths && r.paths.length > 0 ? `path: ${r.paths.join(', ')}` : 'always'}</span>
                  <span className="ron"><span className="led" /> on</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {section === 'tasks' && (
        <TasksSection
          project={project}
          onOpenChat={s => onNavigate({ type: 'chat', project, session: s })}
        />
      )}

      {section === 'plans' && (
        <PlansSection
          project={project}
          onOpenChat={s => onNavigate({ type: 'chat', project, session: s })}
          onOpenPlan={plan => onNavigate({ type: 'plan-detail', project, plan })}
        />
      )}

      {section === 'live-agents' && (
        <AgentsLiveView
          embedded
          hideHero
          project={project}
          onBack={() => onNavigate({ type: 'overview' })}
          onOpenSession={(p, s) => onNavigate({ type: 'chat', project: p, session: s, from: 'agents-live' })}
        />
      )}

      {section === 'config' && <ProjectConfigView project={project} />}
    </div>
  )
}

function sessionAgeDays(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000)
}

function ExpiryTag({ date, cleanupDays }: { date: string; cleanupDays: number }) {
  const remaining = cleanupDays - sessionAgeDays(date)
  let color: string
  let opacity: number
  let label: string

  if (remaining <= 0) {
    color = 'oklch(0.60 0.18 25)'; opacity = 1; label = 'expired'
  } else if (remaining <= 3) {
    color = 'oklch(0.60 0.18 25)'; opacity = 1; label = `${remaining}d`
  } else if (remaining <= 7) {
    color = 'oklch(0.65 0.15 55)'; opacity = 0.9; label = `${remaining}d`
  } else {
    color = 'var(--cl-ink-4)'; opacity = 0.4; label = `${remaining}d`
  }

  return (
    <span
      title={`Auto-deleted after ${cleanupDays} days · cleanupPeriodDays in ~/.claude/settings.json`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color, opacity, userSelect: 'none', flexShrink: 0 }}
    >
      <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      {label}
    </span>
  )
}

function PinnedSessionsSection({ sessions, projectHash, cleanupDays, onOpen, style }: { sessions: SessionSummary[]; projectHash: string; cleanupDays: number; onOpen: (s: SessionSummary) => void; style?: CSSProperties }) {
  if (sessions.length === 0) return null
  return (
    <section className="cl-section" style={style}>
      <div className="cl-sec-head">
        <h2>Pinned sessions</h2>
        <span className="ct">{sessions.length} pinned</span>
      </div>
      <SessionRows sessions={sessions} projectHash={projectHash} cleanupDays={cleanupDays} onOpen={onOpen} />
    </section>
  )
}

function SessionRows({ sessions, projectHash, cleanupDays, onOpen }: { sessions: SessionSummary[]; projectHash: string; cleanupDays: number; onOpen: (s: SessionSummary) => void }) {
  const { isPinned, togglePin } = usePinnedSessions()
  const { tags: allTags, tagsForSession, toggleTagOnSession, removeTagFromSession } = useSessionTags(projectHash)
  const [pickerFor, setPickerFor] = useState<{ filename: string; rect: DOMRect } | null>(null)
  const [deleteFor, setDeleteFor] = useState<SessionSummary | null>(null)

  if (sessions.length === 0) return <div className="cl-empty">No sessions yet.</div>
  return (
    <div>
      {sessions.map((s, i) => {
        const fam = modelFamily(s.model)
        const pinnedNow = isPinned(projectHash, s.filename)
        const sessionTags = tagsForSession(s.filename)
        const isPickerOpen = pickerFor?.filename === s.filename
        return (
          <div
            key={s.filename}
            role="button"
            tabIndex={0}
            className={`cl-row has-pin${pinnedNow ? ' is-pinned' : ''}`}
            onClick={() => onOpen(s)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(s) } }}
          >
            <button
              type="button"
              className={`cl-pin-row${pinnedNow ? ' pinned' : ''}`}
              title={pinnedNow ? 'Unpin session' : 'Pin session'}
              aria-label={pinnedNow ? 'Unpin session' : 'Pin session'}
              onClick={e => { e.stopPropagation(); togglePin(projectHash, s.filename) }}
            >
              <PinIcon filled={pinnedNow} />
            </button>
            <span className="idx">{String(i + 1).padStart(2, '0')}</span>
            <div style={{ minWidth: 0 }}>
              <div className="title cl-row-title">
                <span className="cl-row-title-text">{sessionTitle(s)}</span>
                <ExpiryTag date={s.date} cleanupDays={cleanupDays} />
              </div>
              <div className="cl-row-meta">
                <span className="cl-row-meta-stats">{fmt(s.messageCount)} msg</span>
                {sessionTags.length > 0 && <span className="cl-row-meta-sep" aria-hidden>·</span>}
                <span className="cl-row-tags" onClick={e => e.stopPropagation()}>
                  {sessionTags.map((t, ti) => (
                    <span key={t} className="cl-row-tag-item">
                      {ti > 0 && <span className="cl-row-meta-sep" aria-hidden>·</span>}
                      <TagChip
                        name={t}
                        variant="plain"
                        tone="soft"
                        removable
                        onRemove={() => removeTagFromSession(s.filename, t)}
                      />
                    </span>
                  ))}
                </span>
                <button
                  type="button"
                  className="cl-row-tag-add"
                  data-haspicker={isPickerOpen}
                  aria-label="Add tag"
                  title="Add tag"
                  onClick={e => {
                    e.stopPropagation()
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setPickerFor({ filename: s.filename, rect })
                  }}
                >+ tag</button>
                <button
                  type="button"
                  className="cl-row-tag-add"
                  aria-label="Delete session"
                  title="Delete session"
                  style={{ color: 'var(--cl-danger)' }}
                  onClick={e => { e.stopPropagation(); setDeleteFor(s) }}
                >Delete</button>
              </div>
            </div>
            <span className={`model ${fam}`}><span className="dot" /> {s.model ? fmtModel(s.model) : '—'}</span>
            <span className="toks">{fmt(s.totalTokens)}<small>tok</small></span>
            <span className="when">{shortWhen(s.date)}</span>
          </div>
        )
      })}
      {pickerFor && (
        <TagPicker
          anchorRect={pickerFor.rect}
          allTags={allTags}
          selected={tagsForSession(pickerFor.filename)}
          onToggle={name => toggleTagOnSession(pickerFor.filename, name)}
          onClose={() => setPickerFor(null)}
        />
      )}
      {deleteFor && (
        <DeleteSessionDialog
          hash={projectHash}
          sessionFilename={deleteFor.filename}
          title={sessionTitle(deleteFor)}
          onCancel={() => setDeleteFor(null)}
          onDeleted={() => setDeleteFor(null)}
        />
      )}
    </div>
  )
}

function MemoryRows({
  topics,
  onOpen,
}: {
  topics: { name: string; description: string; type: string; filename: string; updatedAt: string }[]
  onOpen: (t: any) => void
}) {
  if (topics.length === 0) return <div className="cl-empty">No memory topics yet.</div>
  return (
    <div className="cl-mem">
      {topics.map(t => (
        <div key={t.filename} className="cl-mem-row" onClick={() => onOpen(t)}>
          <div className="key">{t.name}</div>
          <div className="val">{t.description ? memPreview(t.description) : '—'}</div>
          <div className="when">{relIso(t.updatedAt)}</div>
        </div>
      ))}
    </div>
  )
}
