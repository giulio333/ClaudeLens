import { useGlobalMcp, McpData, McpServer } from '../../../hooks/useIPC';
import { Lens } from '../overview/Lens';
import { TopBar } from '../shared/TopBar';
import { mcpServiceColor, mcpStatusMeta } from './McpServerCard';

const TONES = ['', 'violet', 'cyan'] as const;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function McpCell({
  server,
  tone,
  totalProjects,
  onSelect,
}: {
  server: McpServer;
  tone: string;
  totalProjects: number;
  onSelect: (s: McpServer) => void;
}) {
  const displayName = server.name.replace(/^claude\.ai\s*/i, '');
  const isLocal = server.source === 'local';
  const status = mcpStatusMeta(server.status);
  // The LED reports what Claude Code says about the server right now; the
  // per-project counters below carry the enabled/disabled dimension.
  const ledColor = server.live && isLocal ? mcpServiceColor(server.name) : status.color;

  if (isLocal) {
    const envKeys = server.env ? Object.keys(server.env) : [];
    return (
      <button
        type="button"
        className={`cl-mcp-cell ${tone}`}
        onClick={() => onSelect(server)}
        title={status.hint}
      >
        <div className="led-row">
          <span className="led" style={{ background: ledColor }} />
          {status.label}
        </div>
        <div className="mcp-name">{displayName}</div>
        <div className="tools">
          {server.command ? (
            <>
              command <b>{server.command}</b>
            </>
          ) : (
            'local server'
          )}
          {envKeys.length > 0 && (
            <>
              {' '}
              · <b>{envKeys.length}</b> env
            </>
          )}
        </div>
        <div className="frac">local</div>
      </button>
    );
  }

  if (!server.live) {
    return (
      <button
        type="button"
        className={`cl-mcp-cell ${tone}`}
        onClick={() => onSelect(server)}
        title={status.hint}
        style={{ opacity: 0.62 }}
      >
        <div className="led-row">
          <span className="led" style={{ background: ledColor }} />
          {status.label}
        </div>
        <div className="mcp-name">{displayName}</div>
        <div className="tools">absent from the live list</div>
        <div className="frac">—</div>
      </button>
    );
  }

  const total = server.enabledInProjects + server.disabledInProjects;
  const denom = totalProjects > 0 ? totalProjects : total;
  return (
    <button
      type="button"
      className={`cl-mcp-cell ${tone}`}
      onClick={() => onSelect(server)}
      title={status.hint}
    >
      <div className="led-row">
        <span className="led" style={{ background: ledColor }} />
        {status.label}
      </div>
      <div className="mcp-name">{displayName}</div>
      <div className="tools">
        active in <b>{server.enabledInProjects}</b> of {denom} projects
      </div>
      <div className="frac">
        {server.enabledInProjects}
        <small>/{denom}</small>
      </div>
    </button>
  );
}

function McpRowGroup({
  servers,
  totalProjects,
  onSelect,
  baseIndex,
}: {
  servers: McpServer[];
  totalProjects: number;
  onSelect: (s: McpServer) => void;
  baseIndex: number;
}) {
  return (
    <div className="cl-mcp-row" style={{ gridTemplateColumns: `repeat(${servers.length}, 1fr)` }}>
      {servers.map((s, i) => (
        <McpCell
          key={s.name}
          server={s}
          tone={TONES[(baseIndex + i) % TONES.length]}
          totalProjects={totalProjects}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function GlobalMcpView({
  onBack,
  onSelectServer,
}: {
  onBack: () => void;
  onSelectServer: (server: McpData['cloudServers'][number]) => void;
}) {
  const { data, isLoading } = useGlobalMcp();
  const mcp = data as McpData | undefined;

  const cloud = mcp?.cloudServers ?? [];
  const local = mcp?.localServers ?? [];
  const unlisted = mcp?.unlistedServers ?? [];
  const total = cloud.length + local.length;
  const totalProjects = mcp?.totalProjects ?? 0;
  const probeError = mcp?.probe?.error ?? null;
  const probeCommand = mcp?.probe?.command ?? 'claude mcp list';
  // The live list varies between runs, so the read time is part of the reading.
  const observedAt = mcp?.probe?.observedAt ?? null;
  const observedLabel = observedAt
    ? new Date(observedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null;
  const connected = [...cloud, ...local].filter(
    s => s.status === 'connected' || s.status === 'pending'
  ).length;

  // Adozione media dei server cloud (% progetti in cui sono attivi).
  const avgAdoption =
    cloud.length > 0 && totalProjects > 0
      ? Math.round(
          (cloud.reduce((acc, s) => acc + s.enabledInProjects / totalProjects, 0) / cloud.length) *
            100
        )
      : 0;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Global · MCP' }]} />

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
            <span>
              <b>{total}</b> {total === 1 ? 'server' : 'servers'}
            </span>
            <span className="sep">·</span>
            <span>
              <b>{cloud.length}</b> cloud · <b>{local.length}</b> local
            </span>
            <span className="sep">·</span>
            {unlisted.length > 0 ? (
              <span>
                <b>{unlisted.length}</b> not listed
              </span>
            ) : (
              <span>extend Claude with external tools</span>
            )}
          </div>
        </section>

        {isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : (
          <>
            {probeError && (
              <section className="cl-section">
                <div
                  className="cl-empty"
                  style={{ borderColor: 'color-mix(in oklch, var(--cl-warn) 40%, transparent)' }}
                >
                  Live status unavailable: {probeError}
                </div>
              </section>
            )}

            {total === 0 && unlisted.length === 0 ? (
              <section className="cl-section">
                <div className="cl-empty">
                  No MCP servers configured. Connect cloud servers in Claude, or define local ones
                  in <code style={{ fontFamily: 'var(--font-mono)' }}>~/.claude/settings.json</code>
                  .
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
                      <div className="lbl">Connected</div>
                      <div className="num">{connected}</div>
                    </div>
                    <div className="met">
                      <div className="lbl">Local</div>
                      <div className="num">{local.length}</div>
                    </div>
                    <div className="met">
                      <div className="lbl">Avg adoption</div>
                      <div className="num">
                        {avgAdoption}
                        <small>%</small>
                      </div>
                    </div>
                  </div>
                </section>

                {cloud.length > 0 && (
                  <section className="cl-section">
                    <div className="cl-sec-head">
                      <h2>Cloud</h2>
                      <span className="ct">
                        {probeCommand}
                        {observedLabel ? ` at ${observedLabel}` : ''} · across {totalProjects}{' '}
                        projects
                      </span>
                    </div>
                    {chunk(cloud, 3).map((group, gi) => (
                      <McpRowGroup
                        key={gi}
                        servers={group}
                        totalProjects={totalProjects}
                        onSelect={onSelectServer}
                        baseIndex={gi * 3}
                      />
                    ))}
                  </section>
                )}

                {local.length > 0 && (
                  <section className="cl-section">
                    <div className="cl-sec-head">
                      <h2>Local</h2>
                      <span className="ct">~/.claude.json · ~/.claude/settings.json</span>
                    </div>
                    {chunk(local, 3).map((group, gi) => (
                      <McpRowGroup
                        key={gi}
                        servers={group}
                        totalProjects={totalProjects}
                        onSelect={onSelectServer}
                        baseIndex={gi * 3}
                      />
                    ))}
                  </section>
                )}

                {unlisted.length > 0 && (
                  <section className="cl-section">
                    <div className="cl-sec-head">
                      <h2>Not listed</h2>
                      <span className="ct">on disk only</span>
                    </div>
                    <p
                      style={{
                        color: 'var(--cl-ink-3)',
                        fontSize: 13,
                        lineHeight: 1.6,
                        margin: '0 0 14px',
                        maxWidth: 620,
                      }}
                    >
                      Names recorded in{' '}
                      <code style={{ fontFamily: 'var(--font-mono)' }}>~/.claude.json</code> that
                      the last{' '}
                      <code style={{ fontFamily: 'var(--font-mono)' }}>{probeCommand}</code> did not
                      include. Claude Code never removes a connector from that file when you
                      disconnect it, so most of these are leftovers you will not see in{' '}
                      <code style={{ fontFamily: 'var(--font-mono)' }}>/mcp</code>. Its list does
                      vary between runs, though, so a name here can reappear above later.
                    </p>
                    {chunk(unlisted, 3).map((group, gi) => (
                      <McpRowGroup
                        key={gi}
                        servers={group}
                        totalProjects={totalProjects}
                        onSelect={onSelectServer}
                        baseIndex={gi * 3}
                      />
                    ))}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
