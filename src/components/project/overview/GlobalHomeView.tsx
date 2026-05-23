import { useEffect, useMemo, useState } from 'react'
import {
  useGlobalSkills,
  useGlobalAgents,
  useGlobalMcp,
  useMemoryProjects,
  useCostSummary,
  useGlobalClaudeMd,
  ClaudeProcess,
} from '../../../hooks/useIPC'
import { View } from '../types'
import type { ProjectCost } from '../../../types'
import { Lens } from './Lens'
import { DuplicateProjectsBadge } from './DuplicateProjectsNotice'

type Project = { hash: string; realPath: string }

const PROJECTS_PAGE_SIZE = 5
const MCP_PAGE_SIZE = 6

type SortKey = 'tokens' | 'cost' | 'sessions' | 'name'
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'tokens', label: 'tokens' },
  { key: 'cost', label: 'cost' },
  { key: 'sessions', label: 'sessions' },
  { key: 'name', label: 'name' },
]

type McpSortKey = 'projects' | 'name' | 'source'
const MCP_SORT_OPTIONS: { key: McpSortKey; label: string }[] = [
  { key: 'projects', label: 'projects' },
  { key: 'name', label: 'name' },
  { key: 'source', label: 'source' },
]

function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i)
  const out: (number | 'gap')[] = [0]
  const start = Math.max(1, current - 1)
  const end = Math.min(total - 2, current + 1)
  if (start > 1) out.push('gap')
  for (let i = start; i <= end; i++) out.push(i)
  if (end < total - 2) out.push('gap')
  out.push(total - 1)
  return out
}

function formatTokens(n: number): { value: string; unit: string } {
  if (n >= 1_000_000_000) return { value: (n / 1_000_000_000).toFixed(1), unit: 'b' }
  if (n >= 1_000_000)     return { value: (n / 1_000_000).toFixed(1), unit: 'm' }
  if (n >= 1_000)         return { value: Math.round(n / 1_000).toString(), unit: 'k' }
  return { value: String(n), unit: '' }
}

export function GlobalHomeView({
  onNavigate,
  onSelectProject,
}: {
  onNavigate: (v: View) => void
  onSelectProject: (p: Project) => void
}) {
  const { data: skills = [] } = useGlobalSkills()
  const { data: agents = [] } = useGlobalAgents()
  const { data: mcpData } = useGlobalMcp()
  const { data: allProjects = [] } = useMemoryProjects()
  const { data: costSummary } = useCostSummary()
  const { data: globalClaudeMd } = useGlobalClaudeMd()

  const [procs, setProcs] = useState<ClaudeProcess[]>([])
  const [projectsPage, setProjectsPage] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('tokens')
  const [mcpPage, setMcpPage] = useState(0)
  const [mcpSortKey, setMcpSortKey] = useState<McpSortKey>('projects')
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

  const costByHash = useMemo(() => {
    const m = new Map<string, ProjectCost>()
    for (const c of (costSummary as ProjectCost[] | undefined) ?? []) m.set(c.project, c)
    return m
  }, [costSummary])

  const sortedProjects = useMemo(() => {
    const arr = [...allProjects]
    const nameOf = (p: Project) => (p.realPath.split('/').pop() ?? p.realPath).toLowerCase()
    switch (sortKey) {
      case 'cost':
        return arr.sort((a, b) => (costByHash.get(b.hash)?.cost ?? 0) - (costByHash.get(a.hash)?.cost ?? 0))
      case 'sessions':
        return arr.sort((a, b) => (costByHash.get(b.hash)?.sessionsCount ?? 0) - (costByHash.get(a.hash)?.sessionsCount ?? 0))
      case 'name':
        return arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
      case 'tokens':
      default:
        return arr.sort((a, b) => (costByHash.get(b.hash)?.totalTokens ?? 0) - (costByHash.get(a.hash)?.totalTokens ?? 0))
    }
  }, [allProjects, costByHash, sortKey])

  const pageCount = Math.max(1, Math.ceil(sortedProjects.length / PROJECTS_PAGE_SIZE))
  const safePage = Math.min(projectsPage, pageCount - 1)
  const pagedProjects = sortedProjects.slice(
    safePage * PROJECTS_PAGE_SIZE,
    (safePage + 1) * PROJECTS_PAGE_SIZE,
  )
  const rangeFrom = sortedProjects.length === 0 ? 0 : safePage * PROJECTS_PAGE_SIZE + 1
  const rangeTo = Math.min((safePage + 1) * PROJECTS_PAGE_SIZE, sortedProjects.length)

  const projectByPath = useMemo(() => {
    const m = new Map<string, Project>()
    for (const p of allProjects) m.set(p.realPath, p)
    return m
  }, [allProjects])

  const mcpServers = useMemo(
    () => [...(mcpData?.cloudServers ?? []), ...(mcpData?.localServers ?? [])],
    [mcpData],
  )
  const sortedMcpServers = useMemo(() => {
    const arr = [...mcpServers]
    const displayName = (n: string) => n.replace(/^claude\.ai\s*/i, '').toLowerCase()
    switch (mcpSortKey) {
      case 'name':
        return arr.sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)))
      case 'source':
        return arr.sort((a, b) => a.source.localeCompare(b.source) || displayName(a.name).localeCompare(displayName(b.name)))
      case 'projects':
      default:
        return arr.sort((a, b) => b.enabledInProjects - a.enabledInProjects)
    }
  }, [mcpServers, mcpSortKey])
  const mcpPageCount = Math.max(1, Math.ceil(sortedMcpServers.length / MCP_PAGE_SIZE))
  const safeMcpPage = Math.min(mcpPage, mcpPageCount - 1)
  const pagedMcpServers = sortedMcpServers.slice(
    safeMcpPage * MCP_PAGE_SIZE,
    (safeMcpPage + 1) * MCP_PAGE_SIZE,
  )
  const mcpRangeFrom = sortedMcpServers.length === 0 ? 0 : safeMcpPage * MCP_PAGE_SIZE + 1
  const mcpRangeTo = Math.min((safeMcpPage + 1) * MCP_PAGE_SIZE, sortedMcpServers.length)
  const claudeMdLines = (globalClaudeMd ?? '').split('\n').length

  function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* ─── HERO ─────────────────────────────────────── */}
      <section className="cl-hero">
        <Lens />
        <div className="cl-eyebrow">
          <span className="pip" />
          <span>Global · ~ · shared across all projects on this machine</span>
        </div>
        <h1 className="cl-h-name static">
          <span className="label-name">Global</span><span className="glyph">.</span>
        </h1>
        <div className="cl-h-meta">
          <span><b>{allProjects.length}</b> projects</span>
          <span className="sep">·</span>
          <span><b>{procs.length}</b> sessions running</span>
          <span className="sep">·</span>
          <span><b>{skills.length}</b> skills</span>
          <span className="sep">·</span>
          <span><b>{agents.length}</b> agents</span>
          <span className="sep">·</span>
          <span><b>{mcpServers.length}</b> MCP servers</span>
        </div>
      </section>

      {/* ─── DUPLICATE PROJECTS (segnale compatto) ────── */}
      <DuplicateProjectsBadge onNavigate={onNavigate} />

      {/* ─── LIVE PROCESSES ───────────────────────────── */}
      {procs.length > 0 && (
        <section className="cl-section">
          <div className="cl-sec-head">
            <h2>Live processes</h2>
            <span className="ct">{procs.length} running · auto-refresh</span>
          </div>
          <div className="cl-proc-list">
            {procs.map(p => {
              const name = p.cwd.split('/').pop() ?? p.cwd
              const proj = projectByPath.get(p.cwd)
              return (
                <button key={p.pid} type="button" className="cl-proc"
                  onClick={() => proj && onSelectProject(proj)}>
                  <span className="led" />
                  <span className="pid">PID {p.pid}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="pname">{name}</div>
                    <div className="pcmd">{p.cmdline || 'claude'}</div>
                  </div>
                  <span className="ppath">{p.cwd}</span>
                  <span className="arrow">→</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* ─── PROJECTS ─────────────────────────────────── */}
      <section className="cl-section">
        <div className="cl-sec-head">
          <h2>Projects</h2>
          <span className="ct">
            {sortedProjects.length === 0
              ? '0 total · sorted by token usage'
              : `${rangeFrom}–${rangeTo} of ${sortedProjects.length} · sorted by ${SORT_OPTIONS.find(o => o.key === sortKey)?.label ?? 'tokens'}`}
          </span>
          {sortedProjects.length > 0 && (
            <span className="cl-sortbar" style={{ marginLeft: 'auto' }}>
              <span className="label">SORT BY</span>
              {SORT_OPTIONS.map((o, i) => (
                <span key={o.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span className="sep">·</span>}
                  <button
                    type="button"
                    className={`opt${sortKey === o.key ? ' on' : ''}`}
                    onClick={() => { setSortKey(o.key); setProjectsPage(0) }}
                  >
                    {o.label}
                  </button>
                </span>
              ))}
            </span>
          )}
        </div>
        {sortedProjects.length === 0 ? (
          <div className="cl-empty">No projects yet.</div>
        ) : (
          <>
            <div>
              {pagedProjects.map(p => {
                const name = p.realPath.split('/').pop() ?? p.realPath
                const c = costByHash.get(p.hash)
                const tokens = formatTokens(c?.totalTokens ?? 0)
                const isLive = procs.some(pr => pr.cwd === p.realPath)
                return (
                  <button key={p.hash} type="button" className="cl-row" onClick={() => onSelectProject(p)}>
                    <span className="idx">{(name[0] ?? '?').toUpperCase()}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="title">{name}{isLive && <span style={{ color: 'var(--cl-ok)', fontSize: 11, marginLeft: 10, fontFamily: 'var(--font-mono)' }}>● live</span>}</div>
                      <div className="file">{p.realPath}</div>
                    </div>
                    <span className="when" style={{ textAlign: 'left' }}>{c?.sessionsCount ?? 0} sessions</span>
                    <span className="toks">{tokens.value}{tokens.unit}<small>tok</small></span>
                    <span className="when">{c ? `$${c.cost.toFixed(2)}` : '—'}</span>
                  </button>
                )
              })}
            </div>
            {pageCount > 1 && (
              <div className="cl-pag">
                <span className="cl-pag-meter">
                  PAGE <b>{String(safePage + 1).padStart(2, '0')}</b> / {String(pageCount).padStart(2, '0')}
                </span>
                <div className="cl-pag-side">
                  <button
                    type="button"
                    className="cl-pag-btn"
                    disabled={safePage === 0}
                    onClick={() => setProjectsPage(safePage - 1)}
                  >
                    <span className="arrow">←</span> PREV
                  </button>
                  <div className="cl-pag-nums">
                    {pageWindow(safePage, pageCount).map((p, i) =>
                      p === 'gap' ? (
                        <span key={`gap-${i}`} className="cl-pag-ellipsis">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          className={`cl-pag-num${p === safePage ? ' on' : ''}`}
                          onClick={() => setProjectsPage(p)}
                        >
                          {String(p + 1).padStart(2, '0')}
                        </button>
                      ),
                    )}
                  </div>
                  <button
                    type="button"
                    className="cl-pag-btn"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setProjectsPage(safePage + 1)}
                  >
                    NEXT <span className="arrow">→</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ─── CONFIGURATION ────────────────────────────── */}
      <section className="cl-section">
        <div className="cl-sec-head">
          <h2>Configuration</h2>
          <span className="ct">shared across all projects</span>
        </div>
        <div className="cl-tile-grid">
          <button type="button" className="cl-tile accent" onClick={() => onNavigate({ type: 'global-claudemd' })}>
            <span className="glyph">M</span>
            <div>
              <div className="t-name">CLAUDE.md</div>
              <div className="t-desc">Global instructions injected into every Claude Code session.</div>
            </div>
            <span className="t-meta">{globalClaudeMd ? <><b>{claudeMdLines}</b> lines</> : 'not set'}</span>
          </button>
          <button type="button" className="cl-tile" onClick={() => onNavigate({ type: 'global-skills' })}>
            <span className="glyph">S</span>
            <div>
              <div className="t-name">Skills</div>
              <div className="t-desc">Reusable, invocable behaviors available to every project.</div>
            </div>
            <span className="t-meta"><b>{skills.length}</b> skills</span>
          </button>
          <button type="button" className="cl-tile" onClick={() => onNavigate({ type: 'global-agents' })}>
            <span className="glyph">A</span>
            <div>
              <div className="t-name">Agents</div>
              <div className="t-desc">Specialized sub-agents available to delegate to.</div>
            </div>
            <span className="t-meta"><b>{agents.length}</b> agents</span>
          </button>
          <button type="button" className="cl-tile" onClick={() => onNavigate({ type: 'global-mcp' })}>
            <span className="glyph">N</span>
            <div>
              <div className="t-name">MCP servers</div>
              <div className="t-desc">Model Context Protocol integrations, shared across projects.</div>
            </div>
            <span className="t-meta"><b>{mcpServers.length}</b> servers</span>
          </button>
        </div>
      </section>

      {/* ─── MCP SERVERS ──────────────────────────────── */}
      {mcpServers.length > 0 && (
        <section className="cl-section">
          <div className="cl-sec-head">
            <h2>MCP servers</h2>
            <span className="ct">
              {`${mcpRangeFrom}–${mcpRangeTo} of ${sortedMcpServers.length} · sorted by ${MCP_SORT_OPTIONS.find(o => o.key === mcpSortKey)?.label ?? 'projects'}`}
            </span>
            <span className="cl-sortbar" style={{ marginLeft: 'auto' }}>
              <span className="label">SORT BY</span>
              {MCP_SORT_OPTIONS.map((o, i) => (
                <span key={o.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span className="sep">·</span>}
                  <button
                    type="button"
                    className={`opt${mcpSortKey === o.key ? ' on' : ''}`}
                    onClick={() => { setMcpSortKey(o.key); setMcpPage(0) }}
                  >
                    {o.label}
                  </button>
                </span>
              ))}
            </span>
          </div>
          {chunk(pagedMcpServers, 3).map((group, gi) => (
            <div
              key={gi}
              className="cl-mcp-row"
              style={{ gridTemplateColumns: `repeat(${group.length}, 1fr)` }}
            >
              {group.map((s, i) => {
                const tone = ['', 'violet', 'cyan'][(gi * 3 + i) % 3]
                const total = s.enabledInProjects + s.disabledInProjects
                return (
                  <button
                    key={s.name}
                    type="button"
                    className={`cl-mcp-cell ${tone}`}
                    onClick={() => onNavigate({ type: 'mcp-detail', server: s, totalProjects: total })}
                  >
                    <div className="led-row"><span className="led" /> {s.source}</div>
                    <div className="mcp-name">{s.name.replace(/^claude\.ai\s*/i, '')}</div>
                    <div className="tools">active in <b>{s.enabledInProjects}</b> of {total} projects</div>
                    <div className="frac">{s.enabledInProjects}<small>/{total}</small></div>
                  </button>
                )
              })}
            </div>
          ))}
          {mcpPageCount > 1 && (
            <div className="cl-pag">
              <span className="cl-pag-meter">
                PAGE <b>{String(safeMcpPage + 1).padStart(2, '0')}</b> / {String(mcpPageCount).padStart(2, '0')}
              </span>
              <div className="cl-pag-side">
                <button
                  type="button"
                  className="cl-pag-btn"
                  disabled={safeMcpPage === 0}
                  onClick={() => setMcpPage(safeMcpPage - 1)}
                >
                  <span className="arrow">←</span> PREV
                </button>
                <div className="cl-pag-nums">
                  {pageWindow(safeMcpPage, mcpPageCount).map((p, i) =>
                    p === 'gap' ? (
                      <span key={`gap-${i}`} className="cl-pag-ellipsis">…</span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        className={`cl-pag-num${p === safeMcpPage ? ' on' : ''}`}
                        onClick={() => setMcpPage(p)}
                      >
                        {String(p + 1).padStart(2, '0')}
                      </button>
                    ),
                  )}
                </div>
                <button
                  type="button"
                  className="cl-pag-btn"
                  disabled={safeMcpPage >= mcpPageCount - 1}
                  onClick={() => setMcpPage(safeMcpPage + 1)}
                >
                  NEXT <span className="arrow">→</span>
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
