import { useEffect, useMemo, useState } from 'react'
import {
  useProjectCost,
  useMemoryProject,
  useSessionList,
  useClaudeMdHierarchy,
  useGlobalMcp,
  useAllSkills,
  useGlobalAgents,
  useProjectAgents,
  useProjectRules,
  ClaudeProcess,
} from '../../../hooks/useIPC'
import { View } from '../types'
import type { SessionSummary } from '../../../types'

type Category = 'skill' | 'agent' | 'memory' | 'mcp' | 'claude'

const CAT_TOKENS: Record<Category, { fg: string; tint: string; border: string }> = {
  skill:  { fg: 'oklch(0.78 0.13 210)', tint: 'oklch(0.78 0.13 210 / 0.15)', border: 'oklch(0.78 0.13 210 / 0.30)' },
  agent:  { fg: 'oklch(0.78 0.13 155)', tint: 'oklch(0.78 0.13 155 / 0.15)', border: 'oklch(0.78 0.13 155 / 0.30)' },
  memory: { fg: 'oklch(0.80 0.13 85)',  tint: 'oklch(0.80 0.13 85 / 0.15)',  border: 'oklch(0.80 0.13 85 / 0.30)'  },
  mcp:    { fg: 'oklch(0.72 0.15 295)', tint: 'oklch(0.72 0.15 295 / 0.18)', border: 'oklch(0.72 0.15 295 / 0.30)' },
  claude: { fg: 'oklch(0.74 0.13 25)',  tint: 'oklch(0.74 0.13 25 / 0.15)',  border: 'oklch(0.74 0.13 25 / 0.30)'  },
}

function formatTokens(n: number): { value: string; unit: string } {
  if (n >= 1_000_000_000) return { value: (n / 1_000_000_000).toFixed(1), unit: 'B' }
  if (n >= 1_000_000)     return { value: (n / 1_000_000).toFixed(1), unit: 'M' }
  if (n >= 1_000)         return { value: (n / 1_000).toFixed(1), unit: 'K' }
  return { value: String(n), unit: '' }
}

function relativeFromIso(iso: string): string {
  const d = new Date(iso).getTime()
  if (isNaN(d)) return ''
  const diff = Math.floor((Date.now() - d) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 86400 * 14) return `${Math.floor(diff / 86400)}d`
  return `${Math.floor(diff / (86400 * 7))}w`
}

function ActivityTimeline({ sessions, days }: { sessions: SessionSummary[]; days: number }) {
  const buckets = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const arr = new Array(days).fill(0)
    for (const s of sessions) {
      const t = new Date(s.date).getTime()
      if (isNaN(t)) continue
      const diffDays = Math.floor((now.getTime() - t) / 86400000)
      const idx = days - 1 - diffDays
      if (idx >= 0 && idx < days) arr[idx] += s.totalTokens
    }
    return arr
  }, [sessions, days])
  const max = Math.max(...buckets, 1)
  return (
    <div className="po-tl-grid">
      {buckets.map((v, i) => {
        const isToday = i === buckets.length - 1
        return (
          <div key={i} className={`po-tl-col ${v > 0 ? 'has' : ''} ${isToday ? 'today' : ''}`}>
            <div className="po-tl-bar" style={{ height: `${Math.max((v / max) * 100, v > 0 ? 6 : 0)}%` }} />
          </div>
        )
      })}
    </div>
  )
}

export function ProjectOverviewContent({
  project,
  onNavigate,
}: {
  project: { hash: string; realPath: string }
  onNavigate: (v: View) => void
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

  const [activeProcesses, setActiveProcesses] = useState<ClaudeProcess[]>([])
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
  const liveProc = activeProcesses.find(p => p.cwd === project.realPath)
  const liveStartRef = useMemo(() => Date.now(), [liveProc?.pid])
  const [, force] = useState(0)
  useEffect(() => {
    if (!liveProc) return
    const t = setInterval(() => force(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [liveProc])
  const liveSec = liveProc ? Math.floor((Date.now() - liveStartRef) / 1000) : 0
  const liveTime = liveProc ? `${Math.floor(liveSec / 60)}m ${liveSec % 60}s` : ''

  const projectName = project.realPath.split('/').pop() ?? project.realPath
  const sessionCount = cost?.sessionsCount ?? sessions.length
  const tokens = formatTokens(cost?.totalTokens ?? 0)
  const lastSession = sessions[0]

  // Model mix from sessions
  const modelMix = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sessions) {
      for (const [model, count] of Object.entries(s.models ?? {})) {
        m.set(model, (m.get(model) ?? 0) + count)
      }
    }
    const total = [...m.values()].reduce((a, b) => a + b, 0)
    if (!total) return [] as { model: string; pct: number; cat: Category }[]
    const palette: Category[] = ['claude', 'skill', 'mcp', 'agent', 'memory']
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([model, count], i) => ({
        model: model.replace(/^claude-/, '').replace(/-\d+-?\d*$/, ''),
        pct: Math.round((count / total) * 100),
        cat: palette[i % palette.length],
      }))
  }, [sessions])

  const enabledMcp = [
    ...(mcpData?.cloudServers ?? []),
    ...(mcpData?.localServers ?? []),
  ].filter(s => !s.disabledProjectPaths.includes(project.realPath))

  const projectClaudeMd = claudeMd?.layers.find(l => l.scope === 'project')
  const claudeMdLines = projectClaudeMd ? projectClaudeMd.content.split('\n').length : 0
  const skillCount = allSkills.length
  const agentNames = new Set([...projectAgents.map(a => a.name), ...globalAgents.map(a => a.name)])
  const agentCount = agentNames.size
  const topicCount = (memory?.index.length ?? 0) + (memory?.projectLevelIndex.length ?? 0)
  const memoryCap = 200

  // Sparkline for tokens stat from session history
  const tokenSpark = useMemo(() => {
    const last = sessions.slice(0, 14).reverse().map(s => s.totalTokens)
    return last.length ? last : [0, 1, 0]
  }, [sessions])

  const tokensIncreaseLast7 = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000
    return sessions.filter(s => new Date(s.date).getTime() >= cutoff).length
  }, [sessions])

  const [tlRange, setTlRange] = useState<14 | 30 | 90>(14)

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: '#0a0c11',
        fontFamily: "'Geist','Inter',-apple-system,BlinkMacSystemFont,sans-serif",
        color: '#e8ecf3',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');
        .po-root {
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
          --warn: oklch(0.80 0.15 75);
          --cat-skill:  oklch(0.78 0.13 210);
          --cat-agent:  oklch(0.78 0.13 155);
          --cat-memory: oklch(0.80 0.13 85);
          --cat-mcp:    oklch(0.72 0.15 295);
          --cat-claude: oklch(0.74 0.13 25);
        }
        .po-mono { font-family: 'Geist Mono','JetBrains Mono','SF Mono',monospace; }
        .po-band {
          background: var(--bg-elev);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 24px 28px;
        }
        .po-band--stats { padding: 20px 28px; }
        .po-band--hero {
          background:
            radial-gradient(circle at 0% 0%, oklch(0.75 0.17 150 / 0.12), transparent 50%),
            var(--bg-elev);
        }
        .po-band--hero[data-live="true"] { border-color: oklch(0.75 0.17 150 / 0.25); }
        .po-back {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 10px;
          border-radius: 6px;
          background: var(--bg-elev-2);
          border: 1px solid var(--border);
          font-family: 'Geist Mono',monospace;
          font-size: 11px;
          color: var(--fg-muted);
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease;
        }
        .po-back:hover { background: var(--bg-hover); color: var(--fg); }
        .po-kicker {
          font-family: 'Geist Mono',monospace;
          font-size: 10.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--fg-dim);
        }
        .po-hero-title {
          font-size: 44px;
          font-weight: 500;
          letter-spacing: -0.03em;
          line-height: 1;
          margin: 8px 0 14px;
          color: var(--fg);
          word-break: break-word;
        }
        .po-hero-title .dim { color: var(--fg-dim); }
        .po-hero-sub {
          display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
          font-family: 'Geist Mono',monospace;
          font-size: 12px;
          color: var(--fg-muted);
        }
        .po-live-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px;
          border-radius: 99px;
          background: oklch(0.75 0.17 150 / 0.14);
          color: var(--success);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 500;
        }
        .po-live-pill::before {
          content: '';
          width: 6px; height: 6px;
          border-radius: 50%;
          background: currentColor;
          box-shadow: 0 0 8px currentColor;
          animation: poPulse 2s infinite;
        }
        @keyframes poPulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
        .po-btn {
          display: inline-flex; align-items: center; gap: 6px;
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
        .po-btn:hover { background: var(--bg-hover); }
        .po-btn--primary {
          background: var(--accent);
          color: #0a0c11;
          border-color: transparent;
          font-weight: 500;
        }
        .po-btn--primary:hover { background: oklch(0.82 0.13 210); }
        .po-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px; }
        .po-stat { border-right: 1px dashed var(--border); padding-right: 20px; }
        .po-stat:last-child { border-right: none; }
        .po-stat-l {
          font-family: 'Geist Mono',monospace;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--fg-dim);
          margin-bottom: 10px;
        }
        .po-stat-n {
          font-size: 32px; font-weight: 500;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }
        .po-stat-n .u { font-size: 14px; color: var(--fg-dim); margin-left: 3px; }
        .po-stat-d {
          font-family: 'Geist Mono',monospace;
          font-size: 10.5px;
          color: var(--fg-dim);
          margin-top: 8px;
        }
        .po-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; margin: 12px 0 10px; background: var(--bg-elev-2); }
        .po-bar-seg { height: 100%; }
        .po-legend { display: flex; flex-wrap: wrap; gap: 8px 12px; font-family: 'Geist Mono',monospace; font-size: 10.5px; color: var(--fg-muted); }
        .po-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
        .po-band-head {
          display: flex; justify-content: space-between; align-items: baseline;
          margin-bottom: 14px;
        }
        .po-band-head h2 {
          font-size: 15px; font-weight: 600; letter-spacing: -0.005em;
          color: var(--fg); margin: 0;
        }
        .po-band-head .meta { font-family: 'Geist Mono',monospace; font-size: 11px; color: var(--fg-dim); }
        .po-chip-group { display: inline-flex; gap: 4px; }
        .po-chip {
          font-family: 'Geist Mono',monospace;
          font-size: 10.5px;
          padding: 3px 8px;
          border-radius: 4px;
          background: var(--bg-elev-2);
          border: 1px solid var(--border);
          color: var(--fg-dim);
          cursor: pointer;
          transition: all 120ms ease;
        }
        .po-chip:hover { color: var(--fg-muted); }
        .po-chip.active { background: var(--accent); color: #0a0c11; border-color: transparent; }
        .po-tl-grid {
          display: grid;
          grid-template-columns: repeat(var(--cols, 14), 1fr);
          gap: 3px;
          height: 100px;
          align-items: end;
        }
        .po-tl-col { height: 100%; display: flex; align-items: flex-end; }
        .po-tl-bar {
          width: 100%;
          background: var(--bg-elev-2);
          border-radius: 2px;
          min-height: 2px;
          transition: background 120ms ease;
        }
        .po-tl-col.has .po-tl-bar { background: oklch(0.78 0.13 210 / 0.6); }
        .po-tl-col.today .po-tl-bar { background: var(--accent); }
        .po-tl-axis {
          display: flex; justify-content: space-between;
          font-family: 'Geist Mono',monospace;
          font-size: 10px; color: var(--fg-dim);
          margin-top: 8px;
        }
        .po-config-rail {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 14px;
        }
        .po-conf-card {
          background: var(--bg-elev-2);
          border: 1px solid var(--border);
          border-left-width: 3px;
          border-radius: 10px;
          padding: 14px 14px 14px 16px;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
          text-align: left;
          font: inherit;
          color: inherit;
          display: flex; flex-direction: column; gap: 4px;
        }
        .po-conf-card:hover { background: var(--bg-hover); }
        .po-conf-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
        .po-conf-icon {
          width: 28px; height: 28px;
          border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Geist Mono',monospace;
          font-size: 11px; font-weight: 700;
        }
        .po-conf-n {
          font-family: 'Geist Mono',monospace;
          font-size: 10.5px;
          color: var(--fg-muted);
          font-variant-numeric: tabular-nums;
        }
        .po-conf-name { font-size: 13.5px; font-weight: 500; color: var(--fg); }
        .po-conf-sub {
          font-family: 'Geist Mono',monospace;
          font-size: 11px;
          color: var(--fg-dim);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .po-split { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
        .po-mem-row, .po-rule-row {
          display: grid;
          grid-template-columns: 50px 1fr auto;
          gap: 12px;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px dashed var(--border);
        }
        .po-mem-row:last-child, .po-rule-row:last-child { border-bottom: none; }
        .po-mem-tag {
          font-family: 'Geist Mono',monospace;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.1em;
          padding: 3px 6px;
          border-radius: 4px;
          text-align: center;
        }
        .po-mem-k { font-size: 13px; font-weight: 500; color: var(--fg); }
        .po-mem-v {
          font-family: 'Geist Mono',monospace;
          font-size: 11px; color: var(--fg-dim);
          margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .po-mem-t { font-family: 'Geist Mono',monospace; font-size: 11px; color: var(--fg-muted); }
        .po-rule-glob {
          font-family: 'Geist Mono',monospace;
          font-size: 11px;
          color: var(--warn);
          background: oklch(0.80 0.15 75 / 0.10);
          border: 1px solid oklch(0.80 0.15 75 / 0.25);
          padding: 3px 8px;
          border-radius: 4px;
          text-align: center;
          width: max-content;
          justify-self: start;
        }
      `}</style>

      <div
        className="po-root"
        style={{ padding: '24px 36px 50px', display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        {/* Back to global */}
        <div>
          <button className="po-back" type="button" onClick={() => onNavigate({ type: 'global-home' })}>
            ← Global
          </button>
        </div>

        {/* ─── Hero band ─────────────────────────── */}
        <header className="po-band po-band--hero" data-live={liveProc ? 'true' : 'false'}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="po-kicker">Project · {projectName}</div>
              <h1 className="po-hero-title">
                {projectName} <span className="dim">overview</span>
              </h1>
              <div className="po-hero-sub">
                {liveProc && <span className="po-live-pill">Live · {liveTime}</span>}
                <span>{sessionCount} sessions</span>
                <span className="po-mono">{tokens.value}{tokens.unit} tokens</span>
                {lastSession?.model && <span className="po-mono">{lastSession.model.replace(/^claude-/, '')}</span>}
                <span className="po-mono" title={project.realPath}>{project.realPath}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                className="po-btn"
                type="button"
                onClick={() => window.electronAPI.sessions.newInTerminal(project.realPath)}
              >
                Open in Claude Code
              </button>
              <button
                className="po-btn po-btn--primary"
                type="button"
                onClick={() => onNavigate({ type: 'sessions', project })}
              >
                Open sessions →
              </button>
            </div>
          </div>
        </header>

        {/* ─── Stats band ────────────────────────── */}
        <section className="po-band po-band--stats">
          <div className="po-stats">
            <div className="po-stat">
              <div className="po-stat-l">Sessions</div>
              <div className="po-stat-n">{sessionCount}</div>
              <div className="po-stat-d">+{tokensIncreaseLast7} last 7d</div>
            </div>
            <div className="po-stat">
              <div className="po-stat-l">Tokens</div>
              <div className="po-stat-n">{tokens.value}<span className="u">{tokens.unit}</span></div>
              <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ display: 'block', marginTop: 8, color: 'var(--accent)', width: '100%', height: 24 }}>
                {(() => {
                  const min = Math.min(...tokenSpark)
                  const max = Math.max(...tokenSpark)
                  const r = max - min || 1
                  const step = 100 / Math.max(tokenSpark.length - 1, 1)
                  const pts = tokenSpark.map((v, i) => `${i * step},${24 - ((v - min) / r) * 24}`).join(' ')
                  return (
                    <>
                      <polygon points={`0,24 ${pts} 100,24`} fill="currentColor" opacity="0.15" />
                      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.2" />
                    </>
                  )
                })()}
              </svg>
            </div>
            <div className="po-stat">
              <div className="po-stat-l">Est. cost</div>
              <div className="po-stat-n">${(cost?.cost ?? 0).toFixed(2)}</div>
              <div className="po-stat-d">lifetime</div>
            </div>
            <div className="po-stat">
              <div className="po-stat-l">Model mix</div>
              {modelMix.length > 0 ? (
                <>
                  <div className="po-bar">
                    {modelMix.map(m => (
                      <div key={m.model} className="po-bar-seg" style={{ flex: m.pct, background: `var(--cat-${m.cat})` }} />
                    ))}
                  </div>
                  <div className="po-legend">
                    {modelMix.map(m => (
                      <span key={m.model}><i style={{ background: `var(--cat-${m.cat})` }} />{m.model} {m.pct}%</span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="po-stat-d" style={{ marginTop: 4 }}>no data</div>
              )}
            </div>
          </div>
        </section>

        {/* ─── Activity timeline ─────────────────── */}
        <section className="po-band">
          <div className="po-band-head">
            <h2>Activity</h2>
            <div className="po-chip-group">
              {([14, 30, 90] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  className={`po-chip ${tlRange === d ? 'active' : ''}`}
                  onClick={() => setTlRange(d)}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div style={{ ['--cols' as string]: tlRange } as React.CSSProperties}>
            <ActivityTimeline sessions={sessions} days={tlRange} />
          </div>
          <div className="po-tl-axis">
            <span>-{tlRange}d</span>
            <span>-{Math.floor(tlRange * 0.66)}d</span>
            <span>-{Math.floor(tlRange * 0.33)}d</span>
            <span>today</span>
          </div>
        </section>

        {/* ─── Configuration rail ────────────────── */}
        <section className="po-band">
          <div className="po-band-head">
            <h2>Configuration</h2>
            <span className="meta">{(claudeMd?.layers.length ?? 0)} layers · merged at runtime</span>
          </div>
          <div className="po-config-rail">
            <button
              className="po-conf-card"
              type="button"
              style={{ borderLeftColor: CAT_TOKENS.claude.fg }}
              onClick={() => projectClaudeMd && onNavigate({ type: 'project-claudemd', project, layer: projectClaudeMd })}
            >
              <div className="po-conf-top">
                <div className="po-conf-icon" style={{ background: CAT_TOKENS.claude.tint, color: CAT_TOKENS.claude.fg, border: `1px solid ${CAT_TOKENS.claude.border}` }}>MD</div>
                <span className="po-conf-n">{claudeMdLines || '—'} lines</span>
              </div>
              <div className="po-conf-name">CLAUDE.md</div>
              <div className="po-conf-sub">{projectClaudeMd ? 'Project instructions' : 'No project file'}</div>
            </button>

            <button
              className="po-conf-card"
              type="button"
              style={{ borderLeftColor: CAT_TOKENS.skill.fg }}
              onClick={() => onNavigate({ type: 'project-skills', project })}
            >
              <div className="po-conf-top">
                <div className="po-conf-icon" style={{ background: CAT_TOKENS.skill.tint, color: CAT_TOKENS.skill.fg, border: `1px solid ${CAT_TOKENS.skill.border}` }}>★</div>
                <span className="po-conf-n">{skillCount}</span>
              </div>
              <div className="po-conf-name">Skills</div>
              <div className="po-conf-sub">
                {allSkills.slice(0, 3).map(s => s.name).join(' · ') || '—'}
              </div>
            </button>

            <button
              className="po-conf-card"
              type="button"
              style={{ borderLeftColor: CAT_TOKENS.agent.fg }}
              onClick={() => onNavigate({ type: 'project-agents', project })}
            >
              <div className="po-conf-top">
                <div className="po-conf-icon" style={{ background: CAT_TOKENS.agent.tint, color: CAT_TOKENS.agent.fg, border: `1px solid ${CAT_TOKENS.agent.border}` }}>◎</div>
                <span className="po-conf-n">{agentCount}</span>
              </div>
              <div className="po-conf-name">Agents</div>
              <div className="po-conf-sub">
                {[...projectAgents, ...globalAgents].slice(0, 3).map(a => a.name).join(' · ') || '—'}
              </div>
            </button>

            <button
              className="po-conf-card"
              type="button"
              style={{ borderLeftColor: CAT_TOKENS.mcp.fg }}
              onClick={() => onNavigate({ type: 'global-mcp' })}
            >
              <div className="po-conf-top">
                <div className="po-conf-icon" style={{ background: CAT_TOKENS.mcp.tint, color: CAT_TOKENS.mcp.fg, border: `1px solid ${CAT_TOKENS.mcp.border}` }}>M</div>
                <span className="po-conf-n">{enabledMcp.length} servers</span>
              </div>
              <div className="po-conf-name">MCP</div>
              <div className="po-conf-sub">
                {enabledMcp.slice(0, 3).map(s => s.name.replace(/^claude\.ai\s*/i, '')).join(' · ') || '—'}
              </div>
            </button>

            <button
              className="po-conf-card"
              type="button"
              style={{ borderLeftColor: CAT_TOKENS.memory.fg }}
              onClick={() => onNavigate({ type: 'project-memory', project })}
            >
              <div className="po-conf-top">
                <div className="po-conf-icon" style={{ background: CAT_TOKENS.memory.tint, color: CAT_TOKENS.memory.fg, border: `1px solid ${CAT_TOKENS.memory.border}` }}>≡</div>
                <span className="po-conf-n">{topicCount} / {memoryCap}</span>
              </div>
              <div className="po-conf-name">Memory</div>
              <div className="po-conf-sub">
                {(memory?.index ?? []).slice(0, 3).map(t => t.name).join(' · ') || '—'}
              </div>
            </button>
          </div>
        </section>

        {/* ─── Split: Memory + Rules ─────────────── */}
        <section className="po-band">
          <div className="po-split">
            {/* Memory */}
            <div>
              <div className="po-band-head">
                <h2>Memory</h2>
                <span className="meta">MEMORY.md · {topicCount} / {memoryCap}</span>
              </div>
              <div>
                {(memory?.index ?? []).slice(0, 6).map(t => {
                  const tag = t.type === 'feedback' ? 'FB' : t.type === 'project' ? 'REPO' : t.type === 'reference' ? 'REF' : 'USER'
                  const tagColor =
                    t.type === 'feedback' ? CAT_TOKENS.skill :
                    t.type === 'project'  ? CAT_TOKENS.memory :
                    t.type === 'reference'? CAT_TOKENS.mcp :
                                            CAT_TOKENS.agent
                  return (
                    <div key={t.filename} className="po-mem-row">
                      <span
                        className="po-mem-tag"
                        style={{ background: tagColor.tint, color: tagColor.fg, border: `1px solid ${tagColor.border}` }}
                      >{tag}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="po-mem-k">{t.name}</div>
                        <div className="po-mem-v">{t.description || '—'}</div>
                      </div>
                      <span className="po-mem-t">{relativeFromIso(t.updatedAt)}</span>
                    </div>
                  )
                })}
                {(memory?.index?.length ?? 0) === 0 && (
                  <div style={{ padding: '14px 0', color: 'var(--fg-dim)', fontSize: 13 }}>
                    No memory topics yet.
                  </div>
                )}
              </div>
            </div>

            {/* Rules */}
            <div>
              <div className="po-band-head">
                <h2>Rules</h2>
                <span className="meta">{rules.length} conditional</span>
              </div>
              <div>
                {rules.length === 0 && (
                  <div style={{ padding: '14px 0', color: 'var(--fg-dim)', fontSize: 13 }}>
                    No conditional rules.
                  </div>
                )}
                {rules.map(r => (
                  <div key={r.filename} className="po-rule-row" style={{ gridTemplateColumns: 'auto 1fr' }}>
                    <div>
                      {r.paths && r.paths.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {r.paths.map(p => (
                            <span key={p} className="po-rule-glob">{p}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="po-rule-glob">always</span>
                      )}
                    </div>
                    <div>
                      <div className="po-mem-k">{r.filename}</div>
                      <div className="po-mem-v">{r.content.split('\n').find(l => l.trim() && !l.startsWith('---') && !l.startsWith('#'))?.trim() ?? '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
