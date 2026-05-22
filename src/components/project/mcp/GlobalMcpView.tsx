import { useGlobalMcp, McpData } from '../../../hooks/useIPC'
import { Lens } from '../overview/Lens'
import { McpServerCard } from './McpServerCard'

function TopBar({ onBack }: { onBack: () => void }) {
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
        style={{
          WebkitAppRegion: 'no-drag',
          fontSize: 11,
          letterSpacing: '0.18em',
          color: 'var(--cl-ink-3)',
          lineHeight: 1,
        } as React.CSSProperties}
      >
        <span>←</span>
        Back
      </button>
      <span style={{ color: 'var(--cl-ink-4)', fontSize: 11, lineHeight: 1 }}>/</span>
      <span
        className="font-mono uppercase truncate"
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          color: 'var(--cl-ink-3)',
          lineHeight: 1,
        } as React.CSSProperties}
      >
        Global · MCP
      </span>
    </div>
  )
}

export function GlobalMcpView({
  onBack,
  onSelectServer,
}: {
  onBack: () => void
  onSelectServer: (server: McpData['cloudServers'][number]) => void
}) {
  const { data, isLoading } = useGlobalMcp()
  const mcp = data as McpData | undefined

  const cloud = mcp?.cloudServers ?? []
  const local = mcp?.localServers ?? []
  const total = cloud.length + local.length
  const totalProjects = mcp?.totalProjects ?? 0

  // Adozione media dei server cloud (% progetti in cui sono attivi).
  const avgAdoption =
    cloud.length > 0 && totalProjects > 0
      ? Math.round(
          (cloud.reduce((acc, s) => acc + s.enabledInProjects / totalProjects, 0) / cloud.length) * 100
        )
      : 0

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>Global · model context protocol</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">MCP</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span><b>{total}</b> {total === 1 ? 'server' : 'servers'}</span>
            <span className="sep">·</span>
            <span><b>{cloud.length}</b> cloud · <b>{local.length}</b> local</span>
            <span className="sep">·</span>
            <span>extend Claude with external tools</span>
          </div>
        </section>

        {isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : total === 0 ? (
          <section className="cl-section">
            <div className="cl-empty">
              No MCP servers configured. Connect cloud servers in Claude, or define local ones in{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>~/.claude/settings.json</code>.
            </div>
          </section>
        ) : (
          <>
            <section className="cl-section">
              <div className="cl-mcp-metrics">
                <div className="met">
                  <div className="lbl">Servers</div>
                  <div className="num">{total}</div>
                </div>
                <div className="met">
                  <div className="lbl">Cloud</div>
                  <div className="num">{cloud.length}</div>
                </div>
                <div className="met">
                  <div className="lbl">Local</div>
                  <div className="num">{local.length}</div>
                </div>
                <div className="met">
                  <div className="lbl">Avg adoption</div>
                  <div className="num">{avgAdoption}<small>%</small></div>
                </div>
              </div>
            </section>

            {cloud.length > 0 && (
              <section className="cl-section">
                <div className="cl-sec-head">
                  <h2>Cloud</h2>
                  <span className="ct">connected · across {totalProjects} projects</span>
                </div>
                <div className="cl-mcp-list">
                  {cloud.map(s => (
                    <McpServerCard key={s.name} server={s} totalProjects={totalProjects} onSelect={onSelectServer} />
                  ))}
                </div>
              </section>
            )}

            {local.length > 0 && (
              <section className="cl-section">
                <div className="cl-sec-head">
                  <h2>Local</h2>
                  <span className="ct">~/.claude/settings.json</span>
                </div>
                <div className="cl-mcp-list">
                  {local.map(s => (
                    <McpServerCard key={s.name} server={s} totalProjects={totalProjects} onSelect={onSelectServer} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
