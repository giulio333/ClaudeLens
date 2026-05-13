import { useState, useEffect, useMemo } from 'react'
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

type Category = 'skill' | 'agent' | 'memory' | 'mcp' | 'claude'

const CATEGORIES: Category[] = ['skill', 'agent', 'memory', 'mcp', 'claude']

const CAT_TOKENS: Record<Category, { fg: string; tint: string; border: string }> = {
  skill:  { fg: 'oklch(0.78 0.13 210)', tint: 'oklch(0.78 0.13 210 / 0.15)', border: 'oklch(0.78 0.13 210 / 0.30)' },
  agent:  { fg: 'oklch(0.78 0.13 155)', tint: 'oklch(0.78 0.13 155 / 0.15)', border: 'oklch(0.78 0.13 155 / 0.30)' },
  memory: { fg: 'oklch(0.80 0.13 85)',  tint: 'oklch(0.80 0.13 85 / 0.15)',  border: 'oklch(0.80 0.13 85 / 0.30)'  },
  mcp:    { fg: 'oklch(0.72 0.15 295)', tint: 'oklch(0.72 0.15 295 / 0.18)', border: 'oklch(0.72 0.15 295 / 0.30)' },
  claude: { fg: 'oklch(0.74 0.13 25)',  tint: 'oklch(0.74 0.13 25 / 0.15)',  border: 'oklch(0.74 0.13 25 / 0.30)'  },
}

function pickCategory(seed: string): Category {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return CATEGORIES[h % CATEGORIES.length]
}

function formatTokens(n: number): { value: string; unit: string } {
  if (n >= 1_000_000_000) return { value: (n / 1_000_000_000).toFixed(1), unit: 'B' }
  if (n >= 1_000_000)     return { value: (n / 1_000_000).toFixed(1), unit: 'M' }
  if (n >= 1_000)         return { value: (n / 1_000).toFixed(1), unit: 'K' }
  return { value: String(n), unit: '' }
}

function formatRelative(durationSec: number): string {
  if (durationSec < 60) return `${durationSec}s`
  const m = Math.floor(durationSec / 60)
  const s = durationSec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function Sparkline({ values, color, w = 100, h = 24 }: { values: number[]; color: string; w?: number; h?: number }) {
  if (values.length < 2) values = [0, 1, 0, 1]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(' ')
  const area = `0,${h} ${pts} ${w},${h}`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ color, display: 'block' }}>
      <polygon points={area} fill="currentColor" opacity="0.15" />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function GlobalHomeView({
  onNavigate,
  onSelectProject,
}: {
  onNavigate: (v: View) => void
  onSelectProject: (p: { hash: string; realPath: string }) => void
}) {
  const { data: skills } = useGlobalSkills()
  const { data: agents } = useGlobalAgents()
  const { data: mcpData } = useGlobalMcp()
  const { data: allProjects = [] } = useMemoryProjects()
  const { data: costSummary } = useCostSummary()
  const { data: globalClaudeMd } = useGlobalClaudeMd()

  const [activeProcesses, setActiveProcesses] = useState<ClaudeProcess[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    async function load() {
      try {
        const r = await window.electronAPI.live.getProcesses()
        if (r.data) setActiveProcesses(r.data)
      } catch { /* ignore */ }
    }
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Map cost data per project hash
  const costByHash = useMemo(() => {
    const m = new Map<string, ProjectCost>()
    for (const c of (costSummary as ProjectCost[] | undefined) ?? []) m.set(c.project, c)
    return m
  }, [costSummary])

  const liveProcess = activeProcesses[0]
  const liveProject = liveProcess
    ? allProjects.find(p => p.realPath === liveProcess.cwd)
    : undefined

  const liveStartRef = useMemo(() => Date.now(), [liveProcess?.pid])
  const liveDurationSec = liveProcess ? Math.floor((Date.now() - liveStartRef) / 1000) + tick * 0 : 0

  const totalSessions = (costSummary as ProjectCost[] | undefined)?.reduce((s, c) => s + c.sessionsCount, 0) ?? 0
  const totalTokens   = (costSummary as ProjectCost[] | undefined)?.reduce((s, c) => s + c.totalTokens, 0) ?? 0
  const tokensFmt     = formatTokens(totalTokens)
  const mcpCount      = (mcpData?.cloudServers?.length ?? 0) + (mcpData?.localServers?.length ?? 0)
  const claudeMdLines = (globalClaudeMd ?? '').split('\n').length

  const sortedProjects = useMemo(() => {
    return [...allProjects].sort((a, b) => {
      const ca = costByHash.get(a.hash)?.totalTokens ?? 0
      const cb = costByHash.get(b.hash)?.totalTokens ?? 0
      return cb - ca
    })
  }, [allProjects, costByHash])

  // Aggregate sparkline for stats: derive from per-project session counts
  const tokensSpark = useMemo(() => {
    const arr = sortedProjects.slice(0, 12).map(p => costByHash.get(p.hash)?.totalTokens ?? 0)
    return arr.length ? arr : [0, 1, 0]
  }, [sortedProjects, costByHash])

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: 'var(--cl-bg, #0a0c11)',
        fontFamily: "'Geist', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        color: '#e8ecf3',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');
        .gov-root {
          --bg: #0a0c11;
          --bg-elev: #0f1218;
          --bg-elev-2: #141822;
          --bg-hover: #1a1f2b;
          --border: rgba(255,255,255,0.06);
          --border-strong: rgba(255,255,255,0.12);
          --fg: #e8ecf3;
          --fg-muted: #8a93a6;
          --fg-dim: #5a6273;
          --fg-faint: #3d4454;
          --accent: oklch(0.78 0.13 210);
          --success: oklch(0.75 0.17 150);
        }
        .gov-mono { font-family: 'Geist Mono','JetBrains Mono','SF Mono',monospace; }
        .gov-band {
          background: var(--bg-elev);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 24px 28px;
        }
        .gov-band--stats { padding: 20px 28px; }
        .gov-band--hero {
          background:
            radial-gradient(circle at 0% 0%, oklch(0.75 0.17 150 / 0.12), transparent 50%),
            var(--bg-elev);
        }
        .gov-band--hero[data-live="true"] {
          border-color: oklch(0.75 0.17 150 / 0.25);
        }
        .gov-kicker {
          font-family: 'Geist Mono',monospace;
          font-size: 10.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--fg-dim);
        }
        .gov-hero-title {
          font-size: 44px;
          font-weight: 500;
          letter-spacing: -0.03em;
          line-height: 1;
          margin: 8px 0 14px;
          color: var(--fg);
        }
        .gov-hero-sub {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          align-items: center;
          font-family: 'Geist Mono',monospace;
          font-size: 12px;
          color: var(--fg-muted);
        }
        .gov-live-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 99px;
          background: oklch(0.75 0.17 150 / 0.14);
          color: var(--success);
          font-family: 'Geist Mono',monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 500;
        }
        .gov-live-pill::before {
          content: '';
          width: 6px; height: 6px;
          border-radius: 50%;
          background: currentColor;
          box-shadow: 0 0 8px currentColor;
          animation: govPulse 2s infinite;
        }
        @keyframes govPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
        .gov-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: 6px;
          background: var(--bg-elev-2);
          border: 1px solid var(--border-strong);
          color: var(--fg);
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }
        .gov-btn:hover { background: var(--bg-hover); }
        .gov-btn--primary {
          background: var(--accent);
          color: #0a0c11;
          border-color: transparent;
          font-weight: 500;
        }
        .gov-btn--primary:hover { background: oklch(0.82 0.13 210); }
        .gov-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 32px;
        }
        .gov-stat { border-right: 1px dashed var(--border); padding-right: 20px; }
        .gov-stat:last-child { border-right: none; }
        .gov-stat-l {
          font-family: 'Geist Mono',monospace;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--fg-dim);
          margin-bottom: 10px;
        }
        .gov-stat-n {
          font-size: 32px;
          font-weight: 500;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
          color: var(--fg);
          line-height: 1;
        }
        .gov-stat-n .u {
          font-size: 14px;
          color: var(--fg-dim);
          margin-left: 3px;
        }
        .gov-stat-d {
          font-family: 'Geist Mono',monospace;
          font-size: 10.5px;
          color: var(--fg-dim);
          margin-top: 8px;
        }
        .gov-band-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 4px;
        }
        .gov-band-head h2 {
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.005em;
          color: var(--fg);
          margin: 0;
        }
        .gov-band-head .meta {
          font-family: 'Geist Mono',monospace;
          font-size: 11px;
          color: var(--fg-dim);
        }
        .gov-proj-row {
          display: grid;
          grid-template-columns: 36px 1.4fr 100px 100px 110px 90px;
          gap: 16px;
          align-items: center;
          padding: 14px 8px;
          border-bottom: 1px dashed var(--border);
          cursor: pointer;
          border-radius: 6px;
          transition: background 120ms ease;
          background: transparent;
          border-left: none; border-right: none; border-top: none;
          width: 100%;
          text-align: left;
          font: inherit;
          color: inherit;
        }
        .gov-proj-row:hover { background: var(--bg-hover); }
        .gov-proj-row:last-child { border-bottom: none; }
        .gov-proj-mark {
          width: 36px; height: 36px;
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Geist Mono',monospace;
          font-size: 14px;
          font-weight: 700;
        }
        .gov-proj-name {
          font-size: 15px;
          font-weight: 500;
          color: var(--fg);
          display: flex; align-items: center; gap: 10px;
        }
        .gov-proj-path {
          font-family: 'Geist Mono',monospace;
          font-size: 11.5px;
          color: var(--fg-dim);
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .gov-proj-cell { display: flex; flex-direction: column; gap: 4px; }
        .gov-proj-cell .l {
          font-family: 'Geist Mono',monospace;
          font-size: 9.5px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--fg-dim);
        }
        .gov-proj-cell .v {
          font-family: 'Geist Mono',monospace;
          font-size: 12px;
          color: var(--fg);
          font-variant-numeric: tabular-nums;
        }
        .gov-split {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 32px;
        }
        .gov-shared-row {
          display: grid;
          grid-template-columns: 34px 1fr auto;
          gap: 14px;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px dashed var(--border);
          background: transparent;
          border-left: none; border-right: none; border-top: none;
          width: 100%;
          text-align: left;
          font: inherit;
          color: inherit;
          cursor: pointer;
          transition: background 120ms ease;
        }
        .gov-shared-row:hover { background: var(--bg-hover); }
        .gov-shared-row:last-child { border-bottom: none; }
        .gov-shared-icon {
          width: 34px; height: 34px;
          border-radius: 7px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Geist Mono',monospace;
          font-size: 11px;
          font-weight: 700;
        }
        .gov-shared-name { font-size: 13.5px; font-weight: 500; color: var(--fg); }
        .gov-shared-sub {
          font-family: 'Geist Mono',monospace;
          font-size: 11.5px;
          color: var(--fg-dim);
          margin-top: 2px;
        }
        .gov-shared-meta {
          font-family: 'Geist Mono',monospace;
          font-size: 11px;
          color: var(--fg-muted);
        }
        .gov-act {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 10px 14px;
          border-radius: 8px;
          background: var(--bg-elev-2);
          border: 1px solid var(--border);
          margin-bottom: 8px;
          transition: background 120ms ease, border-color 120ms ease;
          cursor: pointer;
          width: 100%;
          text-align: left;
          font: inherit;
          color: var(--fg);
        }
        .gov-act:hover { background: var(--bg-hover); border-color: var(--border-strong); }
        .gov-act-key {
          font-family: 'Geist Mono',monospace;
          font-size: 11px;
          padding: 3px 7px;
          border-radius: 4px;
          background: var(--bg);
          border: 1px solid var(--border-strong);
          color: var(--accent);
          min-width: 26px;
          text-align: center;
        }
        .gov-act-label { font-size: 13px; color: var(--fg); }
      `}</style>

      <div
        className="gov-root"
        style={{
          padding: '24px 36px 50px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {/* ─── Hero band ─────────────────────────── */}
        <header className="gov-band gov-band--hero" data-live={liveProcess ? 'true' : 'false'}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="gov-kicker">Workspace</div>
              <h1 className="gov-hero-title">Global</h1>
              <div className="gov-hero-sub">
                {liveProcess && (
                  <span className="gov-live-pill">
                    Live · {liveProject?.realPath.split('/').pop() ?? 'session'} · {formatRelative(liveDurationSec)}
                  </span>
                )}
                <span>{allProjects.length} projects</span>
                <span>·</span>
                <span>{totalSessions} lifetime sessions</span>
                <span>·</span>
                <span>{tokensFmt.value}{tokensFmt.unit} tokens</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="gov-btn" type="button">Import</button>
              <button className="gov-btn gov-btn--primary" type="button">+ New project</button>
            </div>
          </div>
        </header>

        {/* ─── Stats band ────────────────────────── */}
        <section className="gov-band gov-band--stats">
          <div className="gov-stats">
            <div className="gov-stat">
              <div className="gov-stat-l">Active</div>
              <div className="gov-stat-n">{activeProcesses.length}</div>
              <div className="gov-stat-d">
                {liveProcess
                  ? `${liveProject?.realPath.split('/').pop() ?? 'session'} · ${formatRelative(liveDurationSec)}`
                  : 'no live session'}
              </div>
            </div>
            <div className="gov-stat">
              <div className="gov-stat-l">Projects</div>
              <div className="gov-stat-n">{allProjects.length}</div>
              <div className="gov-stat-d">
                {Math.max(0, allProjects.length - activeProcesses.length)} idle
              </div>
            </div>
            <div className="gov-stat">
              <div className="gov-stat-l">Tokens · lifetime</div>
              <div className="gov-stat-n">
                {tokensFmt.value}<span className="u">{tokensFmt.unit}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <Sparkline values={tokensSpark} color="var(--accent)" />
              </div>
            </div>
            <div className="gov-stat">
              <div className="gov-stat-l">Sessions · lifetime</div>
              <div className="gov-stat-n">{totalSessions}</div>
              <div className="gov-stat-d">
                {allProjects.length > 0
                  ? `avg ${(totalSessions / allProjects.length).toFixed(1)} / project`
                  : '—'}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Projects band ─────────────────────── */}
        <section className="gov-band">
          <div className="gov-band-head">
            <h2>Projects</h2>
            <span className="meta">sorted by token usage</span>
          </div>
          <div>
            {sortedProjects.map(p => {
              const name = p.realPath.split('/').pop() ?? p.realPath
              const cat = pickCategory(p.hash)
              const tok = CAT_TOKENS[cat]
              const cost = costByHash.get(p.hash)
              const isLive = liveProject?.hash === p.hash
              const tokens = formatTokens(cost?.totalTokens ?? 0)
              const sparkSeed = name.length
              const spark = Array.from({ length: 9 }, (_, i) => Math.sin(i * 0.6 + sparkSeed) + 1)

              return (
                <button
                  key={p.hash}
                  type="button"
                  className="gov-proj-row"
                  onClick={() => onSelectProject(p)}
                >
                  <div
                    className="gov-proj-mark"
                    style={{
                      background: tok.tint,
                      color: tok.fg,
                      border: `1px solid ${tok.border}`,
                    }}
                  >
                    {(name[0] ?? '?').toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="gov-proj-name">
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      {isLive && <span className="gov-live-pill">Live</span>}
                    </div>
                    <div className="gov-proj-path">{p.realPath}</div>
                  </div>
                  <div className="gov-proj-cell">
                    <span className="l">sessions</span>
                    <span className="v">{cost?.sessionsCount ?? 0}</span>
                  </div>
                  <div className="gov-proj-cell">
                    <span className="l">tokens</span>
                    <span className="v">{tokens.value}{tokens.unit}</span>
                  </div>
                  <div className="gov-proj-cell">
                    <span className="l">est. cost</span>
                    <span className="v">${(cost?.cost ?? 0).toFixed(2)}</span>
                  </div>
                  <Sparkline values={spark} color={tok.fg} w={80} h={24} />
                </button>
              )
            })}
            {sortedProjects.length === 0 && (
              <div style={{ padding: '20px 8px', color: 'var(--fg-dim)', fontSize: 13 }}>
                No projects yet.
              </div>
            )}
          </div>
        </section>

        {/* ─── Split band: Shared config + Quick actions ─── */}
        <section className="gov-band">
          <div className="gov-split">
            {/* Shared configuration */}
            <div>
              <div className="gov-band-head">
                <h2>Shared configuration</h2>
                <span className="meta">~/.claude · applied to all projects</span>
              </div>
              <div>
                <button className="gov-shared-row" type="button" onClick={() => onNavigate({ type: 'global-claudemd' })}>
                  <div className="gov-shared-icon" style={{
                    background: CAT_TOKENS.claude.tint,
                    color: CAT_TOKENS.claude.fg,
                    border: `1px solid ${CAT_TOKENS.claude.border}`,
                  }}>MD</div>
                  <div>
                    <div className="gov-shared-name">User CLAUDE.md</div>
                    <div className="gov-shared-sub">Global instructions</div>
                  </div>
                  <div className="gov-shared-meta">{globalClaudeMd ? `${claudeMdLines} lines` : 'not set'}</div>
                </button>

                <button className="gov-shared-row" type="button" onClick={() => onNavigate({ type: 'global-skills' })}>
                  <div className="gov-shared-icon" style={{
                    background: CAT_TOKENS.skill.tint,
                    color: CAT_TOKENS.skill.fg,
                    border: `1px solid ${CAT_TOKENS.skill.border}`,
                  }}>★</div>
                  <div>
                    <div className="gov-shared-name">User skills</div>
                    <div className="gov-shared-sub">Reusable instruction sets</div>
                  </div>
                  <div className="gov-shared-meta">{skills?.length ?? 0} skills</div>
                </button>

                <button className="gov-shared-row" type="button" onClick={() => onNavigate({ type: 'global-agents' })}>
                  <div className="gov-shared-icon" style={{
                    background: CAT_TOKENS.agent.tint,
                    color: CAT_TOKENS.agent.fg,
                    border: `1px solid ${CAT_TOKENS.agent.border}`,
                  }}>A</div>
                  <div>
                    <div className="gov-shared-name">User agents</div>
                    <div className="gov-shared-sub">Subagents available across projects</div>
                  </div>
                  <div className="gov-shared-meta">{agents?.length ?? 0} agents</div>
                </button>

                <button className="gov-shared-row" type="button" onClick={() => onNavigate({ type: 'global-mcp' })}>
                  <div className="gov-shared-icon" style={{
                    background: CAT_TOKENS.mcp.tint,
                    color: CAT_TOKENS.mcp.fg,
                    border: `1px solid ${CAT_TOKENS.mcp.border}`,
                  }}>M</div>
                  <div>
                    <div className="gov-shared-name">User MCP</div>
                    <div className="gov-shared-sub">Cloud + local servers</div>
                  </div>
                  <div className="gov-shared-meta">{mcpCount} servers</div>
                </button>
              </div>
            </div>

            {/* Quick actions */}
            <div>
              <div className="gov-band-head">
                <h2>Quick actions</h2>
              </div>
              <div style={{ marginTop: 8 }}>
                <button className="gov-act" type="button">
                  <span className="gov-act-key">⌘K</span>
                  <span className="gov-act-label">Command palette</span>
                </button>
                <button className="gov-act" type="button">
                  <span className="gov-act-key">⌘N</span>
                  <span className="gov-act-label">New session — last project</span>
                </button>
                <button className="gov-act" type="button">
                  <span className="gov-act-key">⌘P</span>
                  <span className="gov-act-label">Switch project</span>
                </button>
                <button className="gov-act" type="button">
                  <span className="gov-act-key">⌘,</span>
                  <span className="gov-act-label">Settings &amp; auth</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
