import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useProjectCost,
  useMemoryProject,
  useSessionList,
  useClaudeMdHierarchy,
  useProjectRules,
  useGlobalMcp,
  useAllSkills,
  useGlobalAgents,
  useProjectAgents,
  useMemoryProjects,
  useCostSummary,
  useLiveSessions,
  ClaudeProcess,
} from '../../../hooks/useIPC'
import { View } from '../types'
import { fmt, fmtModel } from '../utils'
import type { SessionSummary, ProjectCost } from '../../../types'
import { Lens } from './Lens'

export type ProjectSection = 'overview' | 'sessions' | 'memory' | 'skills' | 'agents' | 'mcp'

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

// 12 weekly buckets, newest last
function weeklyBuckets(sessions: SessionSummary[], value: 'count' | 'tokens'): number[] {
  const n = 12
  const wk = 7 * 86400000
  const now = Date.now()
  const arr = new Array(n).fill(0)
  for (const s of sessions) {
    const t = new Date(s.date).getTime()
    if (isNaN(t)) continue
    const idx = n - 1 - Math.floor((now - t) / wk)
    if (idx >= 0 && idx < n) arr[idx] += value === 'tokens' ? s.totalTokens : 1
  }
  return arr
}

function Bars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  const peakIdx = values.indexOf(Math.max(...values))
  return (
    <div className="cl-bars">
      {values.map((v, i) => (
        <i
          key={i}
          className={v > 0 && i === peakIdx ? 'peak' : ''}
          style={{ height: `${v > 0 ? Math.max((v / max) * 100, 6) : 0}%` }}
        />
      ))}
    </div>
  )
}

const MEM_PREVIEW_MAX = 70

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
  onSelectProject,
  onDeleteProject,
}: {
  project: Project
  section: ProjectSection
  onNavigate: (v: View) => void
  onSelectProject: (p: Project) => void
  onDeleteProject: (p: Project) => void
}) {
  const { data: cost } = useProjectCost(project.hash)
  const { data: memory } = useMemoryProject(project.hash)
  const { data: sessions = [] } = useSessionList(project.hash)
  const { data: claudeMd } = useClaudeMdHierarchy(project.realPath)
  const { data: rules = [] } = useProjectRules(project.realPath)
  const { data: mcpData } = useGlobalMcp()
  const { data: allSkills = [] } = useAllSkills(project.realPath)
  const { data: globalAgents = [] } = useGlobalAgents()
  const { data: projectAgents = [] } = useProjectAgents(project.realPath)
  const { data: allProjects = [] } = useMemoryProjects()
  const { data: costSummary } = useCostSummary()
  const { data: bgSessions = [] } = useLiveSessions()

  const projectBgSessions = bgSessions.filter(
    s => s.cwd === project.realPath || s.cwd.startsWith(project.realPath + '/')
  )
  const liveBgCount = projectBgSessions.filter(s => s.alive).length

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
  const projectName = project.realPath.split('/').pop() ?? project.realPath
  const sessionCount = cost?.sessionsCount ?? sessions.length
  const totalTokens = cost?.totalTokens ?? sessions.reduce((s, x) => s + x.totalTokens, 0)
  const tokensFmt = formatTokens(totalTokens)
  const avgTokens = sessionCount > 0 ? formatTokens(Math.round(totalTokens / sessionCount)) : { value: '0', unit: '' }
  const lastActive = sessions[0]?.date
  const last7 = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000
    return sessions.filter(s => new Date(s.date).getTime() >= cutoff).length
  }, [sessions])

  const sessBars = useMemo(() => weeklyBuckets(sessions, 'count'), [sessions])
  const tokBars = useMemo(() => weeklyBuckets(sessions, 'tokens'), [sessions])
  const avgBars = useMemo(() => {
    const c = weeklyBuckets(sessions, 'count')
    const t = weeklyBuckets(sessions, 'tokens')
    return t.map((v, i) => (c[i] > 0 ? v / c[i] : 0))
  }, [sessions])

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

  const projectClaudeMd = claudeMd?.layers.find(l => l.scope === 'project')
  const claudeMdLayers = claudeMd?.layers.length ?? 0
  const skillCount = allSkills.length
  const agents = useMemo(() => {
    const seen = new Map<string, typeof globalAgents[number]>()
    for (const a of [...projectAgents, ...globalAgents]) if (!seen.has(a.name)) seen.set(a.name, a)
    return [...seen.values()]
  }, [projectAgents, globalAgents])
  const agentCount = agents.length
  const memoryCount = memTopics.length

  // ── Project picker ──
  const costByHash = useMemo(() => {
    const m = new Map<string, ProjectCost>()
    for (const c of (costSummary as ProjectCost[] | undefined) ?? []) m.set(c.project, c)
    return m
  }, [costSummary])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [query, setQuery] = useState('')
  const [hl, setHl] = useState(0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? allProjects.filter(p => p.realPath.toLowerCase().includes(q))
      : allProjects
    return [...list].sort((a, b) => (costByHash.get(b.hash)?.totalTokens ?? 0) - (costByHash.get(a.hash)?.totalTokens ?? 0))
  }, [allProjects, costByHash, query])

  function openPicker() {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setPickerPos({ top: r.bottom + 8, left: r.left })
    setQuery('')
    setHl(0)
    setPickerOpen(true)
    setTimeout(() => inputRef.current?.focus(), 10)
  }
  function closePicker() { setPickerOpen(false) }

  useEffect(() => {
    if (!pickerOpen) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      closePicker()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  function choose(p: Project) { onSelectProject(p); closePicker() }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(filtered.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[hl]) choose(filtered[hl]) }
    else if (e.key === 'Escape') { closePicker() }
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* ─── HERO ─────────────────────────────────────── */}
      <section className="cl-hero">
        <Lens />
        <div className="cl-hero-actions">
          <button className="cl-btn" type="button" onClick={() => window.electronAPI.sessions.newInTerminal(project.realPath)}>
            Open in Claude Code
          </button>
          <button className="cl-btn cl-btn--primary" type="button" onClick={() => onNavigate({ type: 'sessions', project })}>
            Sessions →
          </button>
        </div>

        <div className="cl-eyebrow">
          <span className="pip" />
          <span title={project.realPath}>Project · {project.realPath}</span>
        </div>

        <button ref={triggerRef} className="cl-h-name" type="button" onClick={openPicker} aria-haspopup="listbox">
          <span className="label-name">{projectName}</span><span className="glyph">.</span>
          <span className="chev">↓</span>
        </button>

        <div className="cl-h-meta">
          <span><b>{fmt(sessionCount)}</b> sessions</span>
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
              <Bars values={sessBars} />
              <div className="delta">↑ {last7} · last 7d</div>
            </div>
            <div className="cl-stat">
              <span className="lbl">Tokens</span>
              <div className="num">{tokensFmt.value}<small>{tokensFmt.unit}</small></div>
              <Bars values={tokBars} />
              <div className="delta">est. ${(cost?.cost ?? 0).toFixed(2)}</div>
            </div>
            <div className="cl-stat">
              <span className="lbl">Avg / session</span>
              <div className="num">{avgTokens.value}<small>{avgTokens.unit || 'tok'}</small></div>
              <Bars values={avgBars} />
              <div className="delta">across {sessionCount} sessions</div>
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

          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Sessions</h2>
              <span className="ct">{Math.min(5, sessions.length)} of {sessions.length}</span>
              <button className="all" type="button" onClick={() => onNavigate({ type: 'sessions', project })}>View all</button>
            </div>
            <SessionRows sessions={sessions.slice(0, 5)} onOpen={s => onNavigate({ type: 'chat', project, session: s })} />
          </section>

          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Memory</h2>
              <span className="ct">{memoryCount} topics</span>
              <button className="all" type="button" onClick={() => onNavigate({ type: 'project-memory', project })}>Edit</button>
            </div>
            <MemoryRows
              topics={memTopics.slice(0, 4)}
              onOpen={t => onNavigate({ type: 'memory-topic', topic: t, content: topicContent(t.filename), hash: project.hash })}
            />
          </section>

          <section className="cl-config-strip">
            <button className={`item ${claudeMdLayers ? 'on' : ''}`} type="button"
              onClick={() => projectClaudeMd ? onNavigate({ type: 'project-claudemd', project, layer: projectClaudeMd }) : onNavigate({ type: 'global-claudemd' })}>
              <span className="pip" /><span>CLAUDE.md</span><span className="num">{claudeMdLayers} layer{claudeMdLayers === 1 ? '' : 's'}</span>
            </button>
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
            <button className={`item ${projectBgSessions.length ? 'on' : ''}`} type="button" onClick={() => onNavigate({ type: 'agents-live', project })}>
              <span className="pip" /><span>Agents Live</span><span className="num">{liveBgCount} live · {projectBgSessions.length}</span>
            </button>
          </section>
        </>
      )}

      {section === 'sessions' && (
        <section className="cl-section" style={{ paddingTop: 38 }}>
          <div className="cl-sec-head">
            <h2>Sessions</h2>
            <span className="ct">{sessions.length} total · sorted by last activity</span>
          </div>
          <SessionRows sessions={sessions} onOpen={s => onNavigate({ type: 'chat', project, session: s })} />
        </section>
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
            <button className="all" type="button" onClick={() => onNavigate({ type: 'global-skills' })}>Manage</button>
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
                    <div className="t-name">/{s.name}</div>
                    <div className="t-desc">{s.description || '—'}</div>
                  </div>
                  <span className="t-meta"><b>{s.scope}</b></span>
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
            <button className="all" type="button" onClick={() => onNavigate({ type: 'global-agents' })}>Manage</button>
          </div>
          {agentCount === 0 ? (
            <div className="cl-empty">No agents available for this project.</div>
          ) : (
            <div className="cl-tile-grid">
              {agents.map((a, i) => {
                const glyphs = ['◐', '◑', '◒', '◓']
                const mode = a.disableModelInvocation ? 'manual' : 'auto'
                return (
                  <button key={a.path} type="button" className={`cl-tile ${i === 0 ? 'accent' : ''}`}
                    onClick={() => onNavigate({ type: 'agent-detail', agent: a })}>
                    <span className="glyph">{glyphs[i % glyphs.length]}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="t-name">{a.name}</div>
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
          <div className="cl-sec-head">
            <h2>MCP servers</h2>
            <span className="ct">{enabledMcp.length} active · project-scoped</span>
            <button className="all" type="button" onClick={() => onNavigate({ type: 'global-mcp' })}>Manage</button>
          </div>
          {enabledMcp.length === 0 ? (
            <div className="cl-empty">No MCP servers active for this project.</div>
          ) : (
            <div className="cl-mcp-row" style={{ gridTemplateColumns: `repeat(${Math.min(3, enabledMcp.length)}, 1fr)` }}>
              {enabledMcp.slice(0, 3).map((s, i) => {
                const tone = ['', 'violet', 'cyan'][i % 3]
                const total = s.enabledInProjects + s.disabledInProjects
                return (
                  <button key={s.name} type="button" className={`cl-mcp-cell ${tone}`} onClick={() => onNavigate({ type: 'global-mcp' })}>
                    <div className="led-row"><span className="led" /> {s.source}</div>
                    <div className="mcp-name">{s.name.replace(/^claude\.ai\s*/i, '')}</div>
                    <div className="tools">active in <b>{s.enabledInProjects}</b> of {total} projects</div>
                    <div className="frac">{s.enabledInProjects}<small>/{total}</small></div>
                  </button>
                )
              })}
            </div>
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

      {/* ─── PROJECT PICKER ───────────────────────────── */}
      {pickerOpen && (
        <div
          ref={popRef}
          className="cl-picker-pop"
          style={{ position: 'fixed', top: pickerPos.top, left: pickerPos.left }}
        >
          <div className="cl-picker-search-row">
            <span style={{ color: 'var(--cl-ink-4)' }}>⌕</span>
            <input
              ref={inputRef}
              placeholder="Search projects…"
              autoComplete="off"
              value={query}
              onChange={e => { setQuery(e.target.value); setHl(0) }}
              onKeyDown={onKey}
            />
            <span className="esc" onClick={closePicker}>esc</span>
          </div>
          <div className="cl-picker-list">
            {filtered.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cl-ink-4)' }}>
                No projects match “{query}”
              </div>
            ) : (
              filtered.map((p, i) => {
                const name = p.realPath.split('/').pop() ?? p.realPath
                const c = costByHash.get(p.hash)
                const isActive = p.hash === project.hash
                return (
                  <div
                    key={p.hash}
                    className={`cl-picker-item ${isActive ? 'active' : ''} ${i === hl ? 'hl' : ''}`}
                    onMouseEnter={() => setHl(i)}
                    onClick={() => choose(p)}
                    style={{ display: 'grid' }}
                  >
                    <span className="pglyph">{(name[0] ?? '?').toUpperCase()}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="pname">{name}</div>
                      <div className="ppath">{p.realPath}</div>
                    </div>
                    <span className="pcount">{c?.sessionsCount ?? 0}</span>
                  </div>
                )
              })
            )}
          </div>
          <div className="cl-picker-foot">
            <span><b>↑↓</b> navigate</span>
            <span><b>↵</b> open</span>
            <button
              type="button"
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--cl-ink-4)', cursor: 'pointer', font: 'inherit' }}
              onClick={() => { closePicker(); onDeleteProject(project) }}
            >
              Remove current
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SessionRows({ sessions, onOpen }: { sessions: SessionSummary[]; onOpen: (s: SessionSummary) => void }) {
  if (sessions.length === 0) return <div className="cl-empty">No sessions yet.</div>
  return (
    <div>
      {sessions.map((s, i) => {
        const fam = modelFamily(s.model)
        return (
          <button key={s.filename} type="button" className="cl-row" onClick={() => onOpen(s)}>
            <span className="idx">{String(i + 1).padStart(2, '0')}</span>
            <div style={{ minWidth: 0 }}>
              <div className="title">{s.customTitle || `Session ${shortWhen(s.date)}`}</div>
              <div className="file">{s.filename}</div>
            </div>
            <span className={`model ${fam}`}><span className="dot" /> {s.model ? fmtModel(s.model) : '—'}</span>
            <span className="toks">{fmt(s.totalTokens)}<small>tok</small></span>
            <span className="when">{shortWhen(s.date)}</span>
          </button>
        )
      })}
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
