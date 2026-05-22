import { McpServer } from '../../../hooks/useIPC'
import { Lens } from '../overview/Lens'
import { mcpServiceColor, mcpServiceMeta } from './McpServerCard'

function TopBar({ onBack, name }: { onBack: () => void; name: string }) {
  const crumb = (accent = false): React.CSSProperties => ({
    fontSize: 11,
    letterSpacing: '0.18em',
    color: accent ? 'var(--cl-ink)' : 'var(--cl-ink-3)',
    lineHeight: 1,
  })
  return (
    <div
      className="shrink-0 flex items-center gap-3 border-b border-[var(--cl-line)]"
      style={{
        WebkitAppRegion: 'drag',
        background: 'var(--cl-paper)',
        height: 52,
        padding: '0 28px 0 88px',
      } as React.CSSProperties}
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 font-mono uppercase transition-colors hover:text-[var(--cl-accent)]"
        style={{ WebkitAppRegion: 'no-drag', ...crumb() } as React.CSSProperties}
      >
        <span>←</span>
        Back
      </button>
      <span style={{ color: 'var(--cl-ink-4)', fontSize: 11, lineHeight: 1 }}>/</span>
      <span className="font-mono uppercase" style={crumb()}>Global · MCP</span>
      <span style={{ color: 'var(--cl-ink-4)', fontSize: 11, lineHeight: 1 }}>/</span>
      <span className="font-mono uppercase truncate" style={crumb(true)}>{name}</span>
    </div>
  )
}

function ProjectRow({ path, color }: { path: string; color: string }) {
  return (
    <div className="d-proj">
      <span className="dot" style={{ background: color }} />
      <span className="name">{path.split('/').pop() ?? path}</span>
      <span className="path" title={path}>{path}</span>
    </div>
  )
}

export function McpServerDetailView({
  server,
  totalProjects,
  onBack,
}: {
  server: McpServer
  totalProjects: number
  onBack: () => void
}) {
  const displayName = server.name.replace(/^claude\.ai\s*/i, '')
  const color = mcpServiceColor(server.name)
  const initial = displayName.trim()[0]?.toUpperCase() ?? '?'
  const meta = mcpServiceMeta(server.name)

  const isLocal = server.source === 'local'
  const fullyEnabled = server.disabledInProjects === 0
  const fullyDisabled = server.enabledInProjects === 0
  const statusColor = fullyEnabled ? 'var(--cl-ok)' : fullyDisabled ? 'var(--cl-danger)' : 'var(--cl-warn)'
  const statusLabel = fullyEnabled ? 'enabled everywhere' : fullyDisabled ? 'disabled everywhere' : 'partially enabled'

  const pct = totalProjects > 0 ? Math.round((server.enabledInProjects / totalProjects) * 100) : 0
  const envKeys = server.env ? Object.keys(server.env) : []
  const commandLine = server.command
    ? `${server.command}${server.args?.length ? ' ' + server.args.join(' ') : ''}`
    : null

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} name={displayName} />

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
            <span className="tag" style={{ background: 'var(--cl-paper-2)' }}>
              <span className="led" style={{ background: statusColor }} />
              {statusLabel}
            </span>
            <span className="sep">·</span>
            <span>{meta.category}</span>
            <span className="sep">·</span>
            <span>{server.source}</span>
          </div>
          <p style={{ marginTop: 14, maxWidth: 560, color: 'var(--cl-ink-2)', fontSize: 14, lineHeight: 1.6 }}>
            {meta.description}
          </p>
        </section>

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
            <i style={{ width: `${pct}%`, background: statusColor }} />
          </div>
        </section>

        {isLocal && (commandLine || envKeys.length > 0) && (
          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Configuration</h2>
              <span className="ct">~/.claude/settings.json</span>
            </div>
            <div className="cl-mcp-detail" style={{ paddingTop: 0 }}>
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
            <div className="cl-mcp-detail" style={{ paddingTop: 0 }}>
              {server.enabledProjectPaths.map(p => (
                <ProjectRow key={p} path={p} color="var(--cl-ok)" />
              ))}
            </div>
          </section>
        )}

        {server.disabledProjectPaths.length > 0 && (
          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Disabled</h2>
              <span className="ct">{server.disabledProjectPaths.length} {server.disabledProjectPaths.length === 1 ? 'project' : 'projects'}</span>
            </div>
            <div className="cl-mcp-detail" style={{ paddingTop: 0 }}>
              {server.disabledProjectPaths.map(p => (
                <ProjectRow key={p} path={p} color="var(--cl-danger)" />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
