import { useMemo } from 'react'
import { McpServer, useCostSummary, useGlobalMcp, useMemoryProjects } from '../../../hooks/useIPC'
import type { ProjectCost } from '../../../types'
import { Lens } from '../overview/Lens'
import { TopBar } from '../shared/TopBar'
import { formatTokens } from '../utils'
import { mcpServiceColor, mcpServiceMeta, mcpStatusMeta } from './McpServerCard'

type Project = { hash: string; realPath: string }

function ProjectRow({
  path,
  statusColor,
  project,
  cost,
  onSelect,
}: {
  path: string
  statusColor: string
  project?: Project
  cost?: ProjectCost
  onSelect?: (p: Project) => void
}) {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const initial = (name[0] ?? '?').toUpperCase()
  const tokens = formatTokens(cost?.totalTokens ?? 0)
  const clickable = !!(project && onSelect)
  return (
    <button
      type="button"
      className="cl-row"
      onClick={() => clickable && onSelect!(project!)}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
    >
      <span className="idx">{initial}</span>
      <div style={{ minWidth: 0 }}>
        <div className="title">
          {name}
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            background: statusColor, marginLeft: 10, verticalAlign: 'middle',
          }} />
        </div>
        <div className="file">{path}</div>
      </div>
      <span className="when" style={{ textAlign: 'left' }}>{cost?.sessionsCount ?? 0} sessions</span>
      <span className="toks">{tokens.value}{tokens.unit}<small>tok</small></span>
      <span className="when">{cost ? `$${cost.cost.toFixed(2)}` : '—'}</span>
    </button>
  )
}

export function McpServerDetailView({
  server: navServer,
  totalProjects,
  onBack,
  onSelectProject,
}: {
  server: McpServer
  totalProjects: number
  onBack: () => void
  onSelectProject?: (p: Project) => void
}) {
  // Re-derive the server from the (cached) global read so the detail shows the
  // current live status rather than the snapshot captured at navigation time.
  const { data: mcp } = useGlobalMcp()
  const server = useMemo(() => {
    const all = [
      ...(mcp?.cloudServers ?? []),
      ...(mcp?.localServers ?? []),
      ...(mcp?.unlistedServers ?? []),
    ]
    return all.find(s => s.name === navServer.name) ?? navServer
  }, [mcp, navServer])
  const { data: allProjects = [] } = useMemoryProjects()
  const { data: costSummary } = useCostSummary()
  const projectByPath = useMemo(() => {
    const m = new Map<string, Project>()
    for (const p of allProjects) m.set(p.realPath, p)
    return m
  }, [allProjects])
  const costByHash = useMemo(() => {
    const m = new Map<string, ProjectCost>()
    for (const c of (costSummary as ProjectCost[] | undefined) ?? []) m.set(c.project, c)
    return m
  }, [costSummary])
  const displayName = server.name.replace(/^claude\.ai\s*/i, '')
  const color = mcpServiceColor(server.name)
  const initial = displayName.trim()[0]?.toUpperCase() ?? '?'
  const meta = mcpServiceMeta(server.name)

  const isLocal = server.source === 'local'
  const live = mcpStatusMeta(server.status)

  // Per-project adoption only means something for a server that still exists.
  const fullyEnabled = server.disabledInProjects === 0
  const fullyDisabled = server.enabledInProjects === 0
  const scopeColor = fullyEnabled ? 'var(--cl-ok)' : fullyDisabled ? 'var(--cl-danger)' : 'var(--cl-warn)'
  const scopeLabel = fullyEnabled ? 'enabled everywhere' : fullyDisabled ? 'disabled everywhere' : 'partially enabled'

  const pct = totalProjects > 0 ? Math.round((server.enabledInProjects / totalProjects) * 100) : 0
  const envKeys = server.env ? Object.keys(server.env) : []
  const commandLine = server.command
    ? `${server.command}${server.args?.length ? ' ' + server.args.join(' ') : ''}`
    : null

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Global · MCP' }, { label: displayName, accent: true }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" style={{ background: color }} />
            <span>Global · {isLocal ? 'local mcp server' : 'mcp server'}</span>
          </div>
          <h1 className="cl-h-name static" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span
              className="badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 52,
                height: 52,
                borderRadius: 14,
                fontFamily: 'var(--font-mono)',
                fontSize: 24,
                fontWeight: 600,
                background: `color-mix(in oklch, ${color} 14%, transparent)`,
                border: `1px solid color-mix(in oklch, ${color} 28%, transparent)`,
                color,
              }}
            >
              {initial}
            </span>
            <span className="label-name">{displayName}</span>
          </h1>
          <div className="cl-h-meta">
            <span className="tag" style={{ background: 'var(--cl-paper-2)' }} title={live.hint}>
              <span className="led" style={{ background: live.color }} />
              {live.label}
            </span>
            {server.live && (
              <>
                <span className="sep">·</span>
                <span title="Per-project toggles in ~/.claude.json">{scopeLabel}</span>
              </>
            )}
            <span className="sep">·</span>
            <span>{meta.category}</span>
            <span className="sep">·</span>
            <span>{server.source}</span>
          </div>
          <p style={{ marginTop: 14, maxWidth: 560, color: 'var(--cl-ink-2)', fontSize: 14, lineHeight: 1.6 }}>
            {server.live ? meta.description : live.hint}
          </p>
        </section>

        {!server.live && (
          <section className="cl-section">
            <div
              className="cl-empty"
              style={{ borderColor: 'color-mix(in oklch, var(--cl-warn) 40%, transparent)' }}
            >
              The last <code style={{ fontFamily: 'var(--font-mono)' }}>claude mcp list</code> did not include this server, so{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>/mcp</code> will not show it and its tools are unavailable. The
              name survives in <code style={{ fontFamily: 'var(--font-mono)' }}>~/.claude.json</code>, which keeps every
              connector ever connected to your account and never drops one you disconnect. Note that the list Claude Code
              reports varies between runs, so this reading can change.
            </div>
          </section>
        )}

        {server.live && (
        <section className="cl-section">
          <div className="cl-mcp-metrics">
            <div className="met">
              <div className="lbl">Adoption</div>
              <div className="num">{pct}<small>%</small></div>
            </div>
            <div className="met">
              <div className="lbl">Enabled</div>
              <div className="num">{server.enabledInProjects}</div>
            </div>
            <div className="met">
              <div className="lbl">Disabled</div>
              <div className="num">{server.disabledInProjects}</div>
            </div>
            <div className="met">
              <div className="lbl">Projects</div>
              <div className="num">{totalProjects}</div>
            </div>
          </div>
          <div className="cl-mcp-bar" style={{ width: '100%', height: 5, marginTop: 20 }}>
            <i style={{ width: `${pct}%`, background: scopeColor }} />
          </div>
        </section>
        )}

        {(server.target || (isLocal && (commandLine || envKeys.length > 0))) && (
          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Configuration</h2>
              <span className="ct">{isLocal ? '~/.claude.json · settings.json' : 'claude mcp list'}</span>
            </div>
            <div className="cl-mcp-config">
              {server.target && (
                <>
                  <div className="d-label">{isLocal ? 'Resolved' : 'Endpoint'}</div>
                  <div className="d-cmd">{server.target}</div>
                </>
              )}
              {commandLine && (
                <>
                  <div className="d-label">Command</div>
                  <div className="d-cmd">{commandLine}</div>
                </>
              )}
              {envKeys.length > 0 && (
                <>
                  <div className="d-label">Environment ({envKeys.length})</div>
                  <div className="d-env">
                    {envKeys.map(k => (
                      <span key={k} className="k">{k}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {!isLocal && server.enabledProjectPaths.length > 0 && (
          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Enabled</h2>
              <span className="ct">{server.enabledProjectPaths.length} {server.enabledProjectPaths.length === 1 ? 'project' : 'projects'}</span>
            </div>
            <div>
              {server.enabledProjectPaths.map(p => {
                const proj = projectByPath.get(p)
                return (
                  <ProjectRow
                    key={p}
                    path={p}
                    statusColor="var(--cl-ok)"
                    project={proj}
                    cost={proj ? costByHash.get(proj.hash) : undefined}
                    onSelect={onSelectProject}
                  />
                )
              })}
            </div>
          </section>
        )}

        {server.disabledProjectPaths.length > 0 && (
          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Disabled</h2>
              <span className="ct">{server.disabledProjectPaths.length} {server.disabledProjectPaths.length === 1 ? 'project' : 'projects'}</span>
            </div>
            <div>
              {server.disabledProjectPaths.map(p => {
                const proj = projectByPath.get(p)
                return (
                  <ProjectRow
                    key={p}
                    path={p}
                    statusColor="var(--cl-danger)"
                    project={proj}
                    cost={proj ? costByHash.get(proj.hash) : undefined}
                    onSelect={onSelectProject}
                  />
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
